import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const smokePath = 'scripts/electron-smoke.mjs'
const smoke = readFileSync(smokePath, 'utf8').replace(/\r\n?/g, '\n')
const rendererActions = readFileSync('apps/desktop/src/app/useDesktopActions.ts', 'utf8').replace(/\r\n?/g, '\n')

function position(marker: string) {
  const index = smoke.indexOf(marker)
  expect(index, `Missing Electron smoke marker: ${marker}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('Electron smoke V1.5 trusted workflow contract', () => {
  it('allocates an isolated runtime instead of claiming shared development ports', () => {
    expect(smoke).toContain("import { resolveE2eRuntime } from './e2e-runtime.mjs'")
    expect(smoke).toContain('} = await resolveE2eRuntime()')
    expect(smoke).toContain("PORT: String(apiPort)")
    expect(smoke).toMatch(/'-p',\s*String\(webPort\)/)
    expect(smoke).toMatch(/'@ai-devflow\/desktop',\s*'exec',\s*'vite'/)
    expect(smoke).toMatch(/'--port',\s*String\(desktopPort\)/)
    expect(smoke).not.toMatch(/'@ai-devflow\/desktop',\s*'dev',\s*'--'/)
    expect(smoke).not.toContain("const devServerUrl = 'http://127.0.0.1:5173'")
    expect(smoke).not.toContain('const ports = [4310, 4311, 5173]')
  })

  it('creates pairing authority through a signed browser session', () => {
    expect(smoke).toContain("import { createHmac } from 'node:crypto'")
    expect(smoke).toContain('DEVFLOW_SESSION_SECRET: sessionSecret')
    expect(smoke).toMatch(
      /async function createSmokePairingCode\(\)[\s\S]*?\.\.\.createBrowserSessionHeaders\('acct-demo-u-ling'\)/,
    )
    expect(smoke).toContain('cookie: `devflow_session=${payload}.${signature}`')
  })

  it('never invokes removed generic workflow persistence channels', () => {
    expect(smoke).not.toMatch(
      /window\.aiDevFlowDesktop\.(?:saveRun|saveArtifact|saveEvent)\s*\(/,
    )
  })

  it('keeps project test execution IDs-only and targets the current Test node', () => {
    // Since S2 the smoke runs the check from the task's test step through the real renderer
    // (plan §7.2 W4); the renderer write path must still send IDs only.
    expect(smoke).not.toMatch(
      /window\.aiDevFlowDesktop\.runProjectTests\(\{[\s\S]{0,300}\brun\s*[,}]/,
    )
    expect(smoke).toMatch(
      /runProjectTestsInTask\(first\.page,\s*\{[\s\S]*?nodeId: localNodes\.test\.id,/,
    )
    expect(smoke).toContain("getByTestId('task-status-row').getByRole('button', { name: '运行检查', exact: true })")
    expect(rendererActions).toMatch(
      /desktopApi\.runProjectTests\(\{\s*projectId: selectedLocalProject\.id,\s*runId: selectedRun\.id,\s*nodeId: testNode\.id,\s*\}\)/,
    )
  })

  it('decides Gate Review and coding permissions in the task, not on the Agents page', () => {
    expect(smoke).toContain('await runKnowledgeReviewInTask(first.page, {')
    expect(smoke).toContain("getByRole('button', { name: '运行门禁审查', exact: true })")
    expect(smoke).toContain("buildStatusRow.getByRole('button', { name: '批准本次', exact: true }).click()")
    expect(smoke).not.toContain("getByRole('button', { name: /仅批准本次/ }).click()")
  })

  it('walks the authoritative local workflow to the governed GitHub handoff', () => {
    const markers = [
      "getByRole('button', { name: '新建任务', exact: true })",
      'const completedClarify =',
      'nodeId: localNodes.clarifyGate.id,\n    projectId: localProjectId,',
      'const approvedClarify =',
      'const completedDesign =',
      'nodeId: localNodes.designGate.id,\n    nodeTitle: localNodes.designGate.title,',
      'const approvedDesign =',
      'await runCodingAgentViaDesktopApi(first.page, {',
      'expect(localRun.currentNodeId).toBe(localNodes.test.id)',
      'await runProjectTestsInTask(first.page, {',
      'const createdPrDraft =',
      "expect(createdPrDraft.run.status).toBe('paused_at_gate')",
      "expect(createdPrDraft.run.currentNodeId).toBe(localNodes.pr.id)",
      "toContainText('ready_to_prepare')",
    ]
    const positions = markers.map(position)

    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(smoke).toContain('expect(createdPrDraft.artifact.redacted).toBe(true)')
    expect(smoke).toContain('expect(createdPrDraft.artifact.githubDeliverySource).toMatchObject({')
    expect(smoke).toContain('expect(localDeliveryIntents).toEqual([])')
    expect(smoke).toContain('expect(createdPrDraft.run.pullRequestUrl).toBeUndefined()')
    expect(smoke).toContain('expect(restoredWorkflow.githubDeliveryIntentIds).toEqual([])')
    expect(smoke).toContain('run.version === localRun.version')
    expect(smoke).not.toContain('const createdAcceptanceBundle =')
    expect(smoke).not.toContain('const approvedAcceptance =')
  })

  it('keeps canonical remote synchronization behind the Electron main process', () => {
    expect(smoke).toContain("'uploadRunSummary' in window.aiDevFlowDesktop")
    expect(smoke).toContain("'uploadTestEvidenceSummary' in window.aiDevFlowDesktop")
    expect(smoke).not.toContain('window.aiDevFlowDesktop.uploadRunSummary({')
    expect(smoke).not.toContain('window.aiDevFlowDesktop.uploadTestEvidenceSummary({')
    expect(smoke).toContain("expect(webPage.locator('body')).not.toContainText(repoDir)")
    expect(smoke).toContain("webPage.getByText('Evidence Chain').first()")
    expect(smoke).toContain("webPage.getByText('Human Gate').first()")
    expect(smoke).not.toContain("toContainText('Team Console')")
  })
})
