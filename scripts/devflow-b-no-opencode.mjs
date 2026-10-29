// Independent Electron profile/project on B's existing dedicated Team API/Web services.
// Avoid starting another Next dev server in the same checkout. This script makes no model call.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { createTodoFixture } from './devflow-b-todo-fixture.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)), requireDesktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url))
const base=JSON.parse(await readFile(process.argv[2],'utf8'))
const output=path.join(path.dirname(base.output),`no-opencode-${Date.now()}`)
await mkdir(output,{recursive:true,mode:0o700})
const slug=`b-readonly-${Date.now()}`, title='B 验证：无 OpenCode 内置仓库审查'
const repo=path.join(output,'todo');await createTodoFixture(repo)
const gatewayConfig=path.join(output,'gateway.json');await writeFile(gatewayConfig,JSON.stringify({url:null}),{mode:0o600})
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const cdpPort=socket.address().port;await new Promise(resolve=>socket.close(resolve))
let browser,desktop,stopped=false
process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true})
try{
  browser=await chromium.launch();const page=await browser.newPage()
  await page.goto(base.webUrl)
  await page.getByRole('button',{name:'使用本地开发身份'}).click()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button',{name:'创建团队项目'}).click()
  const dialog=page.getByRole('dialog',{name:'创建团队项目'})
  for(const[label,value]of Object.entries({项目名称:'B 无OpenCode审查','项目标识（Slug）':slug,仓库:'fixture/b-readonly',项目描述:'Isolated native read-only review with no discoverable OpenCode'}))await dialog.getByLabel(label,{exact:true}).fill(value)
  await dialog.getByRole('button',{name:'创建项目',exact:true}).click();await expect(page).toHaveURL(`${base.webUrl}/?projectId=p-${slug}`,{timeout:30000})
  await page.getByRole('link',{name:'项目任务',exact:true}).click();await page.waitForLoadState('networkidle')
  await page.getByLabel('团队请求标题',{exact:true}).fill(title)
  await page.getByLabel('团队请求需求说明',{exact:true}).fill('审查合成 Todo 仓库中的现有新增、切换和删除逻辑。需求与方案各不超过500汉字。审查必须实际读取src/store.js、src/app.js及test/store.test.js，列出存在问题或说明未发现问题并引用真实行范围。不修改文件、不执行Shell、不批准Gate。')
  await page.getByRole('button',{name:'创建团队请求',exact:true}).click();await expect(page.getByText('团队请求已创建。已配对的桌面端现在可以领取。')).toBeVisible()
  await page.goto(`${base.webUrl}/?projectId=p-${slug}&view=settings&section=desktop`)
  await page.getByRole('button',{name:'生成桌面配对码'}).click();const code=await page.getByLabel(`项目 p-${slug} 的桌面配对码`).innerText()
  await page.goto(`${base.webUrl}/?projectId=p-${slug}&view=tasks`)
  const env={...process.env,DEVFLOW_B_HARNESS:'1',DEVFLOW_B_GATEWAY_CONFIG:gatewayConfig,DEVFLOW_API_BASE_URL:base.apiUrl,
    DEVFLOW_USER_DATA_DIR:path.join(output,'profile'),DEVFLOW_DATA_PROFILE_REGISTRY_PATH:path.join(output,'profiles.json'),
    DEVFLOW_OPENCODE_BIN:path.join(output,'opencode-not-installed'),DEVFLOW_ENABLE_FAKE_RUNTIME:'false',DEVFLOW_ENABLE_DEMO_DATA:'false'}
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
  desktop=await electron.launch({executablePath:requireDesktop('electron'),cwd:path.join(root,'apps/desktop'),args:[path.join(root,'scripts/devflow-b-electron-bootstrap.cjs'),`--remote-debugging-port=${cdpPort}`],env})
  const window=await desktop.firstWindow();await window.waitForLoadState('domcontentloaded')
  await desktop.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]})},repo)
  await window.locator('.topbar-project-menu > summary').click();await window.getByRole('button',{name:'选择本地仓库'}).click()
  const intake=await window.evaluate(async({code,repo,title})=>{
    const api=window.aiDevFlowDesktop, state=await api.loadState(), project=state.projects.find(item=>item.path===repo)
    if(!project)throw Error('Missing isolated project')
    const pairing=await api.pairDesktop({code,localProjectId:project.id});await api.loadRemoteSnapshot()
    const request=(await api.listWorkRequests({localProjectId:project.id})).find(item=>item.title===title)
    return {projectId:project.id,requestId:request.id,userId:pairing.credential.userId}
  },{code,repo,title})
  await window.reload();await window.getByRole('button',{name:/^任务中心/u}).click()
  const center=window.getByRole('region',{name:'任务中心',exact:true});await center.getByRole('button',{name:'刷新任务',exact:true}).click()
  await center.getByRole('button',{name:`领取任务：${title}`,exact:true}).click();await expect(window.getByTestId('workflow-canvas')).toBeVisible()
  const data=await window.evaluate(async({projectId})=>{
    const api=window.aiDevFlowDesktop
    const provider=await api.saveAgentProviderCredential({name:'B no-OpenCode official DeepSeek',apiKey:'sk-synthetic-b-gateway',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',thinking:{mode:'enabled',effort:'low'}})
    await api.saveCodingRuntimeConfiguration({projectId,executor:'native-model',providerId:provider.providerId})
    await api.saveSettings({selectedAgentProviderId:provider.providerId,knowledgeReviewExecutor:'native-agent'})
    const discovery=await api.detectCodingRuntimeEngines({projectId})
    if(discovery.candidates.some(item=>item.status==='available'))throw Error('OpenCode unexpectedly available')
    const state=await api.loadState();return {providerId:provider.providerId,runId:state.runs[0].id,discovery}
  },intake)
  const ready={...base,...intake,...data,repo,scenario:'no-opencode',output,gatewayConfig,profile:env.DEVFLOW_USER_DATA_DIR,cdpUrl:`http://127.0.0.1:${cdpPort}`,teamProjectId:`p-${slug}`}
  await writeFile(path.join(output,'ready.json'),JSON.stringify(ready,null,2),{mode:0o600})
  await window.screenshot({path:path.join(output,'01-ready-no-opencode.png'),fullPage:true})
  console.log(JSON.stringify({readyFile:path.join(output,'ready.json'),cdpUrl:ready.cdpUrl,discovery:data.discovery,providerCalls:0}))
  while(!stopped){try{await access(path.join(output,'STOP'));break}catch{}await new Promise(resolve=>setTimeout(resolve,1000))}
}finally{await desktop?.close().catch(()=>{});await browser?.close().catch(()=>{})}
