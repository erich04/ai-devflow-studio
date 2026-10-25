import { describe, expect, it, vi } from 'vitest'
import { createDefaultOpencodePermissionRules, type OpencodeSession } from './opencode-http-adapter'
import { createOpencodeTaskGuard, type OpencodeTaskPolicy } from './opencode-task-guard'

const policy: OpencodeTaskPolicy = {
  owner: 'private-owner', providerID: 'fixture', modelID: 'fixture', maxTasks: 2, maxToolTurns: 8, maxModelCalls: 8,
  parentRules: [...createDefaultOpencodePermissionRules({ question: true }), { permission: 'task', pattern: 'devflow-worker', action: 'ask' }],
  childRules: createDefaultOpencodePermissionRules({ question: true }),
}

function fixture(factory = createOpencodeTaskGuard, readDocument?: (input: { url: string; signal: AbortSignal }) => Promise<unknown>) {
  const activePolicy = readDocument ? { ...policy, publicDocuments: true,
    parentRules: [...policy.parentRules, { permission: 'devflow_document', pattern: '*', action: 'allow' as const }],
    childRules: [...policy.childRules, { permission: 'devflow_document', pattern: '*', action: 'allow' as const }],
  } : policy
  const root: OpencodeSession = { id: 'root', directory: '/managed', permission: activePolicy.parentRules,
    metadata: { devflow: { owner: policy.owner, codingRunId: 'run', workspaceId: 'workspace' } } }
  const sessions = new Map([['root', root]])
  let creates = 0
  const api = async (pathname: string, body?: Record<string, unknown>, method?: string): Promise<unknown> => {
    if (pathname === '/session/status') return {}
    if (pathname.endsWith('/abort')) return true
    if (pathname === '/session') {
      creates++
      const child = { ...body, id: `child-${creates}`, directory: '/managed' } as OpencodeSession
      sessions.set(child.id, child)
      return structuredClone(child)
    }
    const session = sessions.get(pathname.split('/')[2]!)
    if (!session) throw new Error('missing session')
    if (method === 'PATCH') Object.assign(session, body)
    return structuredClone(session)
  }
  const hooks = factory(activePolicy, { directory: '/managed', api, ...(readDocument ? { readDocument } : {}) })
  const task = (callID = 'task-1', args: Record<string, unknown> = {}) => {
    const output = { args: { description: 'Small task', prompt: 'Write one file.', subagent_type: 'devflow-worker', ...args } }
    return hooks['tool.execute.before']({ tool: 'task', sessionID: 'root', callID }, output).then(() => output.args)
  }
  return { root, sessions, hooks, task, creates: () => creates }
}

describe('managed OpenCode task guard', () => {
  it('precreates a child with exact permissions and links the task call to its parent', async () => {
    const f = fixture()
    const args = await f.task()
    expect(args).toMatchObject({ task_id: 'child-1' })
    expect(f.sessions.get('child-1')).toMatchObject({ parentID: 'root', permission: policy.childRules,
      agent: 'devflow-worker', model: { providerID: 'fixture', id: 'fixture' },
      metadata: { devflow: { owner: policy.owner, rootSessionId: 'root', codingRunId: 'run', workspaceId: 'workspace', taskCallId: 'task-1' } } })
    await f.hooks['tool.execute.before']({ tool: 'write', sessionID: 'child-1', callID: 'write-1' }, { args: {} })
    await expect(f.hooks['tool.execute.before']({ tool: 'write', sessionID: 'root', callID: 'write-2' }, { args: {} })).rejects.toThrow('concurrent')
    await expect(f.hooks['chat.params']({ sessionID: 'root', model: { providerID: 'fixture', id: 'fixture' } })).rejects.toThrow('concurrent_model')
  })

  it.each([{ background: true }, { command: 'shell' }, { subagent_type: 'general' }, { task_id: 'foreign' }, { prompt: '' }, { prompt: 'Read @/private/secret' }, { prompt: 'Ask @general' }])('rejects unsafe task arguments before creation: %j', async (args) => {
    const f = fixture()
    await expect(f.task('bad', args)).rejects.toThrow()
    expect(f.creates()).toBe(0)
  })

  it('rejects nested and concurrent tasks, and counts resumes against the run limit', async () => {
    const f = fixture()
    await f.task()
    await expect(f.task('parallel')).rejects.toThrow('concurrent')
    await expect(f.hooks['tool.execute.before']({ tool: 'task', sessionID: 'child-1', callID: 'nested' }, { args: {} })).rejects.toThrow()
    await f.hooks['tool.execute.after']({ tool: 'task', sessionID: 'root', callID: 'task-1' })
    await f.task('resume', { task_id: 'child-1' })
    expect(f.creates()).toBe(1)
    await f.hooks['tool.execute.after']({ tool: 'task', sessionID: 'root', callID: 'resume' })
    await expect(f.task('excess')).rejects.toThrow('task_limit')
  })

  it('rejects a valid child from another run served by the same process owner', async () => {
    const f = fixture()
    const marker = { owner: policy.owner, codingRunId: 'another-run', workspaceId: 'another-workspace' }
    f.sessions.set('other-root', { ...f.root, id: 'other-root', metadata: { devflow: marker } })
    f.sessions.set('foreign-child', { id: 'foreign-child', directory: '/managed', parentID: 'other-root', agent: 'devflow-worker',
      permission: policy.childRules, metadata: { devflow: { ...marker, rootSessionId: 'other-root', taskCallId: 'earlier' } } })
    await expect(f.task('cross-run', { task_id: 'foreign-child' })).rejects.toThrow('scope_invalid')
    expect(f.creates()).toBe(0)
  })

  it('fails closed on changed ownership, permissions, model and stopped roots', async () => {
    const f = fixture()
    await expect(f.hooks['chat.params']({ sessionID: 'root', model: { providerID: 'fixture', id: 'other' } })).rejects.toThrow('model')
    await f.task()
    const child = f.sessions.get('child-1')!
    child.permission = [{ permission: '*', pattern: '*', action: 'allow' }]
    await expect(f.hooks['tool.execute.before']({ tool: 'write', sessionID: child.id, callID: 'bad' }, { args: {} })).rejects.toThrow('scope')
    f.root.metadata = { devflow: { owner: policy.owner, codingRunId: 'run', workspaceId: 'workspace', stopped: true } }
    await expect(f.hooks['chat.params']({ sessionID: 'root', model: { providerID: 'fixture', id: 'fixture' } })).rejects.toThrow('stopped')
  })

  it('attributes model headers to verified parent and child sessions and rejects stopped scopes', async () => {
    const f = fixture(), output = { headers: { 'X-DevFlow-Coding-Run': 'forged', other: 'kept' } as Record<string, string> }
    await f.hooks['chat.headers']({ sessionID: 'root' }, output)
    expect(output.headers).toEqual({ other: 'kept', 'x-devflow-coding-run': 'run', 'x-devflow-root-session': 'root', 'x-devflow-session': 'root', 'x-devflow-workspace': 'workspace' })
    await f.task()
    await f.hooks['chat.headers']({ sessionID: 'child-1' }, output)
    expect(output.headers['x-devflow-session']).toBe('child-1')
    expect(output.headers['x-devflow-root-session']).toBe('root')
    await expect(f.hooks['chat.headers']({ sessionID: 'foreign' }, output)).rejects.toThrow()
    f.root.metadata!.devflow = { owner: policy.owner, codingRunId: 'run', workspaceId: 'workspace', stopped: true }
    await expect(f.hooks['chat.headers']({ sessionID: 'child-1' }, output)).rejects.toThrow('stopped')
  })

  it('bounds calls across parent and child, including rejected attempts', async () => {
    const f = fixture()
    await f.hooks['chat.params']({ sessionID: 'root', model: { providerID: 'fixture', id: 'fixture' } })
    await f.task()
    for (let i = 1; i < policy.maxModelCalls; i++) await f.hooks['chat.params']({ sessionID: 'child-1', model: { providerID: 'fixture', id: 'fixture' } })
    await expect(f.hooks['chat.params']({ sessionID: 'child-1', model: { providerID: 'fixture', id: 'fixture' } })).rejects.toThrow('model_call_limit')
    const tools = fixture()
    await tools.task()
    for (let i = 1; i < policy.maxToolTurns; i++) {
      await tools.hooks['tool.execute.before']({ tool: 'read', sessionID: 'child-1', callID: `read-${i}` }, { args: {} })
      await tools.hooks['tool.execute.after']({ tool: 'read', sessionID: 'child-1', callID: `read-${i}` })
    }
    await expect(tools.hooks['tool.execute.before']({ tool: 'write', sessionID: 'child-1', callID: 'excess' }, { args: {} })).rejects.toThrow('tool_turn_limit')
  })

  it('closes parent and child model admission immediately after a tool attempt exhausts the shared budget', async () => {
    const f = fixture()
    await f.task()
    for (let i = 1; i < policy.maxToolTurns; i++) {
      await f.hooks['tool.execute.before']({ tool: 'read', sessionID: 'child-1', callID: `read-${i}` }, { args: {} })
      await f.hooks['tool.execute.after']({ tool: 'read', sessionID: 'child-1', callID: `read-${i}` })
    }
    await f.hooks['tool.execute.after']({ tool: 'task', sessionID: 'root', callID: 'task-1' })
    await expect(f.hooks['tool.execute.before']({ tool: 'edit', sessionID: 'root', callID: 'excess' }, { args: {} })).rejects.toThrow('tool_turn_limit')
    await expect(f.hooks['chat.params']({ sessionID: 'root', model: { providerID: 'fixture', id: 'fixture' } })).rejects.toThrow('tool_turn_limit')
    await expect(f.hooks['chat.headers']({ sessionID: 'child-1' }, { headers: {} })).rejects.toThrow('tool_turn_limit')
    expect(f.root.metadata?.devflow).toMatchObject({ stopped: true, stopReason: 'tool_turn_limit' })
  })

  it('keeps the local budget stop latched even if persisting its marker fails', async () => {
    const f = fixture((p, input) => createOpencodeTaskGuard({ ...p, maxToolTurns: 1 }, { ...input,
      api: (path, body, method) => method === 'PATCH' ? Promise.reject(new Error('Unavailable')) : input.api(path, body, method),
    }))
    await f.task()
    await expect(f.hooks['tool.execute.before']({ tool: 'edit', sessionID: 'child-1', callID: 'excess' }, { args: {} })).rejects.toThrow('tool_turn_limit')
    await expect(f.hooks['chat.headers']({ sessionID: 'root' }, { headers: {} })).rejects.toThrow('tool_turn_limit')
    await expect(f.hooks['chat.params']({ sessionID: 'child-1', model: { providerID: 'fixture', id: 'fixture' } })).rejects.toThrow('tool_turn_limit')
  })

  it('does not release a promoted background child for concurrent parent work', async () => {
    const f = fixture()
    await f.task()
    await expect(f.hooks['tool.execute.after']({ tool: 'task', sessionID: 'root', callID: 'task-1' }, { metadata: { background: true } })).rejects.toThrow('child_running')
    await expect(f.hooks['tool.execute.before']({ tool: 'write', sessionID: 'root', callID: 'parallel' }, { args: {} })).rejects.toThrow('concurrent')
  })

  it('can be emitted as a standalone plugin with no module closure', async () => {
    const factory = new Function(`return (${createOpencodeTaskGuard.toString()})`)() as typeof createOpencodeTaskGuard
    expect(await fixture(factory).task()).toMatchObject({ task_id: 'child-1' })
  })
})


describe('managed OpenCode public document tool', () => {
  const url = 'https://nodejs.org/api/assert.html'
  const context = (sessionID = 'root') => ({ sessionID, directory: '/managed', abort: new AbortController().signal, ask: vi.fn(async () => undefined) })
  const enter = (f: ReturnType<typeof fixture>, sessionID = 'root', callID = 'document') => f.hooks['tool.execute.before']({ tool: 'devflow_document', sessionID, callID }, { args: { url } })

  it('reads only an admitted structured URL under the current scope and tool budget', async () => {
    const reader = vi.fn(async () => ({ text: 'reference', trust: 'untrusted-public-reference' })), f = fixture(createOpencodeTaskGuard, reader), ctx = context()
    await enter(f)
    expect(await f.hooks.readDocument({ url }, ctx)).toMatchObject({ text: 'reference' })
    expect(ctx.ask).toHaveBeenCalledWith({ permission: 'devflow_document', patterns: [url], always: [], metadata: { url } })
    expect(reader).toHaveBeenCalledWith({ url, signal: ctx.abort })
    await expect(f.hooks.readDocument({ url: `${url}?changed=1` }, ctx)).rejects.toThrow('document_scope_invalid')
    await f.hooks['tool.execute.after']({ tool: 'devflow_document', sessionID: 'root', callID: 'document' })
    await expect(f.hooks.readDocument({ url }, ctx)).rejects.toThrow('document_scope_invalid')
  })

  it('rejects direct calls, disabled capability, foreign workspace and malformed arguments before network', async () => {
    const reader = vi.fn(async () => ({})), f = fixture(createOpencodeTaskGuard, reader)
    await expect(f.hooks.readDocument({ url }, context())).rejects.toThrow('document_scope_invalid')
    await expect(enter(fixture())).rejects.toThrow('document_disabled')
    await expect(f.hooks['tool.execute.before']({ tool: 'devflow_document', sessionID: 'root', callID: 'bad' }, { args: { url, method: 'POST' } })).rejects.toThrow('document_arguments_invalid')
    await enter(f)
    await expect(f.hooks.readDocument({ url }, { ...context(), directory: '/foreign' })).rejects.toThrow('document_scope_invalid')
    expect(reader).not.toHaveBeenCalled()
  })

  it('uses the existing child ownership and parent/child serialization rules', async () => {
    const reader = vi.fn(async () => ({})), f = fixture(createOpencodeTaskGuard, reader)
    await f.task()
    await expect(enter(f)).rejects.toThrow('concurrent')
    await enter(f, 'child-1')
    await f.hooks.readDocument({ url }, context('child-1'))
    expect(reader).toHaveBeenCalledOnce()
    await expect(f.hooks.readDocument({ url }, context('other-child'))).rejects.toThrow()
  })

  it('does not return late results after cancellation and rejects reads after stopped', async () => {
    const reader = vi.fn(async () => { f.root.metadata!.devflow = { owner: policy.owner, codingRunId: 'run', workspaceId: 'workspace', stopped: true }; return { text: 'late' } })
    const f = fixture(createOpencodeTaskGuard, reader)
    await enter(f)
    await expect(f.hooks.readDocument({ url }, context())).rejects.toThrow('stopped')
    await expect(enter(f, 'root', 'late')).rejects.toThrow('stopped')
    expect(reader).toHaveBeenCalledOnce()
  })

  it('rejects an already-aborted custom tool context without network', async () => {
    const reader = vi.fn(async () => ({})), f = fixture(createOpencodeTaskGuard, reader), controller = new AbortController()
    await enter(f); controller.abort()
    await expect(f.hooks.readDocument({ url }, { ...context(), abort: controller.signal })).rejects.toThrow()
    expect(reader).not.toHaveBeenCalled()
  })
})
