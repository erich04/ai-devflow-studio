import {
  abortOpencodeSession, getOpencodeSession, getOpencodeSessionStatus, listOpencodeChildSessions,
  listOpencodePermissions, listOpencodeQuestions, replyOpencodePermission, replyOpencodeQuestion, updateOpencodeSessionMetadata,
  OpencodeHttpRequestError, type Fetcher, type OpencodePermission, type OpencodeSession,
} from './opencode-http-adapter.js'
import type { OpencodeTaskPolicy } from './opencode-task-guard.js'

type TaskScopeInput = { baseUrl: string; directory: string; sessionId: string; codingRunId: string; workspaceId: string; policy: OpencodeTaskPolicy; fetcher?: Fetcher }

/** A run-local, verified set of sessions. Never infer ownership from non-parent IDs. */
export class OpencodeTaskScope {
  private readonly children = new Map<string, OpencodeSession>()
  private readonly admissions = new Set<string>()
  private stopping = false
  constructor(private readonly input: TaskScopeInput) {}

  get sessionIds(): string[] { return [this.input.sessionId, ...this.children.keys()] }
  get childCount(): number { return this.children.size }
  owns(sessionId: string): boolean { return this.sessionIds.includes(sessionId) }
  assertActive(): void { if (this.stopping) throw new Error('opencode_task_stopping') }

  private request(sessionId: string, signal?: AbortSignal) {
    return { baseUrl: this.input.baseUrl, directory: this.input.directory, sessionId,
      ...(this.input.fetcher ? { fetcher: this.input.fetcher } : {}), ...(signal ? { signal } : {}) }
  }

  private validate(session: OpencodeSession, child: boolean) {
    const marker = session?.metadata?.devflow as Record<string, unknown> | undefined
    if (!session || typeof session.id !== 'string' || !/^[\w-]{1,200}$/u.test(session.id) ||
      session.directory !== this.input.directory || !marker || marker.owner !== this.input.policy.owner ||
      marker.codingRunId !== this.input.codingRunId || marker.workspaceId !== this.input.workspaceId ||
      (marker.stopped && !this.stopping) ||
      (child ? session.parentID !== this.input.sessionId || marker.rootSessionId !== this.input.sessionId ||
        session.agent !== 'devflow-worker' || typeof marker.taskCallId !== 'string'
        : session.id !== this.input.sessionId || !!session.parentID) ||
      JSON.stringify(session.permission) !== JSON.stringify(child ? this.input.policy.childRules : this.input.policy.parentRules)) {
      throw new Error('opencode_task_scope_invalid')
    }
  }

  async refresh(signal: AbortSignal = AbortSignal.timeout(5_000)): Promise<void> {
    const root = await getOpencodeSession(this.request(this.input.sessionId, signal))
    this.validate(root, false)
    const children = await listOpencodeChildSessions(this.request(this.input.sessionId, signal))
    if (children.length > this.input.policy.maxTasks) throw new Error('opencode_task_limit_exceeded')
    const next = new Map<string, OpencodeSession>()
    for (const child of children) {
      this.validate(child, true)
      if (next.has(child.id)) throw new Error('opencode_task_scope_invalid')
      if ((await listOpencodeChildSessions(this.request(child.id, signal))).length) throw new Error('opencode_nested_task_detected')
      next.set(child.id, child)
    }
    // A disappeared child is not proof of completion or cancellation.
    if ([...this.children.keys()].some((id) => !next.has(id))) throw new Error('opencode_task_scope_lost')
    for (const [id, child] of next) this.children.set(id, child)
  }

  async admit(permission: OpencodePermission, signal?: AbortSignal): Promise<string> {
    await this.refresh(signal)
    const callID = permission.tool?.callID
    const children = [...this.children.values()].filter((child) =>
      (child.metadata?.devflow as Record<string, unknown>).taskCallId === callID)
    if (this.stopping || permission.sessionID !== this.input.sessionId || permission.permission !== 'task' || !callID ||
      JSON.stringify(permission.patterns) !== JSON.stringify(['devflow-worker']) || children.length !== 1 || this.admissions.has(callID)) {
      throw new Error('opencode_task_admission_invalid')
    }
    if (this.admissions.size >= this.input.policy.maxTasks) throw new Error('opencode_task_limit_exceeded')
    this.admissions.add(callID)
    return children[0]!.id
  }

  async idle(signal: AbortSignal = AbortSignal.timeout(5_000)): Promise<boolean> {
    const statuses = await Promise.all(this.sessionIds.map((id) => getOpencodeSessionStatus(this.request(id, signal))))
    if (statuses.some((status) => status?.type === 'retry')) throw new Error('opencode_task_provider_retry')
    return statuses.every((status) => !status || status.type === 'idle')
  }

  /** Stop admission first, then drain every verified child, including late creations. */
  async stop(timeoutMs: number): Promise<void> {
    this.stopping = true
    const signal = AbortSignal.timeout(timeoutMs)
    const request = this.request(this.input.sessionId, signal)
    const root = await getOpencodeSession(request)
    this.validate(root, false)
    const stopped = await updateOpencodeSessionMetadata({ ...request, metadata: { ...root.metadata,
      devflow: { ...(root.metadata!.devflow as Record<string, unknown>), stopped: true } } })
    if ((stopped.metadata?.devflow as Record<string, unknown> | undefined)?.stopped !== true) throw new Error('opencode_task_stop_unacknowledged')
    if (await abortOpencodeSession(request) !== true) throw new Error('opencode_task_abort_unacknowledged')
    for (const sessionId of this.children.keys()) {
      if (await abortOpencodeSession(this.request(sessionId, signal)) !== true) throw new Error('opencode_task_abort_unacknowledged')
    }
    while (!signal.aborted) {
      await this.refresh(signal)
      for (const sessionId of this.sessionIds) {
        if (await abortOpencodeSession(this.request(sessionId, signal)) !== true) throw new Error('opencode_task_abort_unacknowledged')
      }
      for (const permission of await listOpencodePermissions(request)) {
        if (this.owns(permission.sessionID)) {
          try {
            if (await replyOpencodePermission({ ...request, requestId: permission.id, reply: 'reject', message: 'DevFlow stopped this coding run.' }) !== true) throw new Error('opencode_task_reject_unacknowledged')
          } catch (error) { if (!(error instanceof OpencodeHttpRequestError && error.statusCode === 404)) throw error }
        }
      }
      for (const question of await listOpencodeQuestions(request)) {
        if (this.owns(question.sessionID)) {
          try { await replyOpencodeQuestion({ ...request, requestId: question.id, reply: { kind: 'dismiss' } }) }
          catch (error) { if (!(error instanceof OpencodeHttpRequestError && error.statusCode === 404)) throw error }
        }
      }
      const previousCount = this.children.size
      await this.refresh(signal)
      const permissions = await listOpencodePermissions(request)
      const questions = await listOpencodeQuestions(request)
      if (previousCount === this.children.size && await this.idle(signal) &&
        !permissions.some((item) => this.owns(item.sessionID)) && !questions.some((item) => this.owns(item.sessionID))) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('opencode_task_cleanup_timed_out')
  }
}
