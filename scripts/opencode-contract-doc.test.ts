import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const contractPath = join(
  process.cwd(),
  'docs/research/2026-06-19-opencode-runtime-contract-refresh.md',
)

describe('opencode runtime contract refresh documentation', () => {
  it('documents the Volcengine Ark provider profile as an env-only template without secrets', () => {
    const markdown = readFileSync(contractPath, 'utf8')

    expect(markdown).toContain('### Provider Profile Template (No Secrets)')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(markdown).toContain('DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode')
    expect(markdown).toContain('DEVFLOW_OPENCODE_PROVIDER_ID=double')
    expect(markdown).toContain('DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest')
    expect(markdown).toContain('DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN')
    expect(markdown).toContain('ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"')
    expect(markdown).toContain('managed opencode runtime process')
    expect(markdown).toContain('Do not write the provider key')

    expect(markdown).not.toContain('volcengine-secret')
    expect(markdown).not.toContain('e8fa6ce2-6bb2-406f-b003-e695e04311a5')
    expect(markdown).not.toContain('6363516a-2de2-4d35-8d6e-b99f6c2f15f2')
  })
})
