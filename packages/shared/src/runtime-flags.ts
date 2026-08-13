export type DevFlowRuntimeFlags = {
  demoDataEnabled: boolean
  fakeRuntimeEnabled: boolean
  localMcpFixtureEnabled: boolean
  requireAuth: boolean
}

export type DevFlowCodingEngineSelection =
  | { engine: null; fakeRuntimeEnabled: boolean }
  | { engine: 'fake'; fakeRuntimeEnabled: true }
  | { engine: 'opencode-http'; fakeRuntimeEnabled: boolean }

export type DevFlowCodingExecutorSelection =
  | { executor: 'compatibility'; fakeRuntimeEnabled: boolean }
  | { executor: 'native-deterministic'; fakeRuntimeEnabled: true }
  | { executor: 'native-model'; providerId: string; fakeRuntimeEnabled: boolean }

export type DevFlowRuntimeFlagEnv = Partial<
  Record<
    | 'DEVFLOW_ENABLE_DEMO_DATA'
    | 'DEVFLOW_ENABLE_FAKE_RUNTIME'
    | 'DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE'
    | 'DEVFLOW_REQUIRE_AUTH'
    | 'DEVFLOW_CODING_ENGINE'
    | 'DEVFLOW_CODING_EXECUTOR'
    | 'DEVFLOW_NATIVE_CODING_PROVIDER_ID',
    string | undefined
  >
>

export function isEnabledEnvFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function resolveDevFlowRuntimeFlags(
  env: DevFlowRuntimeFlagEnv,
): DevFlowRuntimeFlags {
  const fakeRuntimeEnabled = isEnabledEnvFlag(env.DEVFLOW_ENABLE_FAKE_RUNTIME)
  const localMcpFixtureEnabled = isEnabledEnvFlag(env.DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE)
  if (localMcpFixtureEnabled && !fakeRuntimeEnabled) {
    throw new Error(
      'DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE=true requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.',
    )
  }
  return {
    demoDataEnabled: isEnabledEnvFlag(env.DEVFLOW_ENABLE_DEMO_DATA),
    fakeRuntimeEnabled,
    localMcpFixtureEnabled,
    requireAuth: isEnabledEnvFlag(env.DEVFLOW_REQUIRE_AUTH),
  }
}

export function resolveDevFlowCodingEngineSelection(
  env: DevFlowRuntimeFlagEnv,
): DevFlowCodingEngineSelection {
  const fakeRuntimeEnabled = isEnabledEnvFlag(env.DEVFLOW_ENABLE_FAKE_RUNTIME)
  const engine = env.DEVFLOW_CODING_ENGINE?.trim()

  if (!engine) {
    return { engine: null, fakeRuntimeEnabled }
  }

  if (engine === 'fake') {
    if (!fakeRuntimeEnabled) {
      throw new Error(
        'DEVFLOW_CODING_ENGINE=fake requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.',
      )
    }

    return { engine: 'fake', fakeRuntimeEnabled: true }
  }

  if (engine === 'opencode-http') {
    return { engine: 'opencode-http', fakeRuntimeEnabled }
  }

  throw new Error(`Unsupported Coding Agent engine: ${engine}`)
}

export function resolveDevFlowCodingExecutorSelection(
  env: DevFlowRuntimeFlagEnv,
): DevFlowCodingExecutorSelection {
  const fakeRuntimeEnabled = isEnabledEnvFlag(env.DEVFLOW_ENABLE_FAKE_RUNTIME)
  const executor = env.DEVFLOW_CODING_EXECUTOR?.trim()
  if (!executor || executor === 'compatibility') {
    return { executor: 'compatibility', fakeRuntimeEnabled }
  }
  if (executor === 'native-deterministic') {
    if (!fakeRuntimeEnabled) {
      throw new Error(
        'DEVFLOW_CODING_EXECUTOR=native-deterministic requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.',
      )
    }
    return { executor: 'native-deterministic', fakeRuntimeEnabled: true }
  }
  if (executor === 'native-model') {
    const providerId = env.DEVFLOW_NATIVE_CODING_PROVIDER_ID?.trim()
    if (!providerId) {
      throw new Error(
        'DEVFLOW_NATIVE_CODING_PROVIDER_ID is required for native-model Coding Executor.',
      )
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(providerId)) {
      throw new Error('DEVFLOW_NATIVE_CODING_PROVIDER_ID is invalid.')
    }
    return { executor: 'native-model', providerId, fakeRuntimeEnabled }
  }
  throw new Error(`Unsupported Coding Executor: ${executor}`)
}
