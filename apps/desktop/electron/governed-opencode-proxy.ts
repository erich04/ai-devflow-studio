import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { AgentProviderRequestError, readProviderResponse, ProviderResponseReadError, resolveRequestPolicy, classifyProviderTransportError, describeStageAgentFailure, governedModelCall, modelCallMetadata, parseOpenAiCompatibleProviderUsage, stageAgentFailureDetails, type AgentProviderUsage, type ModelCallGovernance, type ModelCallQuote, type StageAgentFailureDetails } from '@ai-devflow/shared'
import type { OpencodeProviderBinding } from './opencode-provider-binding'
import { providerFailureDetails } from './opencode-failure.js'

/**
 * Rounds relayed since a point in time, summed. The billing identity comes from the saved
 * binding (the relay's own address is loopback), never from OpenCode's report (#207).
 */
export function summarizeRelayedUsage(
  values: readonly AgentProviderUsage[],
  billingProvider: AgentProviderUsage['billingProvider'],
): AgentProviderUsage | undefined {
  if (!values.length) return undefined
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheMissTokens') => values.reduce((n, u) => n + (u[key] ?? 0), 0)
  const missingUsageCount = values.filter((u) => u.inputTokens === undefined || u.outputTokens === undefined || u.usageCompleteness === 'partial').length
  // A price needs every round's cache split; one unknown round leaves the whole session unpriced.
  const cacheComplete = !missingUsageCount && values.every((u) => u.cacheStatus === 'complete')
  return {
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'),
    ...(cacheComplete ? { cacheMissTokens: sum('cacheMissTokens') } : {}),
    cacheStatus: cacheComplete ? 'complete' : 'unknown',
    ...(billingProvider ? { billingProvider } : {}),
    budgetAttemptIds: values.flatMap((u) => u.budgetAttemptIds ?? []),
    missingUsageCount,
  }
}

const NOT_SENT_USAGE: AgentProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheMissTokens: 0, cacheStatus: 'complete' }

/** OpenCode's internal model rounds traverse this authenticated, loopback-only relay. */
export async function createGovernedOpencodeProxy(input:{binding:OpencodeProviderBinding;projectId:string;governance:ModelCallGovernance;fetcher?:typeof fetch;approvalId?:string;maxOutputTokens?:number;resolveOperation?:()=>Promise<NonNullable<ModelCallQuote['operation']>>}) {
  if (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)) throw new Error('Invalid relay output limit')
  const token=randomBytes(32).toString('hex')
  const executionId = randomBytes(16).toString('hex')
  let sequence = 0
  let latestCall: { sequence: number; requestId: string; failure?: StageAgentFailureDetails } | undefined
  const {billingProvider}=modelCallMetadata(input.binding)
  const attempts:Array<{at:string;sequence:number;usage:AgentProviderUsage}>=[]
  const controllers=new Set<AbortController>()
  const pending = new Set<Promise<void>>()
  const activeCalls = new Set<number>()
  let closePromise: Promise<void> | undefined
  const server=createServer(async(req,res)=>{
    let finished!: () => void
    const completion = new Promise<void>((resolve) => { finished = resolve })
    pending.add(completion)
    let call: typeof latestCall
    const controller=new AbortController(); controllers.add(controller)
    const abort=()=>{if(!res.writableEnded)controller.abort()}
    res.on('close',abort)
    let timeout: ReturnType<typeof setTimeout> | undefined
    const resetIdleTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 300_000) }
    try {
      if (req.method!=='POST' || req.url!=='/v1/chat/completions' || req.headers.authorization!==`Bearer ${token}`) {res.writeHead(403).end();return}
      call = { sequence: ++sequence, requestId: `${executionId}:${sequence}` }
      latestCall = call
      activeCalls.add(call.sequence)
      let size = 0; const chunks: Buffer[] = []
      for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 4 * 1024 * 1024) throw new Error('模型请求超过接收容量。'); chunks.push(bytes) }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      const body=JSON.parse(raw) as Record<string,unknown>
      if(body.model!==input.binding.modelId)throw new Error('OpenCode 模型与当前项目选择不一致。')
      const requested = body.max_tokens ?? body.max_completion_tokens
      const explicit = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? requested : undefined
      const policy = resolveRequestPolicy({ model: input.binding.modelId, baseUrl: input.binding.baseUrl,
        ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: Math.min(explicit ?? input.maxOutputTokens, input.maxOutputTokens) } : explicit !== undefined ? { maxOutputTokens: explicit } : {}) })
      body.max_tokens = policy.maxOutputTokens
      delete body.max_completion_tokens
      const operation = input.resolveOperation ? await input.resolveOperation() : {
        id: `opencode-${executionId}`, version: createHash('sha256').update(input.binding.fingerprint).digest('hex'), purpose: 'native-tool',
      }
      const result=await governedModelCall({governance:input.governance,projectId:input.projectId,provider:modelCallMetadata(input.binding),prompt:raw,signal:controller.signal,
        operation, ...(policy.capability === 'deepseek-2026-10-10' ? { boundBasis: 'deepseek-context-v1' as const } : {}),
        ...(input.approvalId?{approvalId:input.approvalId}:{}),
        ...(typeof body.max_tokens==='number'?{maxOutputTokens:body.max_tokens}:{}),action:async(observe)=>{
          resetIdleTimeout()
          // The shared reader preserves observed usage independently from downstream parsing.
          let upstream: Response
          try {
            upstream=await (input.fetcher??fetch)(`${input.binding.baseUrl.replace(/\/$/u,'')}/chat/completions`,{
              method:'POST',headers:{authorization:`Bearer ${input.binding.apiKey}`,'content-type':'application/json'},redirect:'error',signal:controller.signal,
              body:JSON.stringify({...body,stream:policy.stream,stream_options:policy.stream ? { include_usage: true } : undefined})})
          } catch (error) {
            // Cancellation is settled by governedModelCall; a transport failure is classified like
            // the direct Provider path, so a connection that never opened is not billed (#208).
            if (controller.signal.aborted) throw error
            throw classifyProviderTransportError(error)
          }
          if(!upstream.ok)throw new AgentProviderRequestError({code:upstream.status===429?'http_429':upstream.status>=500?'http_5xx':'http_4xx',httpStatus:upstream.status,deliveryState:'response_received',billingState:'unknown',retryable:false,sanitizedCause:'opencode_provider_http'})
          let usage: AgentProviderUsage | undefined
          let value: Record<string, unknown>
          try {
            value = (await readProviderResponse({ response: upstream, signal: controller.signal, policy,
              onProgress: resetIdleTimeout,
              onUsage: async (rawUsage, final) => {
                try { usage = parseOpenAiCompatibleProviderUsage(rawUsage, { providerId: input.binding.providerId, model: input.binding.modelId, baseUrl: input.binding.baseUrl }) }
                catch { throw new AgentProviderRequestError({ code: 'invalid_usage', deliveryState: 'response_received', billingState: 'unknown', retryable: false, sanitizedCause: 'opencode_invalid_usage' }) }
                if (usage) { usage = { ...usage, usageCompleteness: final ? 'final' : 'partial' }; await observe(usage) }
              },
            })).body
          } catch (error) {
            if (error instanceof ProviderResponseReadError) throw new AgentProviderRequestError({
              code: error.code === 'response_too_large' ? 'response_too_large' : 'invalid_response_json', httpStatus: upstream.status,
              deliveryState: 'response_received', billingState: usage?.usageCompleteness === 'final' ? 'confirmed' : 'unknown', retryable: false,
              sanitizedCause: `opencode_${error.code}`, ...(usage ? { usage } : {}),
              responseMetadata: { httpStatus: upstream.status, ...error.diagnostics, maxOutputTokens: policy.maxOutputTokens },
            })
            throw error
          }
          return {value,...(usage?{usage}:{})}
        }})
      attempts.push({at:new Date().toISOString(),sequence:call.sequence,usage:result.usage!})
      if(res.destroyed)return
      if(body.stream===true){
        const choices=Array.isArray(result.value.choices)?result.value.choices:[]
        res.writeHead(200,{'content-type':'text/event-stream'})
        for(const choice of choices)res.write(`data: ${JSON.stringify({...result.value,object:'chat.completion.chunk',usage:undefined,choices:[{index:choice.index??0,delta:{...choice.message,...(Array.isArray(choice.message?.tool_calls)?{tool_calls:choice.message.tool_calls.map((call:Record<string,unknown>,index:number)=>({...call,index}))}:{})},finish_reason:null}]})}\n\n`)
        res.write(`data: ${JSON.stringify({...result.value,object:'chat.completion.chunk',choices:choices.map((choice)=>({index:choice.index??0,delta:{},finish_reason:choice.finish_reason}))})}\n\ndata: [DONE]\n\n`)
        res.end()
      } else res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result.value))
    } catch(error) {
      if(error instanceof AgentProviderRequestError && error.usage?.budgetAttemptIds) attempts.push({at:new Date().toISOString(),sequence:call!.sequence,
        // A round that was never sent costs nothing; it must not leave the session's usage unknown.
        usage:error.billingState==='not_incurred'?{...NOT_SENT_USAGE,budgetAttemptIds:error.usage.budgetAttemptIds}:error.usage})
      const details = error instanceof AgentProviderRequestError ? providerFailureDetails(error) : stageAgentFailureDetails('unknown_failure', 'budget_relay')
      if (call) call.failure = { ...details, relayRequestId: call.requestId }
      if(!res.destroyed){res.writeHead(400,{'content-type':'application/json', ...(call ? { 'x-devflow-relay-request': call.requestId } : {})}).end(JSON.stringify({error:{message:describeStageAgentFailure(details)}}))}
    } finally {clearTimeout(timeout);controllers.delete(controller);res.off('close',abort);if(call)activeCalls.delete(call.sequence);pending.delete(completion);finished()}
  })
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const address=server.address();if(!address || typeof address==='string')throw new Error('Budget relay unavailable')
  return {
    binding:{...input.binding,baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:token},
    usageSince(since:string):AgentProviderUsage|undefined {
      return summarizeRelayedUsage(attempts.filter((row)=>row.at>=since).map((row)=>row.usage),billingProvider)
    },
    checkpoint: () => sequence,
    usageAfter(afterSequence: number): AgentProviderUsage | undefined {
      const completed = attempts.filter((row) => row.sequence > afterSequence)
      const unsettled = [...activeCalls].filter((id) => id > afterSequence && !completed.some((row) => row.sequence === id))
      return summarizeRelayedUsage([...completed.map((row) => row.usage), ...unsettled.map(() => ({}))], billingProvider)
    },
    failureForRequest(requestId: string, afterSequence: number): StageAgentFailureDetails | undefined {
      // A prior retry, another execution, or an older concurrent completion cannot win.
      return latestCall && latestCall.sequence > afterSequence && latestCall.requestId === requestId
        ? latestCall.failure : undefined
    },
    close(){
      if (closePromise) return closePromise
      closePromise = (async () => {
        for(const controller of controllers)controller.abort()
        server.closeAllConnections()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.all([new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())), ...pending]),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Budget relay cleanup timed out')), 5_000) }),
          ])
        } finally { clearTimeout(timer) }
      })()
      return closePromise
    },
  }
}

export type GovernedOpencodeProxy = Awaited<ReturnType<typeof createGovernedOpencodeProxy>>
