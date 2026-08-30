import type { DesktopPairingCredential, WorkflowRun } from '@ai-devflow/shared'
import { resolveTrustedWorkflowActor } from './workflow-runtime.js'

type CodingRequestIdentity = {
  runId: string
  projectId: string
  requestedBy: string
}

export function resolveTrustedCodingRequest<T extends CodingRequestIdentity>(input: {
  input: T
  run: WorkflowRun | null
  pairing: DesktopPairingCredential | null
}): T & { requestedBy: string } {
  if (
    !input.run ||
    input.run.id !== input.input.runId ||
    input.run.projectId !== input.input.projectId
  ) {
    throw new Error('Coding request does not match a persisted Workflow run')
  }

  const actor = resolveTrustedWorkflowActor(input.run, input.pairing)
  return Object.assign({}, input.input, { requestedBy: actor.userId })
}
