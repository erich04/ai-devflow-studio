import { describe, expect, it } from 'vitest'
import { createDefaultOpencodePermissionRules, type OpencodeSession, type Fetcher } from './opencode-http-adapter'
import { OpencodeTaskScope } from './opencode-task-scope'
import { CodingEngineTaskLimitError } from './coding-engine-lifecycle'

function fixture() {
  const rules = createDefaultOpencodePermissionRules({ question: true })
  const marker = { owner: 'owner', codingRunId: 'run', workspaceId: 'workspace' }
  const root: OpencodeSession = { id: 'root', directory: '/managed', permission: rules, metadata: { devflow: marker } }
  const child: OpencodeSession = { id: 'child', directory: '/managed', parentID: 'root', agent: 'devflow-worker', permission: rules,
    metadata: { devflow: { ...marker, rootSessionId: 'root', taskCallId: 'task-call' } } }
  const state = { children: [child], grandchildren: [] as OpencodeSession[], busy: true, childAborted: false, lateChild: false,
    question: true, permission: true, calls: [] as string[] }
  const fetcher: Fetcher = async (input, init) => {
    const route = new URL(String(input)).pathname
    state.calls.push(`${init?.method ?? 'GET'} ${route}`)
    let value: unknown
    if (route === '/session/root' && init?.method === 'PATCH') {
      root.metadata = JSON.parse(String(init.body)).metadata
      value = root
    } else if (route === '/session/root') value = root
    else if (route === '/session/root/children') value = state.children
    else if (route.endsWith('/children')) value = state.grandchildren
    else if (route === '/session/status') value = { root: { type: 'idle' }, child: { type: state.busy ? 'busy' : 'idle' } }
    else if (route.endsWith('/abort')) {
      if (route === '/session/child/abort') { state.busy = false; state.childAborted = true }
      if (route === '/session/root/abort' && state.lateChild) { state.children = [child]; state.lateChild = false }
      value = true
    } else if (route === '/permission') value = [{ id: 'unrelated-permission', sessionID: 'foreign', permission: 'bash' },
      ...(state.permission ? [{ id: 'child-permission', sessionID: 'child', permission: 'bash' }] : [])]
    else if (route === '/question') value = [{ id: 'foreign-question', sessionID: 'foreign', questions: [{ header: 'H', question: 'Q', options: [] }] },
      ...(state.question ? [{ id: 'child-question', sessionID: 'child', questions: [{ header: 'H', question: 'Q', options: [] }] }] : [])]
    else if (route === '/permission/child-permission/reply') { state.permission = false; value = true }
    else if (route === '/question/child-question/reject') { state.question = false; value = true }
    else throw new Error(`Unexpected ${route}`)
    return new Response(JSON.stringify(value))
  }
  const scope = new OpencodeTaskScope({ baseUrl: 'http://localhost', directory: '/managed', sessionId: 'root', codingRunId: 'run', workspaceId: 'workspace', fetcher,
    policy: { ...marker, providerID: 'fixture', modelID: 'model', maxTasks: 4, maxToolTurns: 24, maxModelCalls: 32, parentRules: rules, childRules: rules } })
  const permission = { id: 'task-permission', sessionID: 'root', permission: 'task', patterns: ['devflow-worker'], tool: { messageID: 'message', callID: 'task-call' } }
  return { scope, root, child, state, permission }
}

describe('OpenCode child session ownership', () => {
  it.each(['tool_turn_limit', 'model_call_limit', 'task_limit'] as const)('retains a verified guard stop reason through host observation and cleanup: %s', async (reason) => {
    const f = fixture()
    await f.scope.refresh()
    Object.assign(f.root.metadata!.devflow as object, { stopped: true, stopReason: reason })
    await expect(f.scope.refresh()).rejects.toEqual(new CodingEngineTaskLimitError(reason))
    await f.scope.stop(2000)
    expect(f.state.childAborted).toBe(true)
    expect(await f.scope.idle()).toBe(true)
    expect(f.root.metadata!.devflow).toMatchObject({ stopped: true, stopReason: reason })
  })

  it('does not trust a budget reason before verifying root ownership', async () => {
    const f = fixture()
    Object.assign(f.root.metadata!.devflow as object, { owner: 'foreign', stopped: true, stopReason: 'tool_turn_limit' })
    await expect(f.scope.refresh()).rejects.toThrow('scope_invalid')
  })
  it('requires a precreated, verified child for the exact parent call; never admits a missing guard', async () => {
    const f = fixture()
    expect(await f.scope.admit(f.permission)).toBe('child')
    await expect(f.scope.admit(f.permission)).rejects.toThrow('admission_invalid')
    const missing = fixture()
    missing.state.children = []
    await expect(missing.scope.admit(missing.permission)).rejects.toThrow('admission_invalid')
  })
  it.each(['owner', 'parent', 'directory', 'workspace', 'permissions', 'nested', 'duplicate'] as const)('rejects invalid child scope: %s', async (scenario) => {
    const f = fixture()
    if (scenario === 'owner') (f.child.metadata!.devflow as Record<string, unknown>).owner = 'other'
    if (scenario === 'parent') f.child.parentID = 'other'
    if (scenario === 'directory') f.child.directory = '/other'
    if (scenario === 'workspace') (f.child.metadata!.devflow as Record<string, unknown>).workspaceId = 'other'
    if (scenario === 'permissions') f.child.permission = [{ permission: '*', pattern: '*', action: 'allow' }]
    if (scenario === 'nested') f.state.grandchildren = [{ ...f.child, id: 'grandchild', parentID: 'child' }]
    if (scenario === 'duplicate') f.state.children.push(f.child)
    await expect(f.scope.refresh()).rejects.toThrow()
    expect(f.scope.owns('child')).toBe(false)
  })
  it('does not treat parent completion or a disappeared child as proof of completion', async () => {
    const f = fixture()
    await f.scope.refresh()
    expect(await f.scope.idle()).toBe(false)
    f.state.children = []
    await expect(f.scope.refresh()).rejects.toThrow('scope_lost')
  })
  it('closes admission before draining late children and leaves foreign requests alone', async () => {
    const f = fixture()
    f.state.children = []
    f.state.lateChild = true
    await f.scope.stop(2000)
    expect(f.state.childAborted).toBe(true)
    expect(f.state.permission || f.state.question).toBe(false)
    expect(f.state.calls.indexOf('PATCH /session/root')).toBeLessThan(f.state.calls.indexOf('POST /session/root/abort'))
    expect(f.state.calls.some((call) => call.startsWith('POST') && /foreign|unrelated/u.test(call))).toBe(false)
    await expect(f.scope.admit(f.permission)).rejects.toThrow('admission_invalid')
  })
})
