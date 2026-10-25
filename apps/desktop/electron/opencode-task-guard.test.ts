import { describe, expect, it } from 'vitest'
import { createDefaultOpencodePermissionRules, type OpencodeSession } from './opencode-http-adapter'
import { createOpencodeTaskGuard, type OpencodeTaskPolicy } from './opencode-task-guard'

const policy: OpencodeTaskPolicy = {
  owner: 'private-owner', providerID: 'fixture', modelID: 'fixture', maxTasks: 2, maxToolTurns: 8, maxModelCalls: 8,
  parentRules: [...createDefaultOpencodePermissionRules({ question: true }), { permission: 'task', pattern: 'devflow-worker', action: 'ask' }],
  childRules: createDefaultOpencodePermissionRules({ question: true }),
}

function fixture(factory = createOpencodeTaskGuard) {
  const root: OpencodeSession = { id: 'root', directory: '/managed', permission: policy.parentRules,
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
  const hooks = factory(policy, { directory: '/managed', api })
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

  it('bounds calls across parent and child, including rejected attempts', async () => {
    const f = fixture()
    await f.hooks['chat.params']({ sessionID: 'root', model: { providerID: 'fixture', id: 'fixture' } })
    await f.task()
    for (let i = 1; i < policy.maxModelCalls; i++) await f.hooks['chat.params']({ sessionID: 'child-1', model: { providerID: 'fixture', id: 'fixture' } })
    await expect(f.hooks['chat.params']({ sessionID: 'child-1', model: { providerID: 'fixture', id: 'fixture' } })).rejects.toThrow('model_call_limit')
    for (let i = 1; i < policy.maxToolTurns; i++) {
      await f.hooks['tool.execute.before']({ tool: 'read', sessionID: 'child-1', callID: `read-${i}` }, { args: {} })
      await f.hooks['tool.execute.after']({ tool: 'read', sessionID: 'child-1', callID: `read-${i}` })
    }
    await expect(f.hooks['tool.execute.before']({ tool: 'write', sessionID: 'child-1', callID: 'excess' }, { args: {} })).rejects.toThrow('tool_turn_limit')
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
