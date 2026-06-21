import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const contractPath = join(
  process.cwd(),
  'docs/research/2026-06-19-opencode-runtime-contract-refresh.md',
)

describe('opencode runtime contract refresh documentation', () => {
  it('records the latest provider-safe status re-check and current live smoke evidence', () => {
    const markdown = readFileSync(contractPath, 'utf8')

    expect(markdown).toContain('2026-06-20 re-check')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('PR #3 head `ec878e5`')
    expect(markdown).toContain('The local binary still reports `1.17.5`')
    expect(markdown).toContain('live opencode smoke is disabled')
    expect(markdown).toContain('prevents accidental provider calls during `verify`')
    expect(markdown).toContain('opencode smoke passed; changed paths: devflow-opencode-smoke.txt')
    expect(markdown).toContain('v0.9.0 post-release live smoke')
    expect(markdown).toContain('about 1m38s')
  })

  it('documents the Volcengine Ark provider profile with a local config and explicit live gate', () => {
    const markdown = readFileSync(contractPath, 'utf8')

    expect(markdown).toContain('### Provider Profile Template (No Secrets)')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(markdown).toContain('DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode')
    expect(markdown).toContain('DEVFLOW_OPENCODE_PROVIDER_ID=double')
    expect(markdown).toContain('DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest')
    expect(markdown).toContain('DEVFLOW_OPENCODE_API_KEY_ENV=ARK_API_KEY')
    expect(markdown).toContain('ARK_API_KEY="<set in shell only; never commit>"')
    expect(markdown).toContain('https://ark.cn-beijing.volces.com/api/coding/v3')
    expect(markdown).toContain('@ai-sdk/openai-compatible')
    expect(markdown).toContain('Do not write the provider key')

    expect(markdown).not.toContain('volcengine-secret')
    expect(markdown).not.toContain('e8fa6ce2-6bb2-406f-b003-e695e04311a5')
    expect(markdown).not.toContain('6363516a-2de2-4d35-8d6e-b99f6c2f15f2')
  })

  it('documents the release-only real provider smoke gate', () => {
    const checklist = readFileSync(
      join(process.cwd(), 'docs/knowledge/checklists/opencode-runtime-signoff.md'),
      'utf8',
    )
    const releaseGate = readFileSync(
      join(process.cwd(), 'docs/plans/release-only-real-opencode-smoke.md'),
      'utf8',
    )

    expect(checklist).toContain('Keep live opencode smoke out of `corepack pnpm verify`')
    expect(checklist).toContain('For every future product release')
    expect(checklist).toContain('docs/plans/release-only-real-opencode-smoke.md')

    expect(releaseGate).toContain('Every future DevFlow Studio product release')
    expect(releaseGate).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(releaseGate).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(releaseGate).toContain('DEVFLOW_OPENCODE_PROVIDER_ID=double')
    expect(releaseGate).toContain('DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest')
    expect(releaseGate).toContain('ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"')
    expect(releaseGate).toContain('Required Evidence To Record')
    expect(releaseGate).toContain('managed worktree deleted or cleanup_failed')
    expect(releaseGate).not.toContain('e8fa6ce2-6bb2-406f-b003-e695e04311a5')
    expect(releaseGate).not.toContain('6363516a-2de2-4d35-8d6e-b99f6c2f15f2')
  })
})
