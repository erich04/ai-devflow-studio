import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// Execute the actual Main cycle without booting Electron. The packaged smoke
// separately exercises these same boundaries against IPC, SQLite and the API.
const source = ts.createSourceFile(
  'main.ts',
  readFileSync('apps/desktop/electron/main.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)
const cycle = source.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) &&
  statement.name?.text === 'processAvailableGitHubDeliveries',
)
if (!cycle) throw new Error('Missing Main delivery cycle')
const executable = ts.transpileModule(cycle.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture(statuses: string[], activeBinding = true) {
  let revision = 0
  const order: string[] = []
  const store = {
    listGitHubDeliveryIntents: vi.fn(async () => statuses.map((status) => ({ status }))),
    getDesktopPairingCredential: vi.fn(async () => ({ projectId: 'project' })),
    getGitHubRepositoryBinding: vi.fn(async () => activeBinding ? { status: 'active' } : null),
  }
  const context = { credential: { projectId: 'project' }, remote: {} }
  const deps = {
    getStore: async () => store,
    getLocalStoreRevision: () => revision,
    runGitHubDeliveryExclusive: async (operation: (signal: AbortSignal) => Promise<void>) => operation(new AbortController().signal),
    createWorkflowRuntime: () => ({}),
    reconcileCompletedGitHubDeliveryIntents: vi.fn(async () => { order.push('local completion') }),
    createCurrentGitHubDeliveryContext: vi.fn(async () => { order.push('context'); return context }),
    createScopedGitHubDeliveryStore: () => store,
    reconcileRemoteCompletedGitHubDeliveryIntents: vi.fn(async () => { order.push('remote completion') }),
    synchronizeGitHubRepositoryBinding: vi.fn(async () => {
      order.push('binding revoked')
      revision += 1
      return { status: 'revoked' }
    }),
    createActiveGitHubDeliveryProcessor: vi.fn(),
    broadcastGitHubDeliveryState: vi.fn(async () => { order.push('broadcast') }),
  }
  const run = runInNewContext(`${executable}\nprocessAvailableGitHubDeliveries`, deps) as () => Promise<void>
  return { run, deps, order, store }
}

describe('Main background delivery authority convergence', () => {
  it.each([['completed'], ['failed'], ['revoked'], []])(
    'observes a later remote revocation even with only terminal or absent delivery work: %j',
    async (...statuses) => {
      const { run, deps, order } = fixture(statuses)
      await run()
      expect(deps.synchronizeGitHubRepositoryBinding).toHaveBeenCalledOnce()
      expect(deps.broadcastGitHubDeliveryState).toHaveBeenCalledOnce()
      expect(order.indexOf('binding revoked')).toBeLessThan(order.indexOf('broadcast'))
      expect(deps.createActiveGitHubDeliveryProcessor).not.toHaveBeenCalled()
    },
  )

  it('keeps a truly idle unbound project away from credentials, network and full state reloads', async () => {
    const { run, deps } = fixture([], false)
    await run()
    expect(deps.createCurrentGitHubDeliveryContext).not.toHaveBeenCalled()
    expect(deps.synchronizeGitHubRepositoryBinding).not.toHaveBeenCalled()
    expect(deps.broadcastGitHubDeliveryState).not.toHaveBeenCalled()
  })

  it('does not publish or reload full state for an unchanged active binding after completion', async () => {
    const { run, deps, store } = fixture(['completed'])
    deps.synchronizeGitHubRepositoryBinding.mockImplementation(async () => ({ status: 'active' }))
    await run()
    expect(store.getGitHubRepositoryBinding).toHaveBeenCalledWith('project')
    expect(deps.synchronizeGitHubRepositoryBinding).toHaveBeenCalledOnce()
    expect(deps.createActiveGitHubDeliveryProcessor).not.toHaveBeenCalled()
    expect(deps.broadcastGitHubDeliveryState).not.toHaveBeenCalled()
  })

  it('settles remote completion before observing revoked authority for pending work', async () => {
    const { run, deps, order } = fixture(['creating_pr'])
    await run()
    expect(order).toEqual(['local completion', 'context', 'remote completion', 'binding revoked', 'broadcast'])
    expect(deps.createActiveGitHubDeliveryProcessor).not.toHaveBeenCalled()
  })
})
