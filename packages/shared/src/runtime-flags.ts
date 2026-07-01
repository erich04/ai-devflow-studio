export type DevFlowRuntimeFlags = {
  demoDataEnabled: boolean
  fakeRuntimeEnabled: boolean
  requireAuth: boolean
}

export type DevFlowCodingEngineSelection =
  | { engine: null; fakeRuntimeEnabled: boolean }
  | { engine: 'fake'; fakeRuntimeEnabled: true }
  | { engine: 'opencode-http'; fakeRuntimeEnabled: boolean }

export type DevFlowRuntimeFlagEnv = Partial<
  Record<
    | 'DEVFLOW_ENABLE_DEMO_DATA'
    | 'DEVFLOW_ENABLE_FAKE_RUNTIME'
    | 'DEVFLOW_REQUIRE_AUTH'
    | 'DEVFLOW_CODING_ENGINE',
    string | undefined
  >
>

export function isEnabledEnvFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function resolveDevFlowRuntimeFlags(
  env: DevFlowRuntimeFlagEnv,
): DevFlowRuntimeFlags {
  return {
    demoDataEnabled: isEnabledEnvFlag(env.DEVFLOW_ENABLE_DEMO_DATA),
    fakeRuntimeEnabled: isEnabledEnvFlag(env.DEVFLOW_ENABLE_FAKE_RUNTIME),
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
