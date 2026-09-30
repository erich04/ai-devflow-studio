'use client'

import { useEffect, useRef, useState } from 'react'
import {
  parseGateCommandRecord,
  type GateCommand,
  type GateCommandAction,
  type GateCommandOutcomeCode,
} from '@ai-devflow/shared'
import type { GateCommandEvaluationSnapshot } from './lib/devflow-api'

/**
 * What the signed-in member may do here (plan S5, Q4). Approval needs the Gate's required role,
 * rejection needs Lead or Owner (the server rules); without either no buttons are shown.
 */
export type GateCommandAuthority = {
  canApprove: boolean
  canReject: boolean
  /** Shown instead of buttons when the member can do neither, e.g. “等待负责人审批”. */
  waitingLabel: string
}

type GateCommandPanelProps = {
  projectId: string
  runId: string
  nodeId: string
  expectedRunVersion: number
  evaluation: GateCommandEvaluationSnapshot | null
  initialCommands: GateCommand[]
  authority?: GateCommandAuthority
  /** Why approval is unavailable even with authority, e.g. the material version is not synced. */
  approvalUnavailableReason?: string
  createIdempotencyKey?: (action: GateCommandAction) => string
}

function creationFailureMessage(status: number): string {
  if (status === 401) return '需要浏览器身份才能提交审批，没有创建审批。'
  if (status === 403) return '当前身份没有这个审批的权限，没有创建审批。'
  if (status === 409) return '任务、策略、阻断项或所审材料已变化，没有创建审批。请刷新后重新核对。'
  if (status === 410) return '审批已过期，没有创建审批。请刷新后重新核对。'
  if (status === 400) return '审批请求不完整或已失效，没有创建审批。请刷新后重试。'
  return '审批服务暂时不可用，没有创建审批。'
}

type PanelState = {
  scopeKey: string
  commands: GateCommand[]
  status: 'idle' | 'creating' | 'ready' | 'error'
  message: string
}

export const GATE_COMMAND_STATUS_POLL_INTERVAL_MS = 5_000

const outcomeLabels: Record<GateCommandOutcomeCode, string> = {
  applied: 'Desktop 已执行批准，等待最新 Run 投影同步。',
  human_rejected: 'Desktop 已记录人工驳回，Run 保持在当前 Gate。',
  requester_revoked: '原请求人的项目权限已失效。',
  expired: 'Gate Command 已过期，请重新评估后提交。',
  scope_mismatch: 'Desktop 项目绑定与命令范围不一致。',
  run_not_found: 'Desktop 未找到绑定的本地 Run。',
  stale_run: '本地 Run 已变化，请刷新后重新评估。',
  stale_policy: '本地策略已变化，请刷新后重新评估。',
  blockers_changed: '本地阻断项已变化，请刷新后重新评估。',
  evidence_blocked: '桌面端复核后未执行：所审材料已变化或未同步，或本地证据仍阻止该操作。请刷新后重新核对。',
  authorization_denied: '本地授权检查拒绝了该操作。',
}

function defaultIdempotencyKey(action: GateCommandAction): string {
  return `gate-command:${action}:${globalThis.crypto.randomUUID()}`
}

function scopeKey(
  projectId: string,
  runId: string,
  nodeId: string,
  expectedRunVersion: number,
): string {
  return JSON.stringify([projectId, runId, nodeId, expectedRunVersion])
}

function activeCommand(
  commands: GateCommand[],
  nodeId: string,
  expectedRunVersion: number,
): GateCommand | undefined {
  return commands.find(
    (command) =>
      command.nodeId === nodeId &&
      command.expectedRunVersion === expectedRunVersion &&
      (command.status === 'pending' || command.status === 'delivering'),
  )
}

function latestCommand(
  commands: GateCommand[],
  nodeId: string,
  expectedRunVersion: number,
): GateCommand | undefined {
  return commands
    .filter(
      (command) =>
        command.nodeId === nodeId &&
        command.expectedRunVersion === expectedRunVersion,
    )
    .sort((left, right) =>
      right.updatedAt === left.updatedAt
        ? right.id.localeCompare(left.id)
        : right.updatedAt.localeCompare(left.updatedAt),
    )[0]
}

function lifecycleMessage(
  commands: GateCommand[],
  nodeId: string,
  expectedRunVersion: number,
): string {
  const latest = latestCommand(commands, nodeId, expectedRunVersion)
  if (!latest) return ''
  if (latest.status === 'pending' || latest.status === 'delivering') {
    return '审批已提交，等待拥有该任务的桌面端复核并执行。'
  }
  return latest.outcomeCode
    ? outcomeLabels[latest.outcomeCode]
    : '审批状态不可用，请刷新后重试。'
}

function parseListResponse(value: unknown, projectId: string): GateCommand[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).join(',') !== 'commands' ||
    !Array.isArray((value as { commands?: unknown }).commands)
  ) {
    throw new Error('Gate Command response was invalid.')
  }
  const seen = new Set<string>()
  try {
    return (value as { commands: unknown[] }).commands.map((candidate) => {
      const command = parseGateCommandRecord(candidate)
      if (command.projectId !== projectId || seen.has(command.id)) {
        throw new Error('scope mismatch')
      }
      seen.add(command.id)
      return command
    })
  } catch {
    throw new Error('Gate Command response was invalid.')
  }
}

function initialState(
  key: string,
  commands: GateCommand[],
  projectId: string,
  runId: string,
  nodeId: string,
  expectedRunVersion: number,
): PanelState {
  const scoped = commands.filter(
    (command) =>
      command.projectId === projectId &&
      command.runId === runId &&
      command.nodeId === nodeId,
  )
  return {
    scopeKey: key,
    commands: scoped,
    status: 'idle',
    message: lifecycleMessage(scoped, nodeId, expectedRunVersion),
  }
}

function parseCreateResponse(
  value: unknown,
  expected: {
    projectId: string
    runId: string
    nodeId: string
    action: GateCommandAction
    expectedRunVersion: number
    expectedPolicyVersion: number
    expectedBlockerIds: string[]
    idempotencyKey: string
  },
): GateCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Gate Command response was invalid.')
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join(',') !== 'command,outcomeCode,replayed' ||
    record.outcomeCode !== 'created' ||
    typeof record.replayed !== 'boolean'
  ) {
    throw new Error('Gate Command response was invalid.')
  }
  try {
    const command = parseGateCommandRecord(record.command)
    if (
      command.projectId !== expected.projectId ||
      command.runId !== expected.runId ||
      command.nodeId !== expected.nodeId ||
      command.action !== expected.action ||
      command.expectedRunVersion !== expected.expectedRunVersion ||
      command.expectedPolicyVersion !== expected.expectedPolicyVersion ||
      command.idempotencyKey !== expected.idempotencyKey ||
      command.workRequestId === null ||
      command.expectedBlockerIds.length !== expected.expectedBlockerIds.length ||
      command.expectedBlockerIds.some(
        (blockerId, index) => blockerId !== expected.expectedBlockerIds[index],
      ) ||
      (command.status !== 'pending' && command.status !== 'delivering')
    ) {
      throw new Error('scope mismatch')
    }
    return command
  } catch {
    throw new Error('Gate Command response was invalid.')
  }
}

export function GateCommandPanel({
  projectId,
  runId,
  nodeId,
  expectedRunVersion,
  evaluation,
  initialCommands,
  authority = { canApprove: true, canReject: true, waitingLabel: '' },
  approvalUnavailableReason,
  createIdempotencyKey = defaultIdempotencyKey,
}: GateCommandPanelProps) {
  const key = scopeKey(projectId, runId, nodeId, expectedRunVersion)
  const [state, setState] = useState(() =>
    initialState(
      key,
      initialCommands,
      projectId,
      runId,
      nodeId,
      expectedRunVersion,
    ),
  )
  const [reason, setReason] = useState('')
  const [idempotencyKeys, setIdempotencyKeys] = useState(() => ({
    approve: createIdempotencyKey('approve'),
    reject: createIdempotencyKey('reject'),
  }))
  const requestVersion = useRef(0)
  const currentScopeKey = useRef(key)
  const idFactory = useRef(createIdempotencyKey)
  currentScopeKey.current = key
  idFactory.current = createIdempotencyKey

  useEffect(() => {
    requestVersion.current += 1
    setState(
      initialState(
        key,
        initialCommands,
        projectId,
        runId,
        nodeId,
        expectedRunVersion,
      ),
    )
    setReason('')
    setIdempotencyKeys({
      approve: idFactory.current('approve'),
      reject: idFactory.current('reject'),
    })
  }, [key, initialCommands, projectId, runId, nodeId, expectedRunVersion])

  const visibleState =
    state.scopeKey === key
      ? state
      : initialState(
          key,
          initialCommands,
          projectId,
          runId,
          nodeId,
          expectedRunVersion,
        )
  const active = activeCommand(
    visibleState.commands,
    nodeId,
    expectedRunVersion,
  )

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const response = await fetch(
          `/api/gate-commands?projectId=${encodeURIComponent(projectId)}`,
          { headers: { accept: 'application/json' } },
        )
        if (response.status !== 200) return
        const commands = parseListResponse(await response.json(), projectId)
        if (cancelled || currentScopeKey.current !== key) return
        const scoped = commands.filter(
          (command) => command.runId === runId && command.nodeId === nodeId,
        )
        setState({
          scopeKey: key,
          commands: scoped,
          status: 'ready',
          message: lifecycleMessage(scoped, nodeId, expectedRunVersion),
        })
      } catch {
        // Preserve the last verified lifecycle while a bounded refresh is unavailable.
      } finally {
        refreshing = false
      }
    }
    const timer = globalThis.setInterval(
      () => void refresh(),
      GATE_COMMAND_STATUS_POLL_INTERVAL_MS,
    )
    return () => {
      cancelled = true
      globalThis.clearInterval(timer)
    }
  }, [
    Boolean(active),
    expectedRunVersion,
    key,
    nodeId,
    projectId,
    runId,
  ])
  const canSubmit =
    evaluation !== null &&
    reason.trim().length > 0 &&
    visibleState.status !== 'creating' &&
    !active

  async function submit(action: GateCommandAction) {
    if (!canSubmit) return
    if (action === 'approve' && (evaluation.blocksApproval || !authority.canApprove || approvalUnavailableReason)) return
    if (action === 'reject' && !authority.canReject) return

    const requestScopeKey = key
    const currentRequestVersion = requestVersion.current + 1
    requestVersion.current = currentRequestVersion
    const idempotencyKey = idempotencyKeys[action]
    const input = {
      projectId,
      runId,
      nodeId,
      action,
      reason,
      expectedRunVersion,
      expectedPolicyVersion: evaluation.policyVersion,
      expectedBlockerIds: [...evaluation.expectedBlockerIds],
      idempotencyKey,
    }
    setState((current) => ({
      ...current,
      scopeKey: requestScopeKey,
      status: 'creating',
      message: '',
    }))

    try {
      const response = await fetch('/api/gate-commands', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      })
      if (response.status !== 201) {
        throw new Error(creationFailureMessage(response.status))
      }
      const command = parseCreateResponse(
        await response.json().catch(() => {
          throw new Error('Gate Command response was invalid.')
        }),
        input,
      )
      if (
        currentScopeKey.current !== requestScopeKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState((current) => ({
        scopeKey: requestScopeKey,
        commands: [
          command,
          ...current.commands.filter((item) => item.id !== command.id),
        ],
        status: 'ready',
        message: lifecycleMessage(
          [
            command,
            ...current.commands.filter((item) => item.id !== command.id),
          ],
          nodeId,
          expectedRunVersion,
        ),
      }))
      setReason('')
      setIdempotencyKeys((current) => ({
        ...current,
        [action]: idFactory.current(action),
      }))
    } catch (error) {
      if (
        currentScopeKey.current !== requestScopeKey ||
        requestVersion.current !== currentRequestVersion
      ) {
        return
      }
      setState((current) => ({
        ...current,
        status: 'error',
        message:
          error instanceof Error && !error.message.startsWith('Gate Command')
            ? error.message
            : '审批服务返回了无法核对的结果，请刷新后确认是否已提交。',
      }))
    }
  }

  // No dead buttons: a member who can neither approve nor reject sees who has to act (plan S5, Q4).
  if (!authority.canApprove && !authority.canReject) {
    return (
      <div className="gate-command-panel">
        <p className="gate-command-waiting" role="note">{authority.waitingLabel}</p>
        {visibleState.message ? <small role="status">{visibleState.message}</small> : null}
      </div>
    )
  }

  const approveDisabled = !canSubmit || !authority.canApprove || Boolean(evaluation?.blocksApproval) || Boolean(approvalUnavailableReason)
  return (
    <div className="gate-command-panel">
      <label>
        <span>审批说明</span>
        <textarea
          aria-label="审批说明"
          maxLength={2_000}
          value={reason}
          disabled={Boolean(active)}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="studio-gate-buttons">
        {authority.canApprove ? (
          <button
            type="button"
            disabled={approveDisabled}
            onClick={() => void submit('approve')}
          >
            批准并继续
          </button>
        ) : null}
        {authority.canReject ? (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit('reject')}
          >
            驳回
          </button>
        ) : null}
      </div>
      {evaluation === null ? (
        <small role="note">无法读取审批前检查，暂时不能提交。请刷新页面重试。</small>
      ) : !active && reason.trim().length === 0 ? (
        <small>填写审批说明后才能提交。</small>
      ) : null}
      {authority.canApprove && approvalUnavailableReason && !active ? (
        <small role="note">暂时不能批准：{approvalUnavailableReason}{authority.canReject ? '。仍可驳回。' : '。'}</small>
      ) : null}
      {!authority.canApprove ? (
        <small role="note">批准需要更高的项目角色；你可以驳回。</small>
      ) : null}
      {evaluation?.blocksApproval && !active ? (
        <small>{evaluation.expectedBlockerIds.includes('gate-review-subject-not-current')
          ? '团队数据中缺少当前审查对应的材料指纹，或指纹与审查结果不一致。请在已连接的桌面端同步；内容有变化时重新审查，再刷新此页面。'
          : '团队策略的审批前检查阻止批准；可以记录人工驳回。'}</small>
      ) : null}
      {visibleState.message ? (
        <small role="status">{visibleState.message}</small>
      ) : null}
    </div>
  )
}
