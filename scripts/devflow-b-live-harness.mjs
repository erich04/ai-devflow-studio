// Non-billed preparation by default. Creates one isolated Web→Electron Todo request.
// The model gateway remains disabled until the operator sets gateway.json to its B ledger URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { createTodoFixture, requestTitle, requestBody } from './devflow-b-todo-fixture.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const environment = path.resolve(process.env.DEVFLOW_B_ENVIRONMENT ?? path.join(root, '.tmp/devflow-b-20261023'))
const scenario = process.env.DEVFLOW_B_SCENARIO ?? 'opencode'
assert(['opencode', 'no-opencode'].includes(scenario))
const stamp = Date.now()
const output = path.resolve(process.env.DEVFLOW_B_OUTPUT ?? path.join(environment, `${scenario}-${stamp}`))
await mkdir(output, { recursive: true, mode: 0o700 })
await access(path.join(root, 'apps/desktop/dist-electron/main.js'))
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { Pool } = requireApi('pg')
const postgres = JSON.parse(await readFile(path.join(environment, 'postgres.json'), 'utf8'))
assert.equal(postgres.container, 'devflow-b-20261023')
const schema = `b_live_${stamp}`
const databaseUrl = new URL(postgres.databaseUrl)
databaseUrl.searchParams.set('options', `-c search_path=${schema}`)
const admin = new Pool({ connectionString: postgres.databaseUrl })
const children = []; let desktop; let browser; let stopRequested = false
const report = { scope: 'devflow-b-20261023', scenario, output, schema, startedAt: new Date().toISOString(),
  steps: [], modelRequestsStartedByHarness: 0, workflowCompleted: false, deliveryPublished: false }
const save = async () => writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
const step = async (name, details = {}) => { report.steps.push({ name, at: new Date().toISOString(), ...details }); await save(); console.log(JSON.stringify({ step: name, ...details })) }
async function port() { const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const result=server.address().port; await new Promise(resolve=>server.close(resolve)); return result }
function start(name, args, env) {
  const child = spawn('corepack', args, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore','pipe','pipe'] })
  children.push(child); let log = ''
  for(const pipe of [child.stdout,child.stderr]) pipe.on('data', data => { log=(log+data.toString()).slice(-2_000_000); void writeFile(path.join(output,`${name}.log`),log,{mode:0o600}) })
  return child
}
async function ready(url) {
  for(let attempt=0;attempt<120;attempt++){ try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return}catch{} await new Promise(resolve=>setTimeout(resolve,500)) }
  throw new Error(`Service unavailable: ${new URL(url).origin}`)
}
async function stop(child) {
  if(child.exitCode!==null||child.signalCode!==null)return
  try{process.kill(-child.pid,'SIGTERM')}catch{}
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))])
  if(child.exitCode===null)try{process.kill(-child.pid,'SIGKILL')}catch{}
}
process.on('SIGINT',()=>{stopRequested=true});process.on('SIGTERM',()=>{stopRequested=true})
try {
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const migration=start('migration',['pnpm','--filter','@ai-devflow/api','db:migrate'],{DEVFLOW_DATABASE_URL:databaseUrl.toString()})
  assert.equal(await new Promise(resolve=>migration.once('exit',resolve)),0,'Dedicated schema migration failed')
  const apiPort=await port(), webPort=await port(), cdpPort=await port()
  const apiUrl=`http://127.0.0.1:${apiPort}`, webUrl=`http://127.0.0.1:${webPort}`
  const common={DEVFLOW_DEPLOYMENT_PROFILE:'development', DEVFLOW_ENABLE_DEMO_DATA:'false',DEVFLOW_ENABLE_FAKE_RUNTIME:'false',
    DEVFLOW_LOCAL_AUTH_ENABLED:'true',DEVFLOW_REQUIRE_AUTH:'true',DEV_AUTH_ENABLED:'false',
    DEVFLOW_SESSION_SECRET:randomBytes(32).toString('hex'),DEVFLOW_WEB_APP_URL:webUrl,
    DEVFLOW_DATABASE_URL:databaseUrl.toString(),DEVFLOW_API_BASE_URL:apiUrl,NEXT_PUBLIC_DEVFLOW_API_URL:apiUrl,DEVFLOW_NEXT_DIST_DIR:`.tmp/next-${schema}`}
  start('api',['pnpm','--filter','@ai-devflow/api','exec','tsx','src/server.ts'],{...common,HOST:'127.0.0.1',PORT:String(apiPort)})
  await ready(`${apiUrl}/ready`)
  start('web',['pnpm','--filter','@ai-devflow/web','exec','next','dev','-H','127.0.0.1','-p',String(webPort)],common)
  await ready(`${webUrl}/health`)
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage()
  await page.goto(webUrl);await page.getByRole('button',{name:'使用本地开发身份'}).click()
  await page.getByRole('button',{name:'创建团队项目'}).click()
  const dialog=page.getByRole('dialog',{name:'创建团队项目'})
  for(const [label,value] of Object.entries({项目名称:'B 合成 Todo 验证','项目标识（Slug）':'devflow-b-todo',仓库:'fixture/devflow-b-todo',项目描述:'Isolated B package end-to-end validation'}))await dialog.getByLabel(label,{exact:true}).fill(value)
  await dialog.getByRole('button',{name:'创建项目',exact:true}).click()
  await expect(page).toHaveURL(`${webUrl}/?projectId=p-devflow-b-todo`)
  await page.getByRole('link',{name:'项目任务',exact:true}).click()
  await expect(page).toHaveURL(`${webUrl}/?projectId=p-devflow-b-todo&view=tasks`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('团队请求标题',{exact:true}).fill(requestTitle)
  await page.getByLabel('团队请求需求说明',{exact:true}).fill(requestBody)
  await page.getByRole('button',{name:'创建团队请求',exact:true}).click()
  await expect(page.getByText('团队请求已创建。已配对的桌面端现在可以领取。')).toBeVisible()
  await page.screenshot({path:path.join(output,'01-web-request.png'),fullPage:true})
  await step('web-request-created')
  await page.goto(`${webUrl}/?projectId=p-devflow-b-todo&view=settings&section=desktop`)
  await page.getByRole('button',{name:'生成桌面配对码'}).click()
  const code=await page.getByLabel('项目 p-devflow-b-todo 的桌面配对码').innerText()
  await page.goto(`${webUrl}/?projectId=p-devflow-b-todo&view=tasks`)
  const repo=path.join(output,'todo');await createTodoFixture(repo)
  const gatewayConfig=path.join(output,'gateway.json');await writeFile(gatewayConfig,JSON.stringify({url:null}),{mode:0o600})
  const env={...process.env,...common,DEVFLOW_USER_DATA_DIR:path.join(output,'profile'),DEVFLOW_DATA_PROFILE_REGISTRY_PATH:path.join(output,'profiles.json'),
    DEVFLOW_B_HARNESS:'1',DEVFLOW_B_GATEWAY_CONFIG:gatewayConfig,DEVFLOW_B_SCENARIO:scenario}
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  if(scenario==='no-opencode')env.DEVFLOW_OPENCODE_BIN=path.join(output,'opencode-not-installed')
  desktop=await electron.launch({executablePath:requireDesktop('electron'),cwd:path.join(root,'apps/desktop'),
    args:[path.join(root,'scripts/devflow-b-electron-bootstrap.cjs'),`--remote-debugging-port=${cdpPort}`],env})
  const window=await desktop.firstWindow();await window.waitForLoadState('domcontentloaded')
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1540,1000))
  await desktop.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]})},repo)
  await window.locator('.topbar-project-menu > summary').click()
  await window.getByRole('button',{name:'选择本地仓库'}).click()
  const intake=await window.evaluate(async({code,repo,title})=>{
    const api=window.aiDevFlowDesktop;const state=await api.loadState();const project=state.projects.find(item=>item.path===repo)
    if(!project)throw Error('B project selection failed')
    const pairing=await api.pairDesktop({code,localProjectId:project.id});await api.loadRemoteSnapshot()
    await api.saveProjectTestCommand({projectId:project.id,testCommand:'npm test'})
    const request=(await api.listWorkRequests({localProjectId:project.id})).find(item=>item.title===title)
    if(!request)throw Error('B Web request not synchronized')
    return {projectId:project.id,requestId:request.id,userId:pairing.credential.userId}
  },{code,repo,title:requestTitle})
  await window.reload();await window.getByRole('button',{name:/^任务中心/u}).click()
  const center=window.getByRole('region',{name:'任务中心',exact:true})
  await center.getByRole('button',{name:'刷新任务',exact:true}).click()
  const task=center.getByRole('article',{name:requestTitle,exact:true});await expect(task).toBeVisible()
  await task.getByRole('button',{name:requestTitle,exact:true}).click()
  await expect(window.getByRole('dialog',{name:'任务详情',exact:true})).toContainText('清除已完成')
  assert.equal((await window.evaluate(()=>window.aiDevFlowDesktop.loadState())).runs.length,0)
  await window.keyboard.press('Escape');await window.screenshot({path:path.join(output,'02-before-intake.png'),fullPage:true})
  await task.getByRole('button',{name:`领取任务：${requestTitle}`,exact:true}).click()
  await expect(window.getByTestId('workflow-canvas')).toBeVisible()
  const state=await window.evaluate(()=>window.aiDevFlowDesktop.loadState());assert.equal(state.runs.length,1)
  const run=state.runs[0];assert.equal(run.projectId,intake.projectId)
  const metadata=await window.evaluate(async()=>{
    const api=window.aiDevFlowDesktop
    const provider=await api.saveAgentProviderCredential({name:'B authorized DeepSeek via capped gateway',apiKey:'sk-synthetic-b-gateway',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',thinking:{mode:'enabled',effort:'low'}})
    await api.saveSettings({selectedAgentProviderId:provider.providerId,knowledgeReviewExecutor:'native-agent'})
    return provider
  })
  await ready(`http://127.0.0.1:${cdpPort}/json/version`)
  await window.screenshot({path:path.join(output,'03-electron-intake.png'),fullPage:true})
  const data={...intake,runId:run.id,providerId:metadata.providerId,repo,scenario,output,schema,apiUrl,webUrl,
    cdpUrl:`http://127.0.0.1:${cdpPort}`,gatewayConfig,profile:env.DEVFLOW_USER_DATA_DIR}
  await writeFile(path.join(output,'ready.json'),JSON.stringify(data,null,2),{mode:0o600})
  report.ready=data;await step('ready-with-zero-model-calls',data)
  // Operator/root can use the real window via CDP and scripts/devflow-b-live-actions.mjs.
  // Both business state and Postgres schema survive stopping; no acceptance is fabricated.
  while(!stopRequested){try{await access(path.join(output,'STOP'));break}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}
} catch(error) {
  report.failure={name:error.name,message:String(error.message).slice(0,1200)};await save();throw error
} finally {
  await desktop?.close().catch(()=>{});await browser?.close().catch(()=>{})
  for(const child of children.reverse())await stop(child)
  await admin.end();report.stoppedAt=new Date().toISOString();await save()
}
