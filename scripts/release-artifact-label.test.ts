import { describe, expect, it } from 'vitest'
import { resolveReleaseArtifactLabel } from './release-artifact-label.mjs'

describe('release artifact label', () => {
  it('uses a slash-free manual label for branch dispatches', () => {
    expect(
      resolveReleaseArtifactLabel({
        GITHUB_REF: 'refs/heads/codex/v1.3-closeout',
        GITHUB_REF_NAME: 'codex/v1.3-closeout',
        GITHUB_RUN_NUMBER: '42',
      }),
    ).toBe('manual-42')
  })
})
