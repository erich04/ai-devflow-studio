// Real Web setting, followed by real desktop Team sync. No model call.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
const ready=JSON.parse(await readFile(process.argv[2],'utf8'))
const teamProjectId=ready.teamProjectId??'p-devflow-b-todo'
const browser=await chromium.launch()
let connected
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await page.goto(ready.webUrl)
 await page.getByRole('button',{name:'使用本地开发身份'}).click()
 await page.goto(`${ready.webUrl}/?projectId=${teamProjectId}&view=settings&section=budget`)
 await page.waitForLoadState('networkidle')
 const form=page.getByTestId('runtime-budget-policy-form')
 await form.getByLabel('启用预算',{exact:true}).check()
 // Product USD policy remains enabled. B's separate upstream CNY 8 ledger is the hard
 // shared authorization across both projects. USD 2 accommodates conservative request quotes.
 await form.getByLabel('月上限（USD）',{exact:true}).fill('2')
 await form.getByLabel('预警阈值（USD）',{exact:true}).fill('1')
 await form.getByRole('button',{name:'保存预算规则',exact:true}).click()
 await expect(form.getByRole('status')).toContainText('已保存到团队')
 await page.screenshot({path:path.join(ready.output,'budget-policy-web.png'),fullPage:true})
 const version=await(await fetch(new URL('/json/version',ready.cdpUrl))).json()
 connected=await chromium.connectOverCDP(version.webSocketDebuggerUrl)
 const desktop=connected.contexts()[0].pages()[0]
 const policy=await desktop.evaluate(async projectId=>{const api=window.aiDevFlowDesktop;await api.loadRemoteSnapshot();return api.getCodingRuntimeBudgetPolicy({projectId})},ready.projectId)
 assert.equal(policy.enabled,true);assert.equal(policy.monthlyLimitUsd,2)
 await writeFile(path.join(ready.output,'budget-policy.json'),JSON.stringify({teamProjectId,policy,gatewayHardCapCny:8,sharedAcrossBProjects:true},null,2))
 console.log(JSON.stringify({teamProjectId,enabled:policy.enabled,monthlyLimitUsd:policy.monthlyLimitUsd,warningThresholdUsd:policy.warningThresholdUsd,gatewayHardCapCny:8}))
}finally{await connected?.close();await browser.close()}
