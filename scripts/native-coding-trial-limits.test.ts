// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { runLiveTrial } from './native-coding-trial-live.mts'
import { createLocalStore } from '../apps/desktop/electron/local-store'
import { configureEvaluationHarnessLimits } from './native-coding-live-support'

it('uses the frozen trial limits in the real harness before the first request, including its hard step stop', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-trial-limits-')), repository = path.join(root, 'repository'), output = path.join(root, 'execution')
  await mkdir(repository)
  await writeFile(path.join(repository, 'value.ts'), 'export const value = 1\n')
  await writeFile(path.join(repository, 'package.json'), '{"private":true}')
  const git = (args: string[]) => promisify(execFile)('git', args, { cwd: repository })
  await git(['init', '--quiet', '-b', 'main']); await git(['add', '.'])
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'baseline'])
  const requests: Array<{ tools: Array<{function: {name: string}}>; messages: Array<{content: string | null}> }> = []
  // Only HTTP model responses are doubled. The trial, Git, SQLite, budget
  // admission, provider serialization and product scheduling are real.
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).origin).toBe('https://api.deepseek.com')
    const request = JSON.parse(String(init.body)) as (typeof requests)[number]; requests.push(request)
    const author = request.tools.some(tool => tool.function.name === 'submit_independent_checks')
    const name = author ? 'submit_independent_checks' : 'list_directory'
    const args = author ? { checks: [{ criterionId: 'objective', body: "const fs = await import('node:fs/promises'); check((await fs.readFile('value.ts', 'utf8')).includes('export const value'));" }] } : {}
    return Response.json({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'Fixture response', tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })
  }))
  try {
    await runLiveTrial({ id: 'limits-fixture', engine: 'native-v3', repository, output, prompt: 'Inspect the existing value.', testCommand: 'node -e "process.exit(0)"', maxCalls: 8, maxCostUsd: 1, maxSteps: 2, maxActiveMilliseconds: 15000, maxOutputTokens: 1024, opencodeBinary: '' }, 'fixture-key-no-network')
    const session = JSON.parse(await readFile(path.join(output, 'session.json'), 'utf8'))
    expect(session.limits).toMatchObject({ maxSteps: 2, maxActiveMilliseconds: 15000 })
    expect(requests).toHaveLength(2)
    const worker = JSON.parse(await readFile(path.join(output, 'private-acceptance', `${session.acceptanceWorkers[0].sessionId}.json`), 'utf8'))
    expect(session.steps).toBe(1)
    expect(worker.steps).toBe(1)
    expect(session.rootStepAttempts).toHaveLength(2)
    const coder = requests.find(request => request.tools.some(tool => tool.function.name === 'list_directory'))!
    const state = JSON.parse(coder.messages.at(-1)!.content!.split('[DevFlow runtime state]\n').at(-1)!)
    expect(state.steps.maximum).toBe(2)
    // Both requests share the ceiling. Either worker may reserve first.
    expect(state.steps.remainingIncludingThisCall).toBeGreaterThanOrEqual(1)
    expect(state.steps.remainingIncludingThisCall).toBeLessThanOrEqual(2)
    expect(state.activeMilliseconds.remaining).toBeGreaterThan(0)
    expect(state.activeMilliseconds.remaining).toBeLessThanOrEqual(15000)
    expect(state.acceptanceSchedule.reservedMilliseconds).toBe(6000)
    const report = JSON.parse(await readFile(path.join(output, 'trial.json'), 'utf8'))
    expect(report.deadlineExpired).toBe(false)
    expect(report.claimedCompleted).toBe(false)
    const actions = JSON.parse(await readFile(path.join(output, 'operator-actions.json'), 'utf8'))
    expect(actions[0]).toMatchObject({ type: 'frozen_harness_limits', limits: { maxSteps: 2, maxActiveMilliseconds: 15000 } })
    expect(session.operatorDeadlineAt).toBe(actions[0].wallDeadline)
    expect(state.wallClock.deadlineAt).toBe(actions[0].wallDeadline)
    expect(state.wallClock.remainingMilliseconds).toBeGreaterThan(0)
    expect(state.wallClock.remainingMilliseconds).toBeLessThanOrEqual(15000)
    const privateAuthor = requests.find(request=>!request.tools.some(tool=>tool.function.name==='list_directory'))!
    const privateInput = JSON.parse(privateAuthor.messages.at(-1)!.content!)
    expect(privateInput.planningTime.deadlineAt).toBe(actions[0].wallDeadline)
    expect(privateInput.planningTime.remainingMilliseconds).toBeLessThanOrEqual(15000)
    expect(privateInput.planningTime).not.toHaveProperty('transcript')
    expect(actions[1].command.type).toBe('authorize')
    const reopened = await createLocalStore({ dbPath: path.join(output, 'devflow.sqlite') })
    try {
      const { mutateNativeCodingSession } = await import('../apps/desktop/electron/native-coding-session')
      await expect(mutateNativeCodingSession(reopened,session.id,draft => { draft.operatorDeadlineAt=new Date(Date.parse(actions[0].wallDeadline)+1000).toISOString() })).rejects.toThrow('frozen operator deadline')
      expect((await reopened.getNativeCodingSession(session.id))?.operatorDeadlineAt).toBe(actions[0].wallDeadline)
      await expect(configureEvaluationHarnessLimits(reopened, session.codingRunId, { maxSteps: 3, maxActiveMilliseconds: 16000 })).rejects.toThrow('before execution authorization')
      expect((await reopened.getNativeCodingSession(session.id))!.limits).toMatchObject({ maxSteps: 2, maxActiveMilliseconds: 15000 })
    } finally { await reopened.close() }
  } finally { vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) }
}, 20000)
