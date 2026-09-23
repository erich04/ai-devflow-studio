import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { AgentProviderRequestError, governedModelCall, modelCallMetadata, parseOpenAiCompatibleProviderUsage, type AgentProviderUsage, type ModelCallGovernance } from '@ai-devflow/shared'
import type { OpencodeProviderBinding } from './opencode-provider-binding'

/** OpenCode's internal model rounds traverse this authenticated, loopback-only relay. */
export async function createGovernedOpencodeProxy(input:{binding:OpencodeProviderBinding;projectId:string;governance:ModelCallGovernance;fetcher?:typeof fetch}) {
  const token=randomBytes(32).toString('hex')
  const attempts:Array<{at:string;usage:AgentProviderUsage}>=[]
  const controllers=new Set<AbortController>()
  const server=createServer(async(req,res)=>{
    const controller=new AbortController(); controllers.add(controller)
    const abort=()=>{if(!res.writableEnded)controller.abort()}
    res.on('close',abort)
    const timeout=setTimeout(()=>controller.abort(),300_000)
    try {
      if (req.method!=='POST' || req.url!=='/v1/chat/completions' || req.headers.authorization!==`Bearer ${token}`) {res.writeHead(403).end();return}
      let size = 0; const chunks: Buffer[] = []
      for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 2 * 1024 * 1024) throw new Error('模型请求超过接收容量。'); chunks.push(bytes) }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      const body=JSON.parse(raw) as Record<string,unknown>
      if(body.model!==input.binding.modelId)throw new Error('OpenCode 模型与当前项目选择不一致。')
      const result=await governedModelCall({governance:input.governance,projectId:input.projectId,provider:modelCallMetadata(input.binding),prompt:raw,signal:controller.signal,
        ...(typeof body.max_tokens==='number'?{maxOutputTokens:body.max_tokens}:{}),action:async()=>{
          // Buffer one bounded provider response so usage survives downstream cancellation/parsing.
          const upstream=await (input.fetcher??fetch)(`${input.binding.baseUrl.replace(/\/$/u,'')}/chat/completions`,{
            method:'POST',headers:{authorization:`Bearer ${input.binding.apiKey}`,'content-type':'application/json'},redirect:'error',signal:controller.signal,
            body:JSON.stringify({...body,stream:false,stream_options:undefined})})
          if(!upstream.ok)throw new AgentProviderRequestError({code:upstream.status===429?'http_429':upstream.status>=500?'http_5xx':'http_4xx',httpStatus:upstream.status,deliveryState:'response_received',billingState:'unknown',retryable:false,sanitizedCause:'opencode_provider_http'})
          let output=''; const decoder=new TextDecoder('utf-8',{fatal:true}); const reader=upstream.body?.getReader()
          if(!reader)throw new Error('模型未返回正文。')
          try{while(true){const next=await reader.read();if(next.done)break;output+=decoder.decode(next.value,{stream:true});if(Buffer.byteLength(output)>2*1024*1024)throw new Error('模型响应超过安全接收容量。')}}finally{await reader.cancel().catch(()=>undefined)}
          output+=decoder.decode();
          const value=JSON.parse(output) as Record<string,unknown>
          const usage=parseOpenAiCompatibleProviderUsage(value.usage,{providerId:input.binding.providerId,model:input.binding.modelId,baseUrl:input.binding.baseUrl})
          return {value,...(usage?{usage}:{})}
        }})
      attempts.push({at:new Date().toISOString(),usage:result.usage!})
      if(res.destroyed)return
      if(body.stream===true){
        const choices=Array.isArray(result.value.choices)?result.value.choices:[]
        res.writeHead(200,{'content-type':'text/event-stream'})
        for(const choice of choices)res.write(`data: ${JSON.stringify({...result.value,object:'chat.completion.chunk',usage:undefined,choices:[{index:choice.index??0,delta:{...choice.message,...(Array.isArray(choice.message?.tool_calls)?{tool_calls:choice.message.tool_calls.map((call:Record<string,unknown>,index:number)=>({...call,index}))}:{})},finish_reason:null}]})}\n\n`)
        res.write(`data: ${JSON.stringify({...result.value,object:'chat.completion.chunk',choices:choices.map((choice)=>({index:choice.index??0,delta:{},finish_reason:choice.finish_reason}))})}\n\ndata: [DONE]\n\n`)
        res.end()
      } else res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result.value))
    } catch(error) {
      if(error instanceof AgentProviderRequestError && error.usage?.budgetAttemptIds) attempts.push({at:new Date().toISOString(),usage:error.usage})
      if(!res.destroyed){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{message:error instanceof Error && /^[\u4e00-\u9fff]/u.test(error.message)?error.message:'模型调用未完成，请检查项目预算和执行记录。'}}))}
    } finally {clearTimeout(timeout);controllers.delete(controller);res.off('close',abort)}
  })
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const address=server.address();if(!address || typeof address==='string')throw new Error('Budget relay unavailable')
  return {
    binding:{...input.binding,baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:token},
    usageSince(since:string):AgentProviderUsage|undefined {
      const values=attempts.filter((row)=>row.at>=since).map((row)=>row.usage)
      if(!values.length)return undefined
      return {inputTokens:values.reduce((n,u)=>n+(u.inputTokens??0),0),outputTokens:values.reduce((n,u)=>n+(u.outputTokens??0),0),cacheReadTokens:values.reduce((n,u)=>n+(u.cacheReadTokens??0),0),
        budgetAttemptIds:values.flatMap((u)=>u.budgetAttemptIds??[]),missingUsageCount:values.filter((u)=>u.inputTokens===undefined||u.outputTokens===undefined).length}
    },
    async close(){for(const controller of controllers)controller.abort();server.closeAllConnections();await new Promise<void>((resolve)=>server.close(()=>resolve()))},
  }
}
