import {
  createRemoteRunSummary,
  createRemoteTestEvidenceSummary,
  resolveTeamProjectId,
  type DesktopPairingCredential,
  type RemoteSyncUploadResult,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { RemoteSyncClient } from './remote-sync'

type PairingCredentialSource = {
  getDesktopPairingCredential(): Promise<DesktopPairingCredential | null>
  listRuns(): Promise<WorkflowRun[]>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
}

export type ProjectBoundRemoteSync = Pick<
  RemoteSyncClient,
  | 'uploadAgentReviewSummary'
  | 'uploadCodingAgentSummary'
  | 'saveGateOverride'
  | 'evaluateRuntimeBudget'
> & {
  uploadCanonicalRunSummary(runId: string): Promise<RemoteSyncUploadResult>
  uploadCanonicalTestEvidenceSummary(evidenceId: string): Promise<RemoteSyncUploadResult>
}

async function bindProjectId<T extends { projectId: string }>(
  payload: T,
  credentialSource: PairingCredentialSource,
): Promise<T> {
  const credential = await credentialSource.getDesktopPairingCredential()
  const localProjectId =
    credential?.projectId === payload.projectId && credential.localProjectId
      ? credential.localProjectId
      : payload.projectId
  const projectId = resolveTeamProjectId({ localProjectId, credential })

  return { ...payload, projectId }
}

export function createProjectBoundRemoteSync(input: {
  remoteSync: RemoteSyncClient
  credentialSource: PairingCredentialSource
}): ProjectBoundRemoteSync {
  function isCanonicalRunRequiredError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /^Canonical Run Summary is required before evidence sync(?::|$)/.test(error.message)
    )
  }

  async function uploadCanonicalRun(runId: string): Promise<RemoteSyncUploadResult> {
    const run = (await input.credentialSource.listRuns()).find(
      (candidate) => candidate.id === runId,
    )
    if (!run) {
      throw new Error(`Local Run not found for remote evidence upload: ${runId}`)
    }

    const result = await input.remoteSync.uploadRunSummary(
      await bindProjectId(
        createRemoteRunSummary(run, 'run'),
        input.credentialSource,
      ),
    )
    if (!result.accepted) {
      throw new Error(`Canonical Run summary was not accepted: ${result.message}`)
    }
    return result
  }

  async function uploadDependentSummary(
    runId: string,
    upload: () => Promise<RemoteSyncUploadResult>,
  ): Promise<RemoteSyncUploadResult> {
    try {
      return await upload()
    } catch (error) {
      if (!isCanonicalRunRequiredError(error)) {
        throw error
      }
      await uploadCanonicalRun(runId)
      return upload()
    }
  }

  return {
    async uploadCanonicalRunSummary(runId) {
      return uploadCanonicalRun(runId)
    },
    async uploadCanonicalTestEvidenceSummary(evidenceId) {
      const evidence = (await input.credentialSource.listTestEvidence()).find(
        (candidate) => candidate.id === evidenceId,
      )
      if (!evidence) {
        throw new Error(`Local Test Evidence not found for remote upload: ${evidenceId}`)
      }
      const summary = await bindProjectId(
        createRemoteTestEvidenceSummary(evidence),
        input.credentialSource,
      )
      return uploadDependentSummary(evidence.runId, () =>
        input.remoteSync.uploadTestEvidenceSummary(summary),
      )
    },
    async uploadAgentReviewSummary(summary) {
      const boundSummary = await bindProjectId(summary, input.credentialSource)
      return uploadDependentSummary(summary.runId, () =>
        input.remoteSync.uploadAgentReviewSummary(boundSummary),
      )
    },
    async uploadCodingAgentSummary(summary) {
      const boundSummary = await bindProjectId(summary, input.credentialSource)
      return uploadDependentSummary(summary.runId, () =>
        input.remoteSync.uploadCodingAgentSummary(boundSummary),
      )
    },
    async saveGateOverride(override) {
      return input.remoteSync.saveGateOverride(
        await bindProjectId(override, input.credentialSource),
      )
    },
    async evaluateRuntimeBudget(request) {
      return input.remoteSync.evaluateRuntimeBudget(
        await bindProjectId(request, input.credentialSource),
      )
    },
  }
}
