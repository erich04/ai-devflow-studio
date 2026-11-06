// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { assertFocusedOutcomes } from './native-coding-focused-live.mts'

it('rejects an invalid control even when both coding tasks and all interaction phases pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'focused-outcome-'))
  try {
    await mkdir(path.join(root, 'phases'))
    for (const name of ['cache-legacy_a', 'cache-fixed_a', 'cache-fixed_b', 'cache-legacy_b', 'coding-recovery', 'coding-deep', 'interactive-core', 'interactive-fault']) {
      await writeFile(path.join(root, 'phases', `${name}.json`), JSON.stringify({ state: 'completed', result: { passed: name !== 'cache-legacy_a' } }))
    }
    await expect(assertFocusedOutcomes(root)).rejects.toThrow(/cache-legacy_a/)
    await writeFile(path.join(root, 'phases/cache-legacy_a.json'), JSON.stringify({ state: 'completed', result: { passed: true } }))
    await expect(assertFocusedOutcomes(root)).resolves.toBeUndefined()
    await writeFile(path.join(root, 'phases/interactive-fault.json'), JSON.stringify({ state: 'blocked' }))
    await expect(assertFocusedOutcomes(root)).rejects.toThrow(/interactive-fault/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('cannot report success with missing phases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'focused-missing-'))
  try { await expect(assertFocusedOutcomes(root)).rejects.toThrow() }
  finally { await rm(root, { recursive: true, force: true }) }
})
