// Small operator/controller for the already running real Electron. Each mutating action is explicit.
// Usage: node scripts/devflow-b-live-actions.mjs /absolute/ready.json status|generate|review|... [input.json]
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
const [readyFile, action='status', inputFile] = process.argv.slice(2)
assert(readyFile, 'Provide the isolated B ready.json')
const ready = JSON.parse(await readFile(readyFile,'utf8'))
assert(ready.output && ready.schema.startsWith('b_live_') && new URL(ready.cdpUrl).hostname==='127.0.0.1')
const input = inputFile ? JSON.parse(await readFile(inputFile,'utf8')) : {}
const paid = new Set(['generate','review','code','permission','answer','retry'])
if(paid.has(action)) {
  assert.equal(process.env.DEVFLOW_B_LIVE_AUTHORIZED,'1','Explicit real-model authorization required')
  const gateway=JSON.parse(await readFile(ready.gatewayConfig,'utf8'));assert(gateway.url,'Enable the separate B gateway first')
  const endpoint=new URL(gateway.url);assert.equal(endpoint.hostname,'127.0.0.1')
  const budget=await(await fetch(new URL('/budget',endpoint))).json()
  assert.equal(budget.scope,'devflow-b-20261023');assert.equal(budget.cap_cny,8)
  assert.equal(budget.closed,false);assert.equal(budget.blocked,false)
}
const version=await(await fetch(new URL('/json/version',ready.cdpUrl))).json()
const browser=await chromium.connectOverCDP(version.webSocketDebuggerUrl)
try {
  const page=browser.contexts().flatMap(context=>context.pages()).find(item=>item.url().includes('index.html'))
    ?? browser.contexts()[0].pages()[0]
  assert(page,'Electron renderer is missing')
  const result=await page.evaluate(async({ready,action,input})=>{
    const api=window.aiDevFlowDesktop;if(!api)throw Error('Real desktop preload unavailable')
    let state=await api.loadState();const run=state.runs.find(item=>item.id===ready.runId);if(!run)throw Error('B Run missing')
    const current=run.nodes.find(item=>item.id===run.currentNodeId)
    const base={runId:run.id,nodeId:current?.id,projectId:ready.projectId}
    if(action==='status')return {run,current,codingRuns:state.codingRuns.filter(item=>item.runId===run.id),
      permissions:state.codingPermissionRequests.filter(item=>item.runId===run.id||state.codingRuns.some(coding=>coding.runId===run.id&&coding.id===item.codingRunId)),
      artifacts:state.artifacts.filter(item=>item.runId===run.id),testEvidence:state.testEvidence.filter(item=>item.runId===run.id),
      pairing:await api.loadDesktopPairing(),configuration:await api.getCodingRuntimeConfiguration({projectId:ready.projectId})}
    if(action==='configure'){
      const discovery=await api.detectCodingRuntimeEngines({projectId:ready.projectId})
      const executor=input.executor??'opencode-http'
      if(executor==='opencode-http'){
        const candidate=discovery.candidates.find(item=>item.status==='available'&&item.binaryPath)
        if(!candidate)throw Error('No available OpenCode engine')
        await api.saveCodingRuntimeConfiguration({projectId:ready.projectId,executor,providerId:ready.providerId,
          modelId:'deepseek-flash',binaryPath:candidate.binaryPath,detectedVersion:candidate.version})
      }else if(executor==='native-model')await api.saveCodingRuntimeConfiguration({projectId:ready.projectId,executor,providerId:ready.providerId})
      else throw Error('Unknown executor')
      await api.saveSettings({selectedAgentProviderId:ready.providerId,knowledgeReviewExecutor:'native-agent'})
      return {discovery,configuration:await api.getCodingRuntimeConfiguration({projectId:ready.projectId})}
    }
    if(action==='generate'){
      if(current?.kind!=='agent')throw Error('Current node is not a stage agent')
      return api.completeWorkflowAgentNode({runId:run.id,nodeId:current.id,userId:ready.userId,userName:'B validation operator',providerId:ready.providerId,executor:input.executor??'direct-provider'})
    }
    if(action==='review')return api.runKnowledgeReview({...base,requestedBy:ready.userId,runtime:'electron',providerId:ready.providerId,executor:'native-agent'})
    if(action==='approve-gate'){
      if(!input.reviewed)throw Error('Explicit reviewed:true required after reading saved materials')
      const request={runId:run.id,nodeId:current.id}
      if(current.stage==='clarify'){
        const artifact=state.artifacts.find(item=>current.artifactIds.includes(item.id)&&item.clarificationRevision)
        if(!artifact)throw Error('Linked clarification revision is missing')
        request.expectedClarificationRevision={artifactId:artifact.id,revision:artifact.clarificationRevision.revision,revisionDigest:artifact.clarificationRevision.revisionDigest}
      }else if(current.stage==='design'){
        const artifact=state.artifacts.find(item=>current.artifactIds.includes(item.id)&&item.kind==='design')
        if(!artifact)throw Error('Linked design revision is missing')
        const bytes=new TextEncoder().encode(JSON.stringify({title:artifact.title,summary:artifact.summary,content:artifact.content}))
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
        request.expectedDesignRevision={artifactId:artifact.id,updatedAt:artifact.updatedAt,contentDigest:digest}
      }
      return api.approveGate(request)
    }
    if(action==='code')return api.runCodingAgent({...base,requestedBy:ready.userId,userInstruction:input.userInstruction??run.request})
    if(action==='permission'){
      if(!input.requestId||!input.codingRunId||!input.reviewed)throw Error('Explicit exact permission and reviewed:true required')
      const permission=state.codingPermissionRequests.find(item=>item.id===input.requestId&&item.codingRunId===input.codingRunId)
      if(!permission||permission.status!=='pending')throw Error('Pending permission no longer matches')
      return api.replyCodingPermission({requestId:input.requestId,codingRunId:input.codingRunId,decidedBy:ready.userId,
        decision:input.decision??'approved',comment:input.comment??'Reviewed for isolated authorized B validation',scope:'once'})
    }
    if(action==='answer')return api.replyCodingQuestion(input)
    if(action==='cancel')return api.cancelCodingAgentRun({codingRunId:input.codingRunId})
    if(action==='preview')return api.getCodingChangeSetPreview(input)
    if(action==='tests'){
      const node=run.nodes.find(item=>item.kind==='test');if(!node)throw Error('Test node missing')
      return api.runProjectTests({projectId:ready.projectId,runId:run.id,nodeId:node.id})
    }
    if(action==='draft')return api.createPrDraft({runId:run.id,nodeId:current.id})
    if(action==='acceptance')return api.createAcceptanceBundle({runId:run.id,nodeId:current.id})
    if(action==='prepare-delivery')return api.prepareGitHubDelivery(input)
    if(action==='resume-delivery')return api.resumeGitHubDelivery(input)
    if(action==='retry')return api.startRetryAttempt(input)
    throw Error('Unsupported action')
  },{ready,action,input})
  const output=path.join(ready.output,`${Date.now()}-${action}.json`)
  await writeFile(output,JSON.stringify(result,null,2),{mode:0o600})
  await page.screenshot({path:output.replace(/\.json$/,'.png'),fullPage:true})
  console.log(JSON.stringify({action,output,current:result.current?{stage:result.current.stage,kind:result.current.kind,status:result.current.status}:undefined,
    runStatus:result.run?.status,codingStatus:result.codingRun?.status,reviewStatus:result.review?.status}))
}catch(error){
  const output=path.join(ready.output,`${Date.now()}-${action}-failure.json`)
  await writeFile(output,JSON.stringify({action,recordedAt:new Date().toISOString(),
    error:{name:error?.name??'Error',message:String(error?.message??error)}},null,2),{mode:0o600})
  const page=browser.contexts().flatMap(context=>context.pages()).find(item=>item.url().includes('index.html'))
  await page?.screenshot({path:output.replace(/\.json$/,'.png'),fullPage:true}).catch(()=>undefined)
  console.error(JSON.stringify({action,output,error:String(error?.message??error)}))
  process.exitCode=1
}finally{await browser.close()}
