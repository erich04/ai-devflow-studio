import path from 'node:path'
import { codingDigest, type CodingFileEntry, type CodingManifest, type CodingRevision } from './coding-candidate-workspace'
import type { NativeCodingSession } from './native-coding-session'

function isTestConfiguration(file: string): boolean {
  const name = path.posix.basename(file)
  return /^(?:vitest|vite|jest|playwright|cypress|nyc)\.(?:config|workspace|setup)\.[^/]+$/iu.test(name) ||
    /^(?:setupTests|test[.-]setup)\.[^/]+$/iu.test(name) ||
    ['conftest.py', 'pytest.ini', 'tox.ini', 'phpunit.xml', '.nycrc', '.nycrc.json'].includes(name.toLowerCase())
}

/** Recognized test programs, fixtures and runner configuration are acceptance
 * inputs. This convention-based guard does not prove semantic test coverage. */
export function isCodingTestInput(file: string): boolean {
  const name = path.posix.basename(file)
  return /(?:^|\/)(?:tests?|__tests__|__fixtures__|__mocks__|__snapshots__|fixtures|testdata)(?:\/|$)/iu.test(file) ||
    /\.(?:test|spec)\.[^/]+$/iu.test(name) || /^test_.+\.py$/iu.test(name) || /_test\.(?:go|py|rs)$/iu.test(name) ||
    /^(?:fixtures?)\.[^/]+$/iu.test(name) || isTestConfiguration(file)
}

export type CodingTestInputUpdate = {
  version: 1; baselineDigest: string
  changes: Array<{ path: string; before: CodingFileEntry | null; after: CodingFileEntry | null }>
}
export function codingTestInputUpdate(base: CodingManifest, target: CodingManifest): CodingTestInputUpdate | undefined {
  const current = new Map(target.files.map(file => [file.path, file]))
  const changes: CodingTestInputUpdate['changes'] = base.files.filter(file => isCodingTestInput(file.path)).flatMap(before => {
    const after = current.get(before.path)
    return after?.hash === before.hash && after.mode === before.mode ? [] : [{ path: before.path, before, after: after ?? null }]
  })
  const baseline = new Set(base.files.map(file => file.path))
  // New test programs can add coverage; new config can silently exclude the
  // original programs, so it requires the same separate authorization.
  for (const after of target.files) if (!baseline.has(after.path) && isTestConfiguration(after.path)) changes.push({ path: after.path, before: null, after })
  changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return changes.length ? { version: 1, baselineDigest: base.digest, changes } : undefined
}

export function codingTestInputPermissionDetails(update: CodingTestInputUpdate): string {
  const shown = update.changes.slice(0, 20).map(change => `${change.path}\n  ${change.before?.hash ?? '(新增)'} → ${change.after?.hash ?? '(删除)'}`)
  return `本次候选更改了 ${update.changes.length} 个验收输入（既有测试、夹具或测试配置）。代码编辑授权不等于修改验收输入的授权。\n${shown.join('\n')}\n${update.changes.length > shown.length ? `其余 ${update.changes.length - shown.length} 项也绑定在内容摘要中。\n` : ''}完整变更摘要：${codingDigest(JSON.stringify(update))}\n仅授权这些精确内容进入待审修订；最终仍需审查完整 Diff 和验证结果。也可拒绝，并保留旧测试、将新增检查放入新文件。`
}

/** Final approval must not outlive or broaden the separate test-input grant. */
export function assertCodingTestInputAuthority(session: NativeCodingSession, revision: CodingRevision): void {
  if (session.binding?.testInputPolicyVersion !== 1) return
  const update = codingTestInputUpdate(revision.base, revision.target)
  if (!update) return
  const digest = codingDigest(JSON.stringify({ kind: 'test_inputs', value: update }))
  const policyDigest = session.binding.permissionPolicy ? codingDigest(JSON.stringify(session.binding.permissionPolicy)) : undefined
  const relevant = session.permissions.filter(permission => permission.kind === 'test_inputs' && permission.digest === digest && permission.objectiveVersion === session.objectiveVersion && permission.policyDigest === policyDigest && Date.parse(permission.expiresAt) > Date.now())
  const grant = relevant.filter(permission => permission.decision === 'rejected' || permission.scope === 'task' || revision.id === `changeset-${codingDigest(`${session.id}:${permission.operationId}`)}`).at(-1)
  if (grant?.decision !== 'approved') throw new Error('Existing test inputs changed without current exact-content authorization; restore them or obtain a separate test-input grant before final approval')
}
