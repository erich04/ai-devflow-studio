import { describe, expect, it } from 'vitest'
import {
  isEnabledEnvFlag,
  resolveDevFlowCodingEngineSelection,
  resolveDevFlowCodingExecutorSelection,
  resolveDevFlowRuntimeFlags,
} from './runtime-flags'

describe('DevFlow runtime flags', () => {
  it('treats unset flags as the real empty-system path', () => {
    expect(resolveDevFlowRuntimeFlags({})).toEqual({
      demoDataEnabled: false,
      fakeRuntimeEnabled: false,
      localDevelopmentAuthEnabled: false,
      localMcpFixtureEnabled: false,
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

  it('allows the packaged Local MCP fixture only behind the fake-runtime boundary', () => {
    expect(() =>
      resolveDevFlowRuntimeFlags({ DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE: 'true' }),
    ).toThrow(
      'DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE=true requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.',
    )

    expect(resolveDevFlowRuntimeFlags({
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE: 'true',
    })).toMatchObject({
      fakeRuntimeEnabled: true,
      localMcpFixtureEnabled: true,
    })
  })

  it('parses demo, fake runtime, local auth, and auth flags independently', () => {
    expect(resolveDevFlowRuntimeFlags({
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_LOCAL_AUTH_ENABLED: 'true',
      DEVFLOW_REQUIRE_AUTH: 'true',
    })).toEqual({
      demoDataEnabled: true,
      fakeRuntimeEnabled: true,
      localDevelopmentAuthEnabled: true,
      localMcpFixtureEnabled: false,
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

  it('keeps the compatibility Coding Executor unless native coding is explicitly selected', () => {
    expect(resolveDevFlowCodingExecutorSelection({})).toEqual({
      executor: 'compatibility',
      fakeRuntimeEnabled: false,
    })
  })

  it('allows deterministic native coding only behind the fake-runtime boundary', () => {
    expect(() =>
      resolveDevFlowCodingExecutorSelection({
        DEVFLOW_CODING_EXECUTOR: 'native-deterministic',
      }),
    ).toThrow(
      'DEVFLOW_CODING_EXECUTOR=native-deterministic requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.',
    )
    expect(resolveDevFlowCodingExecutorSelection({
      DEVFLOW_CODING_EXECUTOR: 'native-deterministic',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    })).toEqual({
      executor: 'native-deterministic',
      fakeRuntimeEnabled: true,
    })
  })

  it('requires an exact configured provider for bounded native model coding', () => {
    expect(() =>
      resolveDevFlowCodingExecutorSelection({
        DEVFLOW_CODING_EXECUTOR: 'native-model',
      }),
    ).toThrow('DEVFLOW_NATIVE_CODING_PROVIDER_ID is required for native-model Coding Executor.')
    expect(resolveDevFlowCodingExecutorSelection({
      DEVFLOW_CODING_EXECUTOR: 'native-model',
      DEVFLOW_NATIVE_CODING_PROVIDER_ID: 'team-openai',
    })).toEqual({
      executor: 'native-model',
      providerId: 'team-openai',
      fakeRuntimeEnabled: false,
    })
    expect(() =>
      resolveDevFlowCodingExecutorSelection({
        DEVFLOW_CODING_EXECUTOR: 'native-model',
        DEVFLOW_NATIVE_CODING_PROVIDER_ID: '../forged',
      }),
    ).toThrow('DEVFLOW_NATIVE_CODING_PROVIDER_ID is invalid.')
  })

  it('rejects unsupported Coding Executor selections', () => {
    expect(() =>
      resolveDevFlowCodingExecutorSelection({ DEVFLOW_CODING_EXECUTOR: 'native-shell' }),
    ).toThrow('Unsupported Coding Executor: native-shell')
  })
})
