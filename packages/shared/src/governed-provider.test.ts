import {describe,it,expect,vi} from 'vitest'
import {governedModelCall,governAgentProvider,type ModelCallGovernance} from './governed-provider'
import {AgentProviderRequestError,createOpenAiCompatibleAgentProvider} from './agent-review'
import type {ModelCallQuote,ModelCallSettlement} from './model-call-budget'
function fixture(){const rows=new Map<string,ModelCallSettlement>();const reserve=vi.fn(async(_quote:ModelCallQuote)=>({accepted:true,decision:{status:'allowed' as const,blocksRun:false,currentSpendUsd:0,projectedCostUsd:0,reason:'fixture'}}));const settle=vi.fn(async(s:ModelCallSettlement)=>{rows.delete(s.id)});const governance:ModelCallGovernance={reserve,settle,persist:async(s)=>{rows.set(s.id,s)},pending:async()=>[...rows.values()]};const base={governance,projectId:'p',provider:{id:'deepseek',model:'deepseek-flash',billingProvider:'deepseek' as const,defaultReviewOutputTokens:8192},prompt:'JSON'};return {base,rows,reserve,settle}}
describe('per-request governance',()=>{
 it('blocks before action and credentials when admission fails',async()=>{const f=fixture();f.reserve.mockResolvedValueOnce({accepted:false,decision:{status:'allowed',blocksRun:true,currentSpendUsd:0,projectedCostUsd:0,reason:'预算未配置'}});const action=vi.fn();await expect(governedModelCall({...f.base,action})).rejects.toThrow('尚未调用模型');expect(action).not.toHaveBeenCalled()})
 it('settles actual usage from a malformed paid response',async()=>{const f=fixture();await expect(governedModelCall({...f.base,action:async()=>{throw new AgentProviderRequestError({code:'invalid_model_output',sanitizedCause:'invalid_json',deliveryState:'response_received',billingState:'confirmed',retryable:true,usage:{inputTokens:10,outputTokens:2048}})}})).rejects.toMatchObject({usage:{inputTokens:10,outputTokens:2048,budgetAttemptIds:expect.any(Array)}});expect(f.settle).toHaveBeenCalledWith(expect.objectContaining({state:'failed',usage:{inputTokens:10,outputTokens:2048}}));expect(f.rows.size).toBe(0)})
 it('does not reconcile an in-flight concurrent call as a crashed request',async()=>{const f=fixture();let finish!:(v:{usage:{inputTokens:number;outputTokens:number}})=>void;const first=governedModelCall({...f.base,action:()=>new Promise<{usage:{inputTokens:number;outputTokens:number}}>(resolve=>{finish=resolve})});await vi.waitFor(()=>expect(f.rows.size).toBe(1));await governedModelCall({...f.base,action:async()=>({usage:{inputTokens:1,outputTokens:1}})});expect(f.settle).toHaveBeenCalledTimes(1);finish({usage:{inputTokens:2,outputTokens:2}});await first;expect(f.settle).toHaveBeenCalledTimes(2)})
 it('preserves completed content on offline settlement and replays only accounting before the next reservation',async()=>{const f=fixture();f.settle.mockRejectedValueOnce(new Error('offline'));await expect(governedModelCall({...f.base,action:async()=>({value:{text:'complete answer'},usage:{inputTokens:1,outputTokens:1}})})).resolves.toMatchObject({value:{text:'complete answer'},usage:{inputTokens:1,outputTokens:1,settlementStatus:'pending',budgetAttemptIds:expect.any(Array)}});expect(f.rows.size).toBe(1);await governedModelCall({...f.base,action:async()=>({})});expect(f.settle).toHaveBeenCalledTimes(3);expect(f.rows.size).toBe(0)})
 it('attaches accounting identity when an untyped transport failure has unknown usage',async()=>{const f=fixture();await expect(governedModelCall({...f.base,action:async()=>{throw new Error('untrusted response')}})).rejects.toMatchObject({billingState:'unknown',usage:{budgetAttemptIds:expect.any(Array)}});expect(f.settle).toHaveBeenCalledWith(expect.objectContaining({state:'failed'}))})
 it('releases a reservation without dispatch when local accounting cannot be persisted',async()=>{const f=fixture();f.base.governance.persist=async()=>{throw new Error('disk unavailable')};const action=vi.fn();await expect(governedModelCall({...f.base,action})).rejects.toMatchObject({billingState:'not_incurred'});expect(action).not.toHaveBeenCalled();expect(f.settle).toHaveBeenCalledWith(expect.objectContaining({state:'not_sent'}))})
 it('does not reserve a call cancelled before dispatch',async()=>{const f=fixture();const controller=new AbortController();controller.abort();await expect(governedModelCall({...f.base,signal:controller.signal,action:async()=>({})})).rejects.toBeDefined();expect(f.reserve).not.toHaveBeenCalled()})
})

 it('rejects oversized native history before reservation or network dispatch', async () => {
  const f=fixture(); const fetcher=vi.fn();
  const raw=createOpenAiCompatibleAgentProvider({id:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',apiKey:'fixture',fetcher});
  const provider=governAgentProvider(raw,'p',f.base.governance);
  await expect(provider.completeStructuredJson!({systemPrompt:'JSON',userPrompt:'read',nativeTools:{definitions:[],messages:[{role:'user',content:'x'.repeat(4*1024*1024)}]}})).rejects.toMatchObject({deliveryState:'not_sent',billingState:'not_incurred',retryable:false});
  expect(fetcher).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();expect(f.rows.size).toBe(0);
  await expect(governedModelCall({...f.base,action:()=>raw.completeStructuredJson!({systemPrompt:'',userPrompt:'JSON'})})).rejects.toMatchObject({deliveryState:'not_sent',billingState:'not_incurred'});
  expect(f.settle).toHaveBeenLastCalledWith(expect.objectContaining({state:'not_sent'}));expect(fetcher).not.toHaveBeenCalled();
 });
 it('keeps one authorization scope when a conversation reaches proposal generation', async () => {
  const f=fixture(); const raw={...f.base.provider,name:'fixture',reviewKnowledge:vi.fn(),completeStructuredJson:vi.fn(async()=>({value:{text:'answer'}}))};
  const provider=governAgentProvider(raw,'p',f.base.governance);
  for(const purpose of ['conversation','proposal'] as const) await provider.completeStructuredJson!({systemPrompt:'JSON',userPrompt:purpose,operationKey:'turn-1',purpose});
  expect(f.reserve.mock.calls[0]?.[0]).toMatchObject({operation:f.reserve.mock.calls[1]?.[0]?.operation});
  await provider.completeStructuredJson!({systemPrompt:'JSON',userPrompt:'next',operationKey:'turn-2',purpose:'conversation'});
  expect(f.reserve.mock.calls[2]?.[0]?.operation?.id).not.toBe(f.reserve.mock.calls[0]?.[0]?.operation?.id);
 });
