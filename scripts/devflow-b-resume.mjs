// Restart B services/profile without resetting its schema, Run, repository, or budget.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createServer } from 'node:net'
import { _electron as electron } from '@playwright/test'
import { serviceEnvironment } from './devflow-b-service-env.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)), requireDesktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url))
const ready=JSON.parse(await readFile(process.argv[2],'utf8'))
assert(ready.schema.startsWith('b_live_')&&ready.scenario==='opencode')
const postgres=JSON.parse(await readFile(path.join(path.dirname(ready.output),'postgres.json'),'utf8'))
assert.equal(postgres.container,'devflow-b-20261023')
const appSource=process.env.DEVFLOW_B_GITHUB_APP_ENV ? parseEnv(await readFile(process.env.DEVFLOW_B_GITHUB_APP_ENV,'utf8')) : undefined
// Fail before starting anything if a previous service still owns an isolated port.
for(const address of[ready.apiUrl,ready.webUrl,ready.cdpUrl]){
 const url=new URL(address);assert.equal(url.hostname,'127.0.0.1')
 await new Promise((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(Error(`B service port ${url.port} is already occupied`)));server.listen(Number(url.port),'127.0.0.1',()=>server.close(resolve))})
}
const databaseUrl=new URL(postgres.databaseUrl);databaseUrl.searchParams.set('options',`-c search_path=${ready.schema}`)
const common={DEVFLOW_DEPLOYMENT_PROFILE:'development',DEVFLOW_ENABLE_DEMO_DATA:'false',DEVFLOW_ENABLE_FAKE_RUNTIME:'false',
 DEVFLOW_LOCAL_AUTH_ENABLED:'true',DEVFLOW_REQUIRE_AUTH:'true',DEV_AUTH_ENABLED:'false',DEVFLOW_SESSION_SECRET:randomBytes(32).toString('hex'),
 DEVFLOW_WEB_APP_URL:ready.webUrl,DEVFLOW_DATABASE_URL:databaseUrl.toString(),DEVFLOW_API_BASE_URL:ready.apiUrl,NEXT_PUBLIC_DEVFLOW_API_URL:ready.apiUrl,
 DEVFLOW_NEXT_DIST_DIR:`.tmp/next-${ready.schema}`}
const children=[];let desktop,stopRequested=false
async function wait(url){for(let attempt=0;attempt<120;attempt++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,500))}throw Error(`Not ready: ${new URL(url).origin}`)}
function start(name,args,env){const child=spawn('corepack',args,{cwd:root,env:serviceEnvironment(name,process.env,env,appSource),detached:true,stdio:['ignore','pipe','pipe']});children.push(child);let text='';for(const pipe of[child.stdout,child.stderr])pipe.on('data',data=>{text=(text+data.toString()).slice(-2_000_000);void writeFile(path.join(ready.output,`resume-${name}.log`),text,{mode:0o600})});return child}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;try{process.kill(-child.pid,'SIGTERM')}catch{}await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null)try{process.kill(-child.pid,'SIGKILL')}catch{}}
for(const signal of['SIGTERM','SIGINT'])process.on(signal,()=>{stopRequested=true})
try{
 await rm(path.join(ready.output,'STOP'),{force:true})
 start('api',['pnpm','--filter','@ai-devflow/api','exec','tsx','src/server.ts'],{...common,HOST:'127.0.0.1',PORT:new URL(ready.apiUrl).port});await wait(`${ready.apiUrl}/ready`)
 start('web',['pnpm','--filter','@ai-devflow/web','exec','next','dev','-H','127.0.0.1','-p',new URL(ready.webUrl).port],common);await wait(`${ready.webUrl}/health`)
 const env=serviceEnvironment('desktop',process.env,{...common,DEVFLOW_B_HARNESS:'1',DEVFLOW_B_GATEWAY_CONFIG:ready.gatewayConfig,DEVFLOW_USER_DATA_DIR:ready.profile,DEVFLOW_DATA_PROFILE_REGISTRY_PATH:path.join(ready.output,'profiles.json')})
 delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
 desktop=await electron.launch({executablePath:requireDesktop('electron'),cwd:path.join(root,'apps/desktop'),args:[path.join(root,'scripts/devflow-b-electron-bootstrap.cjs'),`--remote-debugging-port=${new URL(ready.cdpUrl).port}`],env})
 const page=await desktop.firstWindow();await page.waitForLoadState('domcontentloaded')
 const state=await page.evaluate(()=>window.aiDevFlowDesktop.loadState())
 assert(state.runs.some(run=>run.id===ready.runId),'Original B Run was not recovered')
 await wait(`${ready.cdpUrl}/json/version`)
 console.log(JSON.stringify({resumed:true,runId:ready.runId,output:ready.output,webUrl:ready.webUrl,cdpUrl:ready.cdpUrl,modelCallsStarted:0}))
 while(!stopRequested){try{await access(path.join(ready.output,'STOP'));break}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}
}finally{await desktop?.close().catch(()=>{});for(const child of children.reverse())await stop(child)}
