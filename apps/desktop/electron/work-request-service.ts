import { WORK_REQUEST_ID_MAX_LENGTH } from '@ai-devflow/shared'
import type {
  DesktopPairingCredential,
  WorkRequest,
} from '@ai-devflow/shared'
import type {
  ListWorkRequestsInput,
  MaterializeWorkRequestInput,
  MaterializeWorkRequestResult,
} from './ipc-contract.js'
import type { LocalStore } from './local-store.js'
import {
  createDesktopWorkRequestMaterializer,
  type DesktopWorkRequestMaterializerClient,
  type DesktopWorkRequestMaterializerDependencies,
  type DesktopWorkRequestMaterializerStore,
} from './work-request-materializer.js'

export type DesktopWorkRequestServiceStore = Pick<
  LocalStore,
  | 'getDesktopPairingCredentialBundle'
  | 'listProjects'
  | 'loadState'
> &
  DesktopWorkRequestMaterializerStore

type Materializer = ReturnType<typeof createDesktopWorkRequestMaterializer>

export type DesktopWorkRequestServiceDependencies = Readonly<{
  getStore(): Promise<DesktopWorkRequestServiceStore>
  decryptToken(encryptedToken: string): string
  createClient(input: {
    authToken: string
    signal: AbortSignal
  }): DesktopWorkRequestMaterializerClient
  createMaterializer?(
    dependencies: DesktopWorkRequestMaterializerDependencies,
  ): Materializer
  requestTimeoutMs?: number
}>

export type DesktopWorkRequestServiceErrorCode =
  | 'invalid_input'
  | 'pairing_required'
  | 'pairing_scope_mismatch'
  | 'local_project_not_found'
  | 'credential_unavailable'
  | 'request_in_progress'
  | 'remote_unavailable'
  | 'materialization_failed'

const errorMessages: Record<DesktopWorkRequestServiceErrorCode, string> = {
  invalid_input: 'Invalid Desktop Work Request service input.',
  pairing_required: 'Desktop pairing is required.',
  pairing_scope_mismatch:
    'Desktop pairing does not match the selected local project.',
  local_project_not_found: 'The selected local project is not available.',
  credential_unavailable: 'Desktop pairing credentials are unavailable.',
  request_in_progress: 'A different version of this Work Request is already in progress.',
  remote_unavailable: 'Work Requests are temporarily unavailable.',
  materialization_failed: 'The Work Request could not be materialized.',
}

export class DesktopWorkRequestServiceError extends Error {
  readonly code: DesktopWorkRequestServiceErrorCode

  constructor(code: DesktopWorkRequestServiceErrorCode) {
    super(errorMessages[code])
    this.name = 'DesktopWorkRequestServiceError'
    this.code = code
  }
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= WORK_REQUEST_ID_MAX_LENGTH &&
    value.trim().length > 0 &&
    value.trim() === value
  )
}

function validateListInput(input: ListWorkRequestsInput): void {
  if (!isIdentifier(input.localProjectId)) {
    throw new DesktopWorkRequestServiceError('invalid_input')
  }
}

function validateMaterializeInput(input: MaterializeWorkRequestInput): void {
  if (
    !isIdentifier(input.localProjectId) ||
    !isIdentifier(input.workRequestId) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    throw new DesktopWorkRequestServiceError('invalid_input')
  }
}

function safeFailure(
  cause: unknown,
  fallback: 'remote_unavailable' | 'materialization_failed',
): DesktopWorkRequestServiceError {
  return cause instanceof DesktopWorkRequestServiceError
    ? cause
    : new DesktopWorkRequestServiceError(fallback)
}

function freezePairing(
  credential: DesktopPairingCredential,
): DesktopPairingCredential {
  return Object.freeze({
    ...credential,
    projectMemberships: Object.freeze(
      credential.projectMemberships.map((membership) =>
        Object.freeze({ ...membership }),
      ),
    ),
  }) as DesktopPairingCredential
}

export function createDesktopWorkRequestService(
  dependencies: DesktopWorkRequestServiceDependencies,
): {
  list(input: ListWorkRequestsInput): Promise<WorkRequest[]>
  materialize(
    input: MaterializeWorkRequestInput,
  ): Promise<MaterializeWorkRequestResult>
} {
  const createMaterializer =
    dependencies.createMaterializer ?? createDesktopWorkRequestMaterializer
  const requestTimeoutMs =
    dependencies.requestTimeoutMs !== undefined &&
    Number.isFinite(dependencies.requestTimeoutMs) &&
    dependencies.requestTimeoutMs > 0
      ? dependencies.requestTimeoutMs
      : 15_000
  const inFlight = new Map<
    string,
    {
      expectedVersion: number
      promise: Promise<MaterializeWorkRequestResult>
    }
  >()

  async function resolveContext(
    localProjectId: string,
    signal: AbortSignal,
  ): Promise<{
    store: DesktopWorkRequestServiceStore
    pairing: DesktopPairingCredential
    client: DesktopWorkRequestMaterializerClient
  }> {
    const store = await dependencies.getStore()
    const bundle = await store.getDesktopPairingCredentialBundle()
    if (!bundle) {
      throw new DesktopWorkRequestServiceError('pairing_required')
    }

    const pairing = freezePairing(bundle.credential)
    if (pairing.localProjectId !== localProjectId) {
      throw new DesktopWorkRequestServiceError('pairing_scope_mismatch')
    }
    if (!(await store.listProjects()).some((project) => project.id === localProjectId)) {
      throw new DesktopWorkRequestServiceError('local_project_not_found')
    }

    let authToken: string
    try {
      authToken = dependencies.decryptToken(bundle.encryptedToken).trim()
    } catch {
      throw new DesktopWorkRequestServiceError('credential_unavailable')
    }
    if (!authToken) {
      throw new DesktopWorkRequestServiceError('credential_unavailable')
    }

    return {
      store,
      pairing,
      client: dependencies.createClient({ authToken, signal }),
    }
  }

  async function list(input: ListWorkRequestsInput): Promise<WorkRequest[]> {
    validateListInput(input)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const context = await resolveContext(
        input.localProjectId,
        controller.signal,
      )
      return await context.client.listWorkRequests(
        context.pairing.projectId,
        context.pairing,
      )
    } catch (cause) {
      throw safeFailure(cause, 'remote_unavailable')
    } finally {
      clearTimeout(timeout)
    }
  }

  async function runMaterialization(
    input: MaterializeWorkRequestInput,
  ): Promise<MaterializeWorkRequestResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const context = await resolveContext(
        input.localProjectId,
        controller.signal,
      )
      const result = await createMaterializer({
        pairing: context.pairing,
        client: context.client,
        store: context.store,
      }).materialize(input)
      const state = await context.store.loadState()
      const currentRun = state.runs.find((run) => run.id === result.run.id)
      if (!currentRun) {
        throw new DesktopWorkRequestServiceError('materialization_failed')
      }
      return {
        workRequest: result.workRequest,
        run: currentRun,
        state,
      }
    } catch (cause) {
      throw safeFailure(cause, 'materialization_failed')
    } finally {
      clearTimeout(timeout)
    }
  }

  function materialize(
    input: MaterializeWorkRequestInput,
  ): Promise<MaterializeWorkRequestResult> {
    try {
      validateMaterializeInput(input)
    } catch (cause) {
      return Promise.reject(cause)
    }

    const key = `${input.localProjectId}\u0000${input.workRequestId}`
    const existing = inFlight.get(key)
    if (existing) {
      return existing.expectedVersion === input.expectedVersion
        ? existing.promise
        : Promise.reject(
            new DesktopWorkRequestServiceError('request_in_progress'),
          )
    }

    const operation = runMaterialization({ ...input })
    const tracked = operation.finally(() => {
      if (inFlight.get(key)?.promise === tracked) {
        inFlight.delete(key)
      }
    })
    inFlight.set(key, {
      expectedVersion: input.expectedVersion,
      promise: tracked,
    })
    return tracked
  }

  return Object.freeze({ list, materialize })
}
