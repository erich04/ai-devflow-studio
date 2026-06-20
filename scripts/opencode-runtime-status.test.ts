import { describe, expect, it } from 'vitest'
import {
  evaluateOpencodeRuntimeStatus,
  formatOpencodeRuntimeStatusItems,
} from './opencode-runtime-status.mjs'

type OpencodeRuntimeProbe = {
  binaryPath: string
  binaryFound: boolean
  version: string | null
  smokeMode: 'skip' | 'blocked' | 'ready'
  smokeMessage: string
  engine: string | undefined
  providerID: string | undefined
  modelID: string | undefined
  apiKeyEnvName: string
  apiKeyConfigured: boolean
}

function probe(overrides: Partial<OpencodeRuntimeProbe> = {}): OpencodeRuntimeProbe {
  return {
    binaryPath: '/opt/homebrew/bin/opencode',
    binaryFound: true,
    version: '1.17.5',
    smokeMode: 'skip',
    smokeMessage: 'Skipping opencode smoke: set DEVFLOW_RUN_OPENCODE_SMOKE=1 to run it.',
    engine: undefined,
    providerID: undefined,
    modelID: undefined,
    apiKeyEnvName: 'OPENAI_API_KEY',
    apiKeyConfigured: false,
    ...overrides,
  }
}

describe('opencode runtime status', () => {
  it('keeps the default fake-engine posture ready for deterministic verification', () => {
    const items = evaluateOpencodeRuntimeStatus(probe())

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'binary',
        state: 'ready',
      }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'live-smoke-gate',
        state: 'ready',
      }),
    )
    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'provider-profile',
        state: 'pending',
      }),
    )
  })

  it('marks a fully configured live opencode profile as ready without exposing the key value', () => {
    const items = evaluateOpencodeRuntimeStatus(
      probe({
        smokeMode: 'ready',
        smokeMessage: 'opencode smoke preflight passed for double/ark-code-latest using /opt/homebrew/bin/opencode; key env ANTHROPIC_AUTH_TOKEN.',
        engine: 'opencode-http',
        providerID: 'double',
        modelID: 'ark-code-latest',
        apiKeyEnvName: 'ANTHROPIC_AUTH_TOKEN',
        apiKeyConfigured: true,
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'provider-profile',
        state: 'ready',
      }),
    )
    expect(formatOpencodeRuntimeStatusItems(items)).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(formatOpencodeRuntimeStatusItems(items)).not.toContain('volcengine-secret')
  })

  it('flags missing opencode binary as attention', () => {
    const items = evaluateOpencodeRuntimeStatus(
      probe({
        binaryFound: false,
        version: null,
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'binary',
        state: 'attention',
      }),
    )
  })

  it('flags wrong live engine selection as attention', () => {
    const items = evaluateOpencodeRuntimeStatus(
      probe({
        smokeMode: 'blocked',
        smokeMessage: 'Real opencode smoke requires DEVFLOW_CODING_ENGINE=opencode-http.',
        engine: 'fake',
        providerID: 'double',
        modelID: 'ark-code-latest',
        apiKeyEnvName: 'ANTHROPIC_AUTH_TOKEN',
        apiKeyConfigured: true,
      }),
    )

    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'live-smoke-gate',
        state: 'attention',
      }),
    )
  })
})
