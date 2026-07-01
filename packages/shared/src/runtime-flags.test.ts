import { describe, expect, it } from 'vitest'
import {
  isEnabledEnvFlag,
  resolveDevFlowCodingEngineSelection,
  resolveDevFlowRuntimeFlags,
} from './runtime-flags'

describe('DevFlow runtime flags', () => {
  it('treats unset flags as the real empty-system path', () => {
    expect(resolveDevFlowRuntimeFlags({})).toEqual({
      demoDataEnabled: false,
      fakeRuntimeEnabled: false,
      requireAuth: false,
    })
  })

  it('enables flags only when the env value is true', () => {
    expect(isEnabledEnvFlag('true')).toBe(true)
    expect(isEnabledEnvFlag(' TRUE ')).toBe(true)
    expect(isEnabledEnvFlag('false')).toBe(false)
    expect(isEnabledEnvFlag('1')).toBe(false)
    expect(isEnabledEnvFlag(undefined)).toBe(false)
  })

  it('parses demo, fake runtime, and auth flags independently', () => {
    expect(resolveDevFlowRuntimeFlags({
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_REQUIRE_AUTH: 'true',
    })).toEqual({
      demoDataEnabled: true,
      fakeRuntimeEnabled: true,
      requireAuth: true,
    })
  })

  it('treats an unset coding engine as not configured', () => {
    expect(resolveDevFlowCodingEngineSelection({})).toEqual({
      engine: null,
      fakeRuntimeEnabled: false,
    })
  })

  it('requires the fake runtime flag for the fake coding engine', () => {
    expect(() =>
      resolveDevFlowCodingEngineSelection({ DEVFLOW_CODING_ENGINE: 'fake' }),
    ).toThrow('DEVFLOW_CODING_ENGINE=fake requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.')

    expect(resolveDevFlowCodingEngineSelection({
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    })).toEqual({
      engine: 'fake',
      fakeRuntimeEnabled: true,
    })
  })

  it('allows real coding engines without enabling fake runtime', () => {
    expect(resolveDevFlowCodingEngineSelection({
      DEVFLOW_CODING_ENGINE: 'opencode-http',
    })).toEqual({
      engine: 'opencode-http',
      fakeRuntimeEnabled: false,
    })
  })

  it('rejects unsupported coding engine values', () => {
    expect(() =>
      resolveDevFlowCodingEngineSelection({ DEVFLOW_CODING_ENGINE: 'opencode-acp' }),
    ).toThrow('Unsupported Coding Agent engine: opencode-acp')
  })
})
