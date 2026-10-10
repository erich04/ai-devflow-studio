import {describe,it,expect,vi} from 'vitest'
import {AgentProviderRequestError,waitForProviderRetry,buildAgentReviewContext,createOpenAiCompatibleAgentProvider,runKnowledgeReviewAgent} from './agent-review'
import {runs,artifacts} from './fixtures'
async function context(){const run=runs[0]!;const node=run.nodes.find(n=>n.kind==='gate')!;return {context:await buildAgentReviewContext({run,node,artifacts,testEvidence:[],knowledgeDocuments:[],knowledgeChunks:[]}),request:{id:'failure-contract',runId:run.id,nodeId:node.id,projectId:run.projectId,requestedBy:'u',runtime:'electron' as const}}}
const review={conclusion:'建议通过',summary:'完整结论',risks:[],missingEvidence:[],suggestedTests:[],confidence:.8}
describe('review output and attempt accounting (#166)',()=>{
 it.each(['length','content_filter','insufficient_system_resource'])('records billed usage before rejecting finish_reason %s',async(reason)=>{const onAttemptUsage=vi.fn();const provider=createOpenAiCompatibleAgentProvider({apiKey:'fixture',model:'gpt-4.1-mini',fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify(review)},finish_reason:reason}],usage:{prompt_tokens:99,completion_tokens:2048}})});await expect(runKnowledgeReviewAgent({...await context(),provider,onAttemptUsage})).rejects.toMatchObject({usage:{inputTokens:99,outputTokens:2048}});expect(onAttemptUsage).toHaveBeenCalledTimes(reason === 'content_filter' || reason === 'length' ? 1 : 3);expect(onAttemptUsage.mock.calls[0]![0]).toMatchObject({inputTokens:99,outputTokens:2048})})
 it('allows a valid response well beyond 2048 tokens with the resolved explicit request allowance',async()=>{let body:Record<string,unknown>={};const provider=createOpenAiCompatibleAgentProvider({apiKey:'fixture',model:'gpt-4.1-mini',fetcher:async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:JSON.stringify({...review,summary:'核验结论。'.repeat(2100)})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:8000}})}});const result=await runKnowledgeReviewAgent({...await context(),provider});expect(body).toHaveProperty('max_tokens',8192);expect(result.review.summary.length).toBeGreaterThan(5000);expect(result.tokenUsage.outputTokens).toBe(8000)})
 it('records schema failure with known usage while keeping absent usage unknown',async()=>{for(const usage of [{prompt_tokens:10,completion_tokens:20},undefined]){const onAttemptUsage=vi.fn();const provider=createOpenAiCompatibleAgentProvider({apiKey:'fixture',model:'gpt-4.1-mini',fetcher:async()=>Response.json({choices:[{message:{content:'{"summary":"incomplete"}'},finish_reason:'stop'}],...(usage?{usage}:{})})});await expect(runKnowledgeReviewAgent({...await context(),provider,onAttemptUsage})).rejects.toMatchObject({code:'invalid_model_output'});expect(onAttemptUsage).toHaveBeenCalledTimes(3);expect(onAttemptUsage.mock.calls[0]![0].costUsd===null).toBe(!usage)}})
})


it('grows a published model output allowance only on length failure and records each billed request', async () => {
  const limits: number[] = []
  const onAttemptUsage = vi.fn()
  const provider = createOpenAiCompatibleAgentProvider({ apiKey: 'fixture', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', thinking: { mode: 'disabled' }, fetcher: async (_url, init) => {
    limits.push(JSON.parse(String(init?.body)).max_tokens)
    return Response.json({ choices: [{ message: { content: JSON.stringify(review) }, finish_reason: limits.length < 3 ? 'length' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 } })
  } })
  await runKnowledgeReviewAgent({ ...await context(), provider, onAttemptUsage })
  expect(limits).toEqual([8192, 16384, 32768])
  expect(onAttemptUsage).toHaveBeenCalledTimes(3)
  expect(new Set(onAttemptUsage.mock.calls.map(call => call[0].id)).size).toBe(3)
})

it('cancels a transient backoff before another paid request can start', async () => {
  vi.useFakeTimers()
  try {
    const controller = new AbortController()
    const failure = new AgentProviderRequestError({ code: 'http_429', retryable: true, deliveryState: 'response_received', billingState: 'not_incurred', sanitizedCause: 'rate_limited' })
    const waiting = waitForProviderRetry(failure, 1, controller.signal)
    const rejected = expect(waiting).rejects.toThrow('user stopped')
    controller.abort(new Error('user stopped'))
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
