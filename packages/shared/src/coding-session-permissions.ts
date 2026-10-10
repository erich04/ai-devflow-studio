import type { CodingPermissionRequest, CodingSessionGrant } from './domain.js'

/** A grant description; executor policy and exact-request validation still run on every use. */
export function codingSessionPermissionRule(request: CodingPermissionRequest): CodingSessionGrant['rule'] | undefined {
  if (request.status !== 'pending' || request.risk === 'blocked' ||
      (request.origin && request.origin !== 'coding_executor')) return undefined
  if (request.permission === 'bash') {
    const command = request.command
    return command && command.length <= 8_192 && !/\0|\[redacted/i.test(command)
      ? { kind: 'command', command } : undefined
  }
  if (!['edit', 'write', 'patch'].includes(request.permission)) return undefined
  const paths = [...new Set(request.filePaths ?? (request.filePath ? [request.filePath] : []))].sort()
  if (!paths.length || paths.length > 100 || paths.some((path) =>
    !path || path.length > 1024 || /[\\\0]/u.test(path) || path.startsWith('/') || /^[a-z]:/iu.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git'))) return undefined
  return { kind: 'files', paths }
}

export function describeCodingSessionRule(rule: CodingSessionGrant['rule']): string {
  return rule.kind === 'command' ? `完整命令：${rule.command}` : `仅这些文件的编辑、写入与补丁：${rule.paths.join('、')}`
}
