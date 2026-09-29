import type {
  DesktopPairingCredential,
  GitHubDeliveryIntent,
  RemoteSyncOperation,
} from '@ai-devflow/shared'

/**
 * Team connection, team data updates and result uploads are three separate facts
 * (plan §6.5). None of them may be used to prove another, and a local project that
 * was never connected is not a sync failure (plan D3, T4, X3).
 */
export type TeamConnectionTone = 'neutral' | 'ok' | 'progress' | 'warning'

export type UploadRecordView = {
  id: string
  kindLabel: string
  statusLabel: string
  reason: string
  tone: TeamConnectionTone
  canRetry: boolean
  code: string | null
  target: string | null
}

export type TeamConnectionView = {
  connection: 'local' | 'connected' | 'reconnect'
  tone: TeamConnectionTone
  /** Short label for the top bar trigger. */
  summary: string
  connectionLine: string
  /** Credential expiry, from the local record only (plan X3); empty without a credential. */
  expiryLine: string
  dataLine: string
  /** The policy snapshot is its own fact, separate from project and member data (plan §6.5). */
  policyLine: string
  uploadLine: string
  records: UploadRecordView[]
  /** The popover's one way into 设置／团队连接 (plan Y7), named after what needs attention. */
  detailsActionLabel: '连接团队' | '重新连接' | '查看上传详情' | '查看连接详情'
}

/** Policy snapshot as read by the desktop (useGateEnforcement); times are already formatted. */
export type TeamPolicyReadState = {
  status: 'loading' | 'loaded' | 'failed' | 'unavailable'
  version?: number | undefined
  syncedAt?: string | undefined
  source?: 'remote_cache' | 'built_in_default' | 'unavailable' | undefined
  error?: string | undefined
}

export type TeamConnectionInput = {
  localProjectId: string | undefined
  pairing: DesktopPairingCredential | null
  pairingExpired: boolean
  /** Remote sync operations of the selected local project that are not completed. */
  operations: readonly RemoteSyncOperation[]
  teamProjectName?: string | undefined
  teamDataReadAt?: string | null | undefined
  teamDataError?: string | null | undefined
  policy?: TeamPolicyReadState | undefined
  /** Formats the credential expiry; the view model stays free of locale code. */
  formatTime?: ((iso: string) => string) | undefined
}

const kindLabels: Record<RemoteSyncOperation['kind'], string> = {
  'run-summary': '任务摘要',
  'test-evidence-summary': '测试证据',
  'agent-review-summary': '审查结果',
  'coding-agent-summary': '开发执行',
  'agent-runtime-summary': '运行时记录',
  'agent-memory-summary': '记忆',
  'agent-coordination-summary': '协作记录',
}

function hasTarget(operation: RemoteSyncOperation): boolean {
  return operation.organizationId !== null || operation.teamProjectId !== null
}

/**
 * An `unauthorized` failure only says something about the current credential when it
 * happened after that credential was issued; older failures predate a re-pairing.
 */
function rejectedByCurrentCredential(operation: RemoteSyncOperation, pairing: DesktopPairingCredential | null): boolean {
  if (!pairing || operation.status !== 'terminal' || operation.lastErrorCode !== 'unauthorized') return false
  const failedAt = Date.parse(operation.lastAttemptAt ?? operation.updatedAt)
  const issuedAt = Date.parse(pairing.createdAt)
  return !Number.isFinite(failedAt) || !Number.isFinite(issuedAt) || failedAt >= issuedAt
}

function targetMatchesPairing(operation: RemoteSyncOperation, pairing: DesktopPairingCredential | null): boolean {
  return Boolean(
    pairing &&
      operation.organizationId === pairing.organizationId &&
      operation.teamProjectId === pairing.projectId,
  )
}

export function describeUploadRecord(
  operation: RemoteSyncOperation,
  input: Pick<TeamConnectionInput, 'localProjectId' | 'pairing' | 'pairingExpired'>,
): UploadRecordView {
  const pairing = input.pairingExpired ? null : input.pairing
  const pairedHere = Boolean(pairing && pairing.localProjectId === input.localProjectId)
  const base = {
    id: operation.id,
    kindLabel: kindLabels[operation.kind] ?? operation.kind,
    code: operation.lastErrorCode,
    target: operation.teamProjectId,
  }
  const inFlight = operation.status === 'pending' || operation.status === 'sending' || operation.status === 'retry-scheduled'
  // Without a credential nothing is being sent, so queued records are not "uploading" (plan §6.5).
  if (inFlight && !pairing) {
    return hasTarget(operation)
      ? { ...base, statusLabel: '未上传', reason: `需要重新连接到 ${operation.teamProjectId ?? '原团队项目'} 后才会上传。`, tone: 'warning', canRetry: false }
      : { ...base, statusLabel: '未上传', reason: '当前未启用团队上传。连接团队后会自动尝试上传。', tone: 'neutral', canRetry: false }
  }
  if (operation.status === 'pending' || operation.status === 'sending') {
    return { ...base, statusLabel: '正在上传', reason: '收到团队服务的回执后才算已上传。', tone: 'progress', canRetry: false }
  }
  if (operation.status === 'retry-scheduled') {
    return { ...base, statusLabel: '等待重试', reason: '上一次上传没有成功，稍后会自动重试。', tone: 'progress', canRetry: false }
  }
  if (operation.status === 'completed') {
    return { ...base, statusLabel: '已上传', reason: '团队服务已确认收到。', tone: 'ok', canRetry: false }
  }
  // Terminal records: explain the reason and only offer retry when it can succeed.
  if (!hasTarget(operation)) {
    if (!pairing) {
      return {
        ...base,
        statusLabel: '未上传',
        reason: '当前未启用团队上传。连接团队后会自动尝试上传。',
        tone: 'neutral',
        canRetry: false,
      }
    }
    if (!pairedHere) {
      return {
        ...base,
        statusLabel: '未上传',
        reason: '当前团队连接属于另一个本地项目。连接这个项目后需要手动重试。',
        tone: 'warning',
        canRetry: false,
      }
    }
    return { ...base, statusLabel: '未上传', reason: '上传没有完成，可以重试。', tone: 'warning', canRetry: true }
  }
  const target = operation.teamProjectId ?? '原团队项目'
  if (!pairing) {
    return {
      ...base,
      statusLabel: '未上传',
      reason: `需要重新连接到 ${target}，之后手动重试。`,
      tone: 'warning',
      canRetry: false,
    }
  }
  if (!pairedHere) {
    return {
      ...base,
      statusLabel: '未上传',
      reason: `目标是 ${target}，当前团队连接属于另一个本地项目。把这个项目重新连接到 ${target} 后需要手动重试。`,
      tone: 'warning',
      canRetry: false,
    }
  }
  if (!targetMatchesPairing(operation, pairing)) {
    return {
      ...base,
      statusLabel: '无法上传',
      reason: `这条记录属于 ${target}，无法上传到当前连接的团队项目。`,
      tone: 'warning',
      canRetry: false,
    }
  }
  // Retrying with a credential the service already rejected cannot succeed (plan §6.5).
  if (rejectedByCurrentCredential(operation, pairing)) {
    return { ...base, statusLabel: '上传失败', reason: '团队服务拒绝了当前凭据。重新连接后可以重试。', tone: 'warning', canRetry: false }
  }
  const reasons: Partial<Record<NonNullable<RemoteSyncOperation['lastErrorCode']>, string>> = {
    unauthorized: '上次上传时凭据被拒绝；现在已重新连接，可以重试。',
    forbidden: '当前身份没有上传这条记录的权限。',
    conflict: '团队服务拒绝了这条记录：与已有数据冲突。',
    immutable_conflict: '团队服务上已有内容不同的同一条记录。',
    scope_mismatch: '记录与当前团队连接的范围不一致。',
    network: '网络不可用，上传没有完成。',
    request_timeout: '团队服务响应超时，上传没有完成。',
    max_attempts: '已达到自动重试上限。',
    entity_missing: '本地记录已不存在。',
  }
  return {
    ...base,
    statusLabel: '上传失败',
    reason: (operation.lastErrorCode && reasons[operation.lastErrorCode]) ?? '上传没有完成。',
    tone: 'warning',
    canRetry: operation.lastErrorCode !== 'entity_missing',
  }
}

export function buildTeamConnectionView(input: TeamConnectionInput): TeamConnectionView {
  const pairing = input.pairingExpired ? null : input.pairing
  const pairedHere = Boolean(pairing && input.localProjectId && pairing.localProjectId === input.localProjectId)
  const records = input.operations
    .filter((operation) => operation.status !== 'completed')
    .map((operation) => describeUploadRecord(operation, input))
  const rejected = input.operations.some((operation) => rejectedByCurrentCredential(operation, pairing))
  const needsReconnect = input.pairingExpired || (pairedHere && rejected)
  const uploading = records.filter((record) => record.tone === 'progress').length
  const failing = records.filter((record) => record.tone === 'warning').length
  const projectName = input.teamProjectName || pairing?.projectName || pairing?.projectId || '团队项目'

  const connection: TeamConnectionView['connection'] = needsReconnect ? 'reconnect' : pairedHere ? 'connected' : 'local'
  const connectionLine = connection === 'reconnect'
    ? input.pairingExpired
      ? '团队连接已过期，需要重新连接。本地成果不受影响。'
      : '团队服务拒绝了当前凭据，需要重新连接。本地成果不受影响。'
    : connection === 'connected'
      ? `已连接到 ${projectName}`
      : pairing
        ? '本地项目，未连接团队。当前团队连接属于另一个本地项目。'
        : '本地项目，未连接团队'
  const dataLine = connection === 'local'
    ? '连接团队后可以更新团队数据。'
    : connection === 'reconnect'
      ? '重新连接后可以更新团队数据。'
      : input.teamDataError
      ? `读取失败：${input.teamDataError}`
      : input.teamDataReadAt
        ? `最近成功读取：${input.teamDataReadAt}`
        : '本次启动还没有读取团队数据。'
  const uploadLine = records.length === 0
    ? connection === 'local'
      ? '当前未启用团队上传。'
      : '没有待上传的记录。'
    : failing > 0
      ? `有 ${failing} 条记录未上传${uploading ? `，${uploading} 条正在上传` : ''}。`
      : uploading > 0
        ? `正在尝试上传 ${uploading} 项。`
        : '当前未启用团队上传。'

  // Errors the user must act on come first, then work in progress (plan §6.5).
  const summary = connection === 'reconnect'
    ? '需要重新连接'
    : failing > 0
      ? `${failing} 条未上传`
      : connection === 'local'
        ? '本地项目'
        : uploading > 0
          ? `正在上传 ${uploading} 项`
          : input.teamDataReadAt
            ? `已连接 · ${projectName}`
            : `已连接 · 团队数据未读取`
  const tone: TeamConnectionTone = connection === 'reconnect' || failing > 0
    ? 'warning'
    : uploading > 0
      ? 'progress'
      : connection === 'connected'
        ? input.teamDataReadAt ? 'ok' : 'neutral'
        : 'neutral'

  const formatTime = input.formatTime ?? ((iso: string) => iso)
  // Only the credential of this project has an expiry worth showing here (plan §6.5).
  const credential = input.pairing && input.localProjectId && input.pairing.localProjectId === input.localProjectId ? input.pairing : null
  const expiryLine = !credential
    ? ''
    : !credential.expiresAt
      ? '本机没有记录有效期；团队服务仍可能撤销凭据。'
      : input.pairingExpired
        ? `已于 ${formatTime(credential.expiresAt)} 过期。`
        : `有效期至 ${formatTime(credential.expiresAt)}；团队服务仍可能提前撤销。`
  const policySource = input.policy?.source === 'built_in_default' ? '内置默认策略' : '团队策略'
  const policyLine = !input.policy || input.policy.status === 'unavailable'
    ? connection === 'connected' ? '尚未读取团队策略。' : '连接团队后读取团队策略；未读取时，Gate 显示为状态待核实。'
    : input.policy.status === 'loading'
      ? '正在读取团队策略。'
      : input.policy.status === 'failed'
        ? `策略读取失败：${input.policy.error ?? '原因未知'}${input.policy.version ? `；仍在使用本机缓存的 v${input.policy.version}` : ''}。`
        : `${policySource} v${input.policy.version ?? '—'}${input.policy.syncedAt ? ` · 同步于 ${input.policy.syncedAt}` : ''}。`
  const detailsActionLabel: TeamConnectionView['detailsActionLabel'] = connection === 'reconnect'
    ? '重新连接'
    : connection === 'local'
      ? '连接团队'
      : failing > 0
        ? '查看上传详情'
        : '查看连接详情'

  return { connection, tone, summary, connectionLine, expiryLine, dataLine, policyLine, uploadLine, records, detailsActionLabel }
}

/** In-flight delivery intents that replacing the credential revokes, across all projects (plan P1). */
export const repairRevokedDeliveryStatuses: ReadonlySet<GitHubDeliveryIntent['status']> = new Set([
  'approval_required',
  'approved',
  'publishing_branch',
  'branch_published',
  'creating_pr',
  'recovery_required',
])

export function deliveryIntentsRevokedByRepair(intents: readonly GitHubDeliveryIntent[]): GitHubDeliveryIntent[] {
  return intents.filter((intent) => repairRevokedDeliveryStatuses.has(intent.status))
}
