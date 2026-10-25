import type { OpencodePermissionRule, OpencodeSession } from './opencode-http-adapter.js'

export type OpencodeTaskPolicy = {
  owner: string
  providerID: string
  modelID: string
  maxTasks: number
  maxToolTurns: number
  maxModelCalls: number
  parentRules: OpencodePermissionRule[]
  childRules: OpencodePermissionRule[]
}

type GuardInput = {
  directory: string
  api(path: string, body?: Record<string, unknown>, method?: string): Promise<unknown>
}
type ToolCall = { tool: string; sessionID: string; callID: string }

/**
 * This function is also emitted into the private OpenCode runtime directory.
 * Keep its runtime dependencies inside the function: the packaged desktop must
 * not depend on a source checkout, npm plugin download, or a project plugin.
 * OpenCode still executes its built-in task tool; this hook only admits bounded
 * foreground children with explicit permissions before that tool asks the host.
 */
export function createOpencodeTaskGuard(policy: OpencodeTaskPolicy, input: GuardInput) {
  type State = { tasks: number; tools: Set<string>; modelCalls: number; activeTask?: { callID: string; childID?: string }; activeTool?: string }
  const states = new Map<string, State>()
  const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
  const marker = (session: OpencodeSession) => record(session.metadata?.devflow) ? session.metadata.devflow : {}
  const fail = (reason: string): never => { throw new Error(`devflow_task_${reason}`) }
  const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,200}$/u.test(value)
  const get = async (sessionID: string) => {
    if (!id(sessionID)) fail('scope_invalid')
    const session = await input.api(`/session/${sessionID}`) as OpencodeSession
    if (!session || session.id !== sessionID || session.directory !== input.directory || marker(session).owner !== policy.owner) fail('scope_invalid')
    return session
  }
  const scope = async (sessionID: string) => {
    const session = await get(sessionID)
    const root = session.parentID ? await get(session.parentID) : session
    const rootMarker = marker(root)
    if (root.parentID || !id(rootMarker.codingRunId) || !id(rootMarker.workspaceId) ||
      JSON.stringify(root.permission) !== JSON.stringify(policy.parentRules)) fail('scope_invalid')
    if (rootMarker.stopped) fail('stopped')
    if (session.parentID && (marker(session).rootSessionId !== root.id ||
      marker(session).codingRunId !== rootMarker.codingRunId || marker(session).workspaceId !== rootMarker.workspaceId ||
      session.agent !== 'devflow-worker' || JSON.stringify(session.permission) !== JSON.stringify(policy.childRules))) fail('scope_invalid')
    let state = states.get(root.id)
    if (!state) { state = { tasks: 0, tools: new Set(), modelCalls: 0 }; states.set(root.id, state) }
    return { session, root, state }
  }
  const release = (call: ToolCall) => {
    const key = `${call.sessionID}:${call.callID}`
    for (const state of states.values()) {
      if (state.activeTool === key) delete state.activeTool
      if (call.tool === 'task' && state.activeTask?.callID === key) delete state.activeTask
    }
  }
  const idle = async (sessionID: string) => {
    const statuses = await input.api('/session/status')
    if (!record(statuses)) fail('status_invalid')
    const status = (statuses as Record<string, unknown>)[sessionID]
    return status === undefined || (record(status) && status.type === 'idle')
  }
  return {
    async 'chat.params'(call: { sessionID: string; model: { providerID: string; id: string } }) {
      const { state, session } = await scope(call.sessionID)
      if (call.model.providerID !== policy.providerID || call.model.id !== policy.modelID) fail('model_mismatch')
      if (session.parentID ? state.activeTask?.childID !== session.id : state.activeTask) fail('concurrent_model')
      if (++state.modelCalls > policy.maxModelCalls) fail('model_call_limit')
    },
    async 'tool.execute.before'(call: ToolCall, output: { args: Record<string, unknown> }) {
      const { session, root, state } = await scope(call.sessionID)
      const key = `${call.sessionID}:${call.callID}`
      if (state.tools.has(key)) fail('duplicate_tool_call')
      state.tools.add(key)
      if (state.tools.size > policy.maxToolTurns) fail('tool_turn_limit')
      if (call.tool !== 'task') {
        if (state.activeTool || (state.activeTask && state.activeTask.childID !== session.id)) fail('concurrent_tools')
        if (session.parentID && state.activeTask?.childID !== session.id) fail('scope_invalid')
        state.activeTool = key
        return
      }
      if (session.parentID) fail('nested_task')
      if (state.activeTask || state.activeTool) fail('concurrent_tasks')
      if (++state.tasks > policy.maxTasks) fail('task_limit')
      const args = output.args
      if (args.subagent_type !== 'devflow-worker' || args.background === true || args.command !== undefined ||
        typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 32_000 || args.prompt.includes('@') ||
        typeof args.description !== 'string' || !args.description.trim() || args.description.length > 200) fail('arguments_invalid')
      state.activeTask = { callID: key }
      try {
        const childMetadata = { devflow: { ...marker(root), rootSessionId: root.id, taskCallId: call.callID } }
        let child: OpencodeSession
        if (args.task_id !== undefined) {
          if (!id(args.task_id)) fail('scope_invalid')
          const found = await scope(args.task_id as string)
          if (found.session.parentID !== root.id) fail('scope_invalid')
          if (!await idle(found.session.id)) fail('child_running')
          child = await input.api(`/session/${found.session.id}`, { metadata: childMetadata }, 'PATCH') as OpencodeSession
        } else {
          child = await input.api('/session', { parentID: root.id, title: args.description, agent: 'devflow-worker',
            model: { providerID: policy.providerID, id: policy.modelID }, permission: policy.childRules, metadata: childMetadata }) as OpencodeSession
        }
        // Creation and cancellation may race. A stopped root cannot launch this child.
        const checked = await scope(child.id)
        if (checked.root.id !== root.id || checked.session.parentID !== root.id) fail('scope_invalid')
        state.activeTask.childID = child.id
        args.task_id = child.id
      } catch (error) {
        delete state.activeTask
        throw error
      }
    },
    async 'tool.execute.after'(call: ToolCall, output?: { metadata?: Record<string, unknown> }) {
      if (call.tool === 'task') {
        for (const state of states.values()) {
          if (state.activeTask?.callID !== `${call.sessionID}:${call.callID}` || !state.activeTask.childID) continue
          if (output?.metadata?.background === true || !await idle(state.activeTask.childID)) {
            await input.api(`/session/${state.activeTask.childID}/abort`, {})
            fail('child_running')
          }
        }
      }
      release(call)
    },
    async event({ event }: { event: { type: string; properties: Record<string, unknown> } }) {
      if (event.type !== 'message.part.updated') return
      const part = event.properties.part
      if (!record(part) || part.type !== 'tool' || !record(part.state) ||
        !['completed', 'error'].includes(String(part.state.status)) || !id(part.sessionID) || !id(part.callID)) return
      // An error may arrive without an after hook. Stop the child before releasing
      // a failed parent task, so a later parent tool cannot race a lingering writer.
      if (part.tool === 'task' && part.state.status === 'error') {
        for (const state of states.values()) {
          if (state.activeTask?.callID === `${part.sessionID}:${part.callID}` && state.activeTask.childID) {
            try { await input.api(`/session/${state.activeTask.childID}/abort`, {}) }
            catch { return } // Fail closed: leave the reservation held for host cleanup.
          }
        }
      }
      release({ tool: String(part.tool), sessionID: part.sessionID, callID: part.callID })
    },
  }
}

export function opencodeTaskPluginSource(policy: OpencodeTaskPolicy, baseUrl: string): string {
  // tsx/esbuild's keepNames transform may wrap local functions with __name.
  // The emitted module owns that inert helper as well as the guard body.
  return `const __name = (value) => value;
const createGuard = ${createOpencodeTaskGuard.toString()};
export default async ({ directory }) => createGuard(${JSON.stringify(policy)}, {
  directory,
  async api(path, body, method) {
    const response = await fetch(${JSON.stringify(baseUrl)} + path + '?directory=' + encodeURIComponent(directory), {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('devflow_task_protocol_error');
    return response.json();
  }
});\n`
}
