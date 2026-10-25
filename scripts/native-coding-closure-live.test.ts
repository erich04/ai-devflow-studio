// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCnyEvaluationRound, continueCnyEvaluationRound, openInteractiveRound } from './native-coding-round-budget'
import { digest } from './native-coding-live-support'
import { checkClosure } from './native-coding-closure-live.mts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'closure-result-')); roots.push(directory)
  const parent = path.join(directory, 'parent'), root = path.join(directory, 'child')
  const scopes = { 'closure/electron': { projectId: 'closure-electron', providerId: 'deepseek-evaluation', maxCalls: 2 } }
  await createCnyEvaluationRound(parent, { maxCostCny: 5, maxCalls: 2, maxOutputTokens: 8192, scopes })
  const old = await openInteractiveRound(parent, 'closure/electron'); await old.seal(); old.close()
  await continueCnyEvaluationRound(root, { parentRoot: parent, maxCalls: 2, maxOutputTokens: 8192, scopes })
  for (const phase of ['legacy', 'fixed', 'electron']) { await mkdir(path.join(root, phase)); await writeFile(path.join(root, phase, 'phase.json'), JSON.stringify({ state: 'completed', result: { passed: true } })) }
  return root
}
it.each(['legacy', 'fixed', 'electron'])('fails the offline result if %s is failed, incomplete or missing', async phase => {
  const root = await fixture(), file = path.join(root, phase, 'phase.json')
  for (const result of [{ state: 'completed', result: { passed: false } }, { state: 'started' }]) {
    await writeFile(file, JSON.stringify(result)); await expect(checkClosure(root)).rejects.toThrow(/failed|incomplete/i)
  }
  await rm(file); await expect(checkClosure(root)).rejects.toThrow()
})
it('reports the original authorization and refuses to hide an unknown charge behind passed outcomes', async () => {
  const root = await fixture()
  expect((await checkClosure(root)).authorization).toMatchObject({ maxCostCny: 5, priorAccountedCny: 0, accountedCny: 0 })
  const ledger = await openInteractiveRound(root, 'closure/electron')
  await ledger.reserve({ id: 'unknown', projectId: 'closure-electron', providerId: 'deepseek-evaluation', model: 'deepseek-flash', createdAt: new Date().toISOString(), inputTokens: 1048576, maxOutputTokens: 8192, billingProvider: 'deepseek', boundBasis: 'deepseek-context-v1' }); ledger.close()
  await expect(checkClosure(root)).rejects.toThrow(/failed|incomplete/i)
})


it('requires an explicit bound amendment to select recovery, while the original failed result stays failed', async () => {
  const root = await fixture(), prior = JSON.stringify({ state: 'completed', result: { passed: false } })
  await writeFile(path.join(root, 'electron', 'phase.json'), prior)
  await mkdir(path.join(root, 'electron-recovery'))
  await writeFile(path.join(root, 'electron-recovery', 'phase.json'), JSON.stringify({ state: 'completed', result: { passed: true } }))
  await expect(checkClosure(root, 'electron-recovery')).rejects.toThrow()
  const protocol = '{"round":"original"}'
  await writeFile(path.join(root, 'protocol.json'), protocol)
  await writeFile(path.join(root, 'electron-amendment.json'), JSON.stringify({ maxOutputTokens: 2048, scope: 'closure/electron', priorPhaseSha256: digest(prior), protocolSha256: digest(protocol) }))
  await expect(checkClosure(root)).rejects.toThrow(/failed|incomplete/i)
  expect((await checkClosure(root, 'electron-recovery')).authorization!.maxCostCny).toBe(5)
  await writeFile(path.join(root, 'electron', 'phase.json'), JSON.stringify({ state: 'completed', result: { passed: true } }))
  await expect(checkClosure(root, 'electron-recovery')).rejects.toThrow(/preserve/i)
})
