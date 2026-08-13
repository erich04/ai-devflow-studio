import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  collectV20CompletionSignoff,
  v20CompletionEvidencePaths,
} from './v20-completion-evidence.mjs'

describe('V2.0 completion signoff boundary', () => {
  it('requires both immutable records and a ready direct-child signoff once evidence exists', () => {
    const evidenceExists = Object.values(v20CompletionEvidencePaths).map(existsSync)
    expect(new Set(evidenceExists).size).toBe(1)

    if (evidenceExists[0]) {
      const worktreeClean = execFileSync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=all'],
        { encoding: 'utf8' },
      ) === ''
      expect(collectV20CompletionSignoff().result).toEqual(worktreeClean
        ? { ready: true, failures: [] }
        : { ready: false, failures: ['worktree_dirty'] })
    }
  })
})
