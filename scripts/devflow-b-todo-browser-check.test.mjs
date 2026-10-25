// Control-plane/file-serving tests only; these do not claim generated Todo behavior acceptance.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { selectFinalWorkspace, serveTodo } from './devflow-b-todo-browser-check.mjs'

const ready = { runId: 'workflow', projectId: 'project', repo: '/isolated/todo', profile: '/isolated/profile', profileFingerprint: 'profile-fingerprint' }
const coding = { id: 'coding-exact', runId: ready.runId, projectId: ready.projectId, nodeId: 'build', engine: 'opencode-http', status: 'waiting_permission', managedWorkspaceId: 'workspace', diffArtifactId: 'diff', testEvidenceId: 'test' }
const workspace = { id: 'workspace', codingRunId: coding.id, projectId: ready.projectId, sourcePath: ready.repo, worktreePath: '/isolated/profile/coding-worktrees/coding-exact', cleanupStatus: 'active' }
const permission = { id: 'final-permission', codingRunId: coding.id, runId: ready.runId, nodeId: 'build', managedWorkspaceId: workspace.id, origin: 'change_acceptance', status: 'pending', diffArtifactId: 'diff', testEvidenceId: 'test', diffSourceDigest: 'a'.repeat(64) }
const state = { profileFingerprint: ready.profileFingerprint, runs: [{ id: ready.runId, projectId: ready.projectId }], projects: [{ id: ready.projectId, path: ready.repo }],
  codingRuns: [coding], managedCodingWorkspaces: [workspace], codingPermissionRequests: [permission],
  testEvidence: [{ id: 'test', runId: ready.runId, projectId: ready.projectId, nodeId: 'build', status: 'passed', cwd: '<workspace>', command: 'npm test', sourceTree: { digest: 'b'.repeat(64), workspaceId: workspace.id } }],
  codingDiffArtifacts: [{ id: 'diff', runId: ready.runId, projectId: ready.projectId, nodeId: 'build', truncated: false, sourceDigest: permission.diffSourceDigest }] }

test('selects only the explicit Coding Run at final acceptance; supports completed approved runs', () => {
  assert.equal(selectFinalWorkspace(state, ready, coding.id).worktreePath, workspace.worktreePath)
  const completed = structuredClone(state); completed.codingRuns[0].status = 'completed'; completed.codingPermissionRequests[0].status = 'approved'
  assert.equal(selectFinalWorkspace(completed, ready, coding.id).status, 'completed')
  assert.throws(() => selectFinalWorkspace(state, ready, 'latest'))
})

test('refuses incomplete/failed runs, ordinary permissions and cross-profile/workspace evidence', () => {
  const changes = [
    s => { s.profileFingerprint = 'other' },
    s => { s.projects[0].path = '/business/repo' },
    s => { s.codingRuns[0].status = 'failed' },
    s => { s.codingRuns[0].status = 'waiting_input' },
    s => { s.codingRuns[0].runId = 'other' },
    s => { s.managedCodingWorkspaces[0].codingRunId = 'other' },
    s => { s.managedCodingWorkspaces[0].worktreePath = '/business/repo' },
    s => { s.managedCodingWorkspaces[0].deletedAt = 'now' },
    s => { s.codingPermissionRequests[0].origin = 'coding_executor' },
    s => { s.codingPermissionRequests[0].managedWorkspaceId = 'other' },
    s => { s.codingPermissionRequests[0].diffSourceDigest = 'c'.repeat(64) },
    s => { s.testEvidence[0].status = 'failed' },
    s => { s.testEvidence[0].sourceTree.workspaceId = 'other' },
    s => { s.codingDiffArtifacts[0].nodeId = 'other' },
    s => { s.codingDiffArtifacts[0].truncated = true },
  ]
  for (const mutate of changes) { const changed = structuredClone(state); mutate(changed); assert.throws(() => selectFinalWorkspace(changed, ready, coding.id)) }
})

test('static server exposes only exact app assets over a random loopback port without writes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devflow-browser-server-'))
  const worktree = await (await import('node:fs/promises')).realpath(directory)
  let server
  try {
    await mkdir(path.join(worktree, 'src'))
    await writeFile(path.join(worktree, 'index.html'), '<title>server-only fixture</title>')
    await writeFile(path.join(worktree, 'src/app.js'), 'export const fixture = true')
    await writeFile(path.join(worktree, 'private.txt'), 'do not serve')
    await symlink(path.join(worktree, 'private.txt'), path.join(worktree, 'src/store.js'))
    server = await serveTodo(worktree)
    assert.equal(new URL(server.origin).hostname, '127.0.0.1')
    assert.match(await (await fetch(server.origin)).text(), /server-only fixture/)
    assert.equal((await fetch(server.origin + '/src/app.js', { method: 'HEAD' })).status, 200)
    for (const target of ['/private.txt', '/.git/config', '/src/../private.txt', '/src/%2e%2e/private.txt', '/src/app.js?other']) {
      assert.equal((await fetch(server.origin + target)).status, 404)
    }
    assert.equal((await fetch(server.origin + '/src/app.js', { method: 'POST', body: 'overwrite' })).status, 404)
    assert.equal((await fetch(server.origin + '/src/store.js')).status, 500, 'Symlink target must never be served')
    assert.equal(await (await fetch(server.origin + '/src/app.js')).text(), 'export const fixture = true')
  } finally { await server?.close(); await rm(directory, { recursive: true, force: true }) }
})
