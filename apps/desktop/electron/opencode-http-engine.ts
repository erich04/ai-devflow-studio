import type { CodingEngineAdapter } from './coding-engine.js'

export type OpencodeHttpCodingEngineConfig = {
  binaryPath: string
  providerID: string
  modelID: string
  apiKeyEnvName: string
}

export function createOpencodeHttpCodingEngineAdapter(
  _config: OpencodeHttpCodingEngineConfig,
): CodingEngineAdapter {
  return {
    engine: 'opencode-http',

    async ensure(input) {
      return {
        projectId: input.project.id,
        engine: 'opencode-http',
        status: 'ready',
      }
    },

    async start() {
      throw new Error('opencode-http coding engine is not wired yet')
    },

    async approvePermission() {
      throw new Error('opencode-http coding engine is not wired yet')
    },

    async cancel() {
      return undefined
    },
  }
}
