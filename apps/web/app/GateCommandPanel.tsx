'use client'

import { useEffect, useRef, useState } from 'react'
import {
  parseGateCommandRecord,
  type GateCommand,
  type GateCommandAction,
  type GateCommandOutcomeCode,
} from '@ai-devflow/shared'
import type { GateCommandEvaluationSnapshot } from './lib/devflow-api'

type GateCommandPanelProps = {
  projectId: string
  runId: string
  nodeId: string
  expectedRunVersion: number
  evaluation: GateCommandEvaluationSnapshot | null
  initialCommands: GateCommand[]
  createIdempotencyKey?: (action: GateCommandAction) => string
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
  evidence_blocked: '完整本地证据仍阻止该操作。',
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
    return 'Gate Command 已提交，等待拥有该 Run 的 Desktop 复核并执行。'
  }
  return latest.outcomeCode
    ? outcomeLabels[latest.outcomeCode]
    : 'Gate Command 状态不可用，请刷新后重试。'
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
    if (!canSubmit || (action === 'approve' && evaluation.blocksApproval)) return

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
        throw new Error('Gate Command creation failed.')
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
          error instanceof Error
            ? error.message
            : 'Gate Command creation failed.',
      }))
    }
  }

  return (
    <div className="gate-command-panel">
      <label>
        <span>审批说明</span>
        <textarea
          aria-label="Gate Command reason"
          maxLength={2_000}
          value={reason}
          disabled={Boolean(active)}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="studio-gate-buttons">
        <button
          type="button"
          disabled={!canSubmit || Boolean(evaluation?.blocksApproval)}
          onClick={() => void submit('approve')}
        >
          批准并继续
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit('reject')}
        >
          驳回
        </button>
      </div>
      {evaluation?.blocksApproval && !active ? (
        <small>当前 Team enforcement preflight 阻止批准；可记录人工驳回。</small>
      ) : null}
      {visibleState.message ? (
        <small role="status">{visibleState.message}</small>
      ) : null}
    </div>
  )
}
