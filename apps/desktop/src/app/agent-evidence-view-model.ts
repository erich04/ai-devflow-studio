import {
  formatUsd,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingRuntimeCostSummary,
  type CodingDiffArtifact,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type RetryAttempt,
  type TestEvidence,
} from '@ai-devflow/shared'
import {
  buildAgentProviderDataSource,
  codingTraceMetadataString,
  codingTraceSourceLabel,
  type FieldDataSource,
} from './desktop-view-model'

export type AgentEvidenceTone = 'good' | 'warn' | 'bad' | 'soft' | 'accent' | 'neutral'

export type AgentEvidenceItem = {
  id: string
  eyebrow: string
  title: string
  body: string
  meta: string[]
}

export type AgentEvidenceGroup = {
  id: string
  title: string
  summary: string
  tone: AgentEvidenceTone
  items: AgentEvidenceItem[]
}

export type AgentEvidenceInput = {
  providers: AgentProviderConfig[]
  selectedReviews: AgentReviewResult[]
  latestTrace: AgentTrace | undefined
  latestUsage: AgentTokenUsage | undefined
  retryAttempts: RetryAttempt[]
  latestCodingRun: CodingAgentRun | undefined
  codingEvents: CodingAgentEvent[]
  pendingCodingPermission: CodingPermissionRequest | undefined
  permissionRequests: CodingPermissionRequest[]
  diff: CodingDiffArtifact | undefined
  bootstrapEvidence: DependencyBootstrapEvidence | undefined
  testEvidence: TestEvidence | undefined
}

/** The model used for Gate Review and as the default elsewhere (settings, plan Y2). */
export type ProviderSettingsView = {
  summary: string
  providerDataSource: FieldDataSource
  selectedProvider: AgentProviderConfig | undefined
  providerMode: string
}

export function buildProviderSettingsView(input: {
  providers: AgentProviderConfig[]
  selectedProviderId: string
}): ProviderSettingsView {
  // An explicitly empty selection stays empty even when other providers remain.
  const selectedProvider = input.providers.find((provider) => provider.id === input.selectedProviderId)
  return {
    summary: selectedProvider ? `当前 Agent Provider：${selectedProvider.name}` : '尚未选择 Agent Provider',
    providerDataSource: buildAgentProviderDataSource(selectedProvider),
    selectedProvider,
    providerMode: buildProviderModeLabel(selectedProvider),
  }
}

/**
 * Execution evidence for 执行记录 (plan Y3): review traces and history, model-call and tool
 * timelines, coding traces, dependency setup, retries and costs. Callers drop the groups that
 * another part of the task already shows, so each piece of content appears once (plan W1).
 */
export function buildAgentEvidenceGroups(input: AgentEvidenceInput): AgentEvidenceGroup[] {
  const groups: AgentEvidenceGroup[] = []

  if (input.latestTrace?.steps.length) {
    groups.push({
      id: 'review-trace',
      title: '门禁审查 Trace',
      summary: '记录 Knowledge 检索、Gate 与阶段产物上下文、Provider 调用和审查产物创建。',
      tone: 'accent',
      items: input.latestTrace.steps.map((step) => ({
        id: step.id,
        eyebrow: step.kind,
        title: step.label,
        body: step.summary,
        meta: [step.timestamp],
      })),
    })
  }

  if (input.selectedReviews.length > 0) {
    groups.push({
      id: 'review-history',
      title: '门禁审查记录',
      summary: '当前 Run / Node 的基于知识的门禁审查记录。',
      tone: 'soft',
      items: input.selectedReviews.map((review) => ({
        id: review.id,
        eyebrow: review.runtime,
        title: review.conclusion,
        body: review.summary,
        meta: [
          input.providers.find((provider) => provider.id === review.providerId)?.name ?? '旧版 Provider',
          review.model,
          review.gateAdvisory.level,
          `${Math.round(review.confidence * 100)}%`,
        ],
      })),
    })
  }

  if (input.permissionRequests.length > 0) {
    groups.push({
      id: 'permission',
      title: '权限时间线',
      summary: '最近一次 Coding Agent Run 的权限转发请求与决定。',
      tone: input.pendingCodingPermission ? 'warn' : 'soft',
      items: input.permissionRequests.map((request) => ({
        id: request.id,
        eyebrow: request.status,
        title: request.title,
        body: request.reasons.join(' ') || [request.permission, request.command, request.filePath].filter(Boolean).join(' · '),
        meta: [request.permission, request.risk, request.command, request.filePath].filter(isPresent),
      })),
    })
  }

  const providerCallEvents = input.codingEvents.flatMap((event) => {
    const trace = recordValue(event.metadata?.providerCall)
    return trace ? [{ event, trace }] : []
  })
  if (providerCallEvents.length > 0) {
    groups.push({
      id: 'provider-call',
      title: 'Provider 调用时间线',
      summary: '按模型阶段展示持久化的请求耗时、交付状态、计费状态与安全错误分类。',
      tone: providerCallEvents.some(({ trace }) => trace.status === 'failed') ? 'warn' : 'accent',
      items: providerCallEvents.map(({ event, trace }) => providerCallEvidenceItem(event, trace)),
    })
  }

  const toolTraceEvents = input.codingEvents.filter(
    (event) =>
      (event.kind === 'tool_call' || event.kind === 'tool_result') &&
      !recordValue(event.metadata?.providerCall),
  )
  if (toolTraceEvents.length > 0) {
    groups.push({
      id: 'tool-skill',
      title: '工具 / Skill 时间线',
      summary: 'Coding Agent Runtime（运行时）公开的工具调用与结果。',
      tone: 'accent',
      items: toolTraceEvents.map((event) => {
        const toolName = codingTraceMetadataString(event.metadata, 'toolName') ?? event.kind
        const skillName = codingTraceMetadataString(event.metadata, 'skillName') ?? 'Unknown skill'
        const source = codingTraceSourceLabel(codingTraceMetadataString(event.metadata, 'source'))
        const body =
          codingTraceMetadataString(event.metadata, 'outputSummary') ??
          codingTraceMetadataString(event.metadata, 'inputSummary') ??
          event.message
        const commandSummary = codingTraceMetadataString(event.metadata, 'commandSummary')
        const filePath = codingTraceMetadataString(event.metadata, 'filePath')
        const redactionApplied = event.metadata?.redactionApplied === true

        return {
          id: event.id,
          eyebrow: source,
          title: toolName,
          body,
          meta: [skillName, commandSummary, filePath, redactionApplied ? 'Redacted' : undefined].filter(isPresent),
        }
      }),
    })
  }

  if (input.codingEvents.length > 0) {
    groups.push({
      id: 'coding-trace',
      title: 'Coding 执行轨迹',
      summary: '需求简报、权限、差异、依赖准备、测试、清理与终态事件。',
      tone: 'soft',
      items: input.codingEvents.map((event) => {
        const runtimeCost = recordValue(event.metadata?.runtimeCost)
        const runtimeCostDetails = runtimeCost ? runtimeCostTraceDetails(runtimeCost) : null
        return {
          id: event.id,
          eyebrow: event.kind,
          title: event.message,
          body: runtimeCostDetails?.body ?? event.timestamp,
          meta: [
            event.timestamp,
            ...(runtimeCostDetails?.meta ?? []),
            event.redacted ? 'redacted' : undefined,
          ].filter(isPresent),
        }
      }),
    })
  }

  if (input.diff) {
    groups.push({
      id: 'diff',
      title: '修改差异预览',
      summary: `${input.diff.changedPaths.length} 个变更路径已归档为 Coding Diff Artifact（差异产物）。`,
      tone: 'accent',
      items: [{
        id: input.diff.id,
        eyebrow: typeof input.diff.secretReplacementCount === 'number'
          ? input.diff.secretReplacementCount > 0
            ? `${input.diff.secretReplacementCount} secret replacement${input.diff.secretReplacementCount === 1 ? '' : 's'}`
            : `sanitized v${input.diff.sanitizerVersion ?? 'unknown'}`
          : input.diff.redacted
            ? 'legacy redacted diff'
            : 'unsanitized diff',
        title: input.diff.changedPaths.join(', ') || 'Coding Diff Artifact',
        body: input.diff.patch.slice(0, 1800),
        meta: [input.diff.truncated ? 'truncated' : 'full patch'],
      }],
    })
  }

  if (input.bootstrapEvidence) {
    groups.push({
      id: 'bootstrap',
      title: '依赖准备证据',
      summary: input.bootstrapEvidence.summary,
      tone: evidenceTone(input.bootstrapEvidence.status),
      items: [{
        id: input.bootstrapEvidence.id,
        eyebrow: input.bootstrapEvidence.status,
        title: input.bootstrapEvidence.command,
        body: input.bootstrapEvidence.summary,
        meta: [
          `exit ${input.bootstrapEvidence.exitCode ?? 'none'}`,
          `${input.bootstrapEvidence.durationMs}ms`,
          input.bootstrapEvidence.redacted ? 'redacted' : undefined,
        ].filter(isPresent),
      }],
    })
  }

  if (input.testEvidence) {
    groups.push({
      id: 'test-evidence',
      title: '测试证据',
      summary: input.testEvidence.summary,
      tone: evidenceTone(input.testEvidence.status),
      items: [{
        id: input.testEvidence.id,
        eyebrow: input.testEvidence.status,
        title: input.testEvidence.command,
        body: input.testEvidence.summary,
        meta: [
          `exit ${input.testEvidence.exitCode ?? 'none'}`,
          `${input.testEvidence.durationMs}ms`,
          input.testEvidence.redacted ? 'redacted' : undefined,
        ].filter(isPresent),
      }],
    })
  }

  if (input.retryAttempts.length > 0) {
    groups.push({
      id: 'retry',
      title: 'Policy 重试记录',
      summary: '由人工批准、从 Gate Policy 修复候选启动的重试。',
      tone: 'warn',
      items: input.retryAttempts.map((attempt) => ({
        id: attempt.id,
        eyebrow: attempt.status,
        title: attempt.userInstruction,
        body: attempt.candidateIds.join(', ') || attempt.remediationPlanId,
        meta: [attempt.codingRunId, attempt.completedAt ?? attempt.createdAt].filter(isPresent),
      })),
    })
  }

  const runtimeCost = input.latestCodingRun?.runtimeCostSummary
  if (runtimeCost || input.latestUsage) {
    const runtimeCostUnknown = runtimeCost ? isLegacyRuntimeCost(runtimeCost) : false
    const runtimeItems = runtimeCost ? runtimeCostEvidenceItems(runtimeCost) : []
    const legacyUsageItems: AgentEvidenceItem[] = input.latestUsage
      ? [{
          id: input.latestUsage.id,
          eyebrow: input.latestUsage.source,
          title: `${input.latestUsage.providerId ?? input.latestUsage.provider} · ${input.latestUsage.model}`,
          body: input.latestUsage.usageStatus === 'unknown' ? '执行器未报告用量，金额待确认' : `${input.latestUsage.inputTokens} input · ${input.latestUsage.outputTokens} output · ${input.latestUsage.cacheReadTokens} cache read${input.latestUsage.usageStatus === 'partial' ? ' · 部分回合用量缺失' : ''}`,
          meta: [input.latestUsage.timestamp, ...(input.latestUsage.pricingSnapshot ? [`预计费用 · 峰值费率 · ${input.latestUsage.pricingSnapshot.sourceVersion}`] : [])],
        }]
      : []
    groups.push({
      id: 'cost',
      title: '费用 / Token',
      summary: runtimeCost
        ? `${runtimeCost.phase === 'preflight_estimate' ? 'Preflight worst-case estimate' : runtimeCostUnknown ? 'Legacy unverified cost' : 'Actual provider settlement'} · ${runtimeCost.costStatus ?? 'legacy_unverified'} · ${runtimeCostUnknown || runtimeCost.costUsd === null ? 'unknown cost' : formatRuntimeUsd(runtimeCost.costUsd)}`
        : `${input.latestUsage!.costUsd !== null ? '预计 ' : ''}${formatUsd(input.latestUsage!.costUsd)} · ${input.latestUsage!.source}`,
      tone: 'soft',
      items: [...runtimeItems, ...legacyUsageItems],
    })
  }

  return groups
}

function runtimeCostEvidenceItems(summary: CodingRuntimeCostSummary): AgentEvidenceItem[] {
  const phase = summary.phase === 'preflight_estimate'
    ? 'Preflight estimate'
    : summary.phase === 'provider_settlement'
      ? 'Actual settlement'
      : 'Legacy cost'
  const aggregate: AgentEvidenceItem = {
    id: summary.id,
    eyebrow: `${phase} · ${summary.costStatus ?? 'legacy_unverified'}`,
    title: `${summary.providerId} · ${summary.model}`,
    body: runtimeUsageText(summary),
    meta: runtimeCostMeta(summary),
  }
  const calls = (summary.providerCallSettlements ?? []).map((settlement, index) => ({
    id: `${summary.id}-provider-call-${index + 1}`,
    eyebrow: `${settlement.requestPhase} · ${settlement.costStatus}`,
    title: `${settlement.providerId} · ${settlement.model}`,
    body: runtimeUsageText(settlement),
    meta: runtimeCostMeta(settlement),
  }))
  return [aggregate, ...calls]
}

function runtimeUsageText(input: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheMissTokens?: number | null
  totalTokens?: number
}): string {
  return [
    `${input.inputTokens} input`,
    `${input.cacheReadTokens ?? 'unknown'} cache hit`,
    `${input.cacheMissTokens ?? 'unknown'} cache miss`,
    `${input.outputTokens} output`,
    `${input.totalTokens ?? input.inputTokens + input.outputTokens} total`,
  ].join(' · ')
}

function runtimeCostMeta(input: {
  cacheHitRate?: number | null
  usageStatus?: CodingRuntimeCostSummary['usageStatus']
  costStatus?: CodingRuntimeCostSummary['costStatus']
  costUsd: number | null
  pricingSnapshot?: CodingRuntimeCostSummary['pricingSnapshot']
  breakdown?: CodingRuntimeCostSummary['breakdown']
  timestamp: string
}): string[] {
  const legacy = !input.usageStatus || input.usageStatus === 'legacy_unknown' ||
    !input.costStatus || input.costStatus === 'legacy_unverified'
  const snapshot = legacy ? null : input.pricingSnapshot
  const breakdown = legacy ? null : input.breakdown
  return [
    typeof input.cacheHitRate === 'number'
      ? `cache hit rate ${(input.cacheHitRate * 100).toFixed(1)}%`
      : 'cache hit rate unknown',
    snapshot
      ? `hit ${formatRuntimeUsd(snapshot.cacheHitInputUsdPerMillion)} / 1M · miss ${formatRuntimeUsd(snapshot.cacheMissInputUsdPerMillion)} / 1M · output ${formatRuntimeUsd(snapshot.outputUsdPerMillion)} / 1M`
      : 'unit prices unknown',
    breakdown
      ? `hit ${formatRuntimeUsd(breakdown.cacheHitInputUsd)} · miss ${formatRuntimeUsd(breakdown.cacheMissInputUsd)} · output ${formatRuntimeUsd(breakdown.outputUsd)} · total ${formatRuntimeUsd(breakdown.totalUsd)}`
      : 'cost breakdown unknown',
    snapshot ? `${snapshot.tier} · ${snapshot.sourceVersion}` : undefined,
    legacy || input.costUsd === null ? 'total cost unknown' : `total ${formatRuntimeUsd(input.costUsd)}`,
    input.timestamp,
  ].filter(isPresent)
}

function isLegacyRuntimeCost(summary: CodingRuntimeCostSummary): boolean {
  return !summary.usageStatus || summary.usageStatus === 'legacy_unknown' ||
    !summary.costStatus || summary.costStatus === 'legacy_unverified'
}

function runtimeCostTraceDetails(cost: Record<string, unknown>): { body: string; meta: string[] } {
  const inputTokens = finiteNumber(cost.inputTokens)
  const outputTokens = finiteNumber(cost.outputTokens)
  const cacheReadTokens = finiteNumber(cost.cacheReadTokens)
  const cacheMissTokens = finiteNumber(cost.cacheMissTokens)
  const totalTokens = finiteNumber(cost.totalTokens)
  const hitRate = finiteNumber(cost.cacheHitRate)
  const costUsd = finiteNumber(cost.costUsd)
  const unitPrices = recordValue(cost.unitPrices)
  const breakdown = recordValue(cost.breakdown)
  const providerCallMeta = Array.isArray(cost.providerCallSettlements)
    ? cost.providerCallSettlements.slice(0, 32).flatMap(runtimeProviderCallTraceMeta)
    : []
  return {
    body: [
      `${inputTokens ?? 'unknown'} input`,
      `${cacheReadTokens ?? 'unknown'} hit`,
      `${cacheMissTokens ?? 'unknown'} miss`,
      `${outputTokens ?? 'unknown'} output`,
      `${totalTokens ?? 'unknown'} total`,
    ].join(' · '),
    meta: [
      hitRate === undefined ? 'cache hit rate unknown' : `cache hit rate ${(hitRate * 100).toFixed(1)}%`,
      unitPrices
        ? `hit ${formatRuntimeUsd(finiteNumber(unitPrices.cacheHitInputUsdPerMillion))} / 1M · miss ${formatRuntimeUsd(finiteNumber(unitPrices.cacheMissInputUsdPerMillion))} / 1M · output ${formatRuntimeUsd(finiteNumber(unitPrices.outputUsdPerMillion))} / 1M`
        : undefined,
      breakdown
        ? `hit ${formatRuntimeUsd(finiteNumber(breakdown.cacheHitInputUsd))} · miss ${formatRuntimeUsd(finiteNumber(breakdown.cacheMissInputUsd))} · output ${formatRuntimeUsd(finiteNumber(breakdown.outputUsd))} · total ${formatRuntimeUsd(finiteNumber(breakdown.totalUsd))}`
        : undefined,
      typeof cost.pricingTier === 'string' ? cost.pricingTier : undefined,
      costUsd === undefined ? 'total cost unknown' : `total ${formatRuntimeUsd(costUsd)}`,
      ...providerCallMeta,
    ].filter(isPresent),
  }
}

function runtimeProviderCallTraceMeta(value: unknown): string[] {
  const call = recordValue(value)
  if (!call) return []
  const phase = typeof call.requestPhase === 'string' ? call.requestPhase : 'provider call'
  const inputTokens = finiteNumber(call.inputTokens)
  const outputTokens = finiteNumber(call.outputTokens)
  const cacheReadTokens = finiteNumber(call.cacheReadTokens)
  const cacheMissTokens = finiteNumber(call.cacheMissTokens)
  const totalTokens = finiteNumber(call.totalTokens)
  const hitRate = finiteNumber(call.cacheHitRate)
  const snapshot = recordValue(call.pricingSnapshot)
  const breakdown = recordValue(call.breakdown)
  return [
    `${phase} · ${inputTokens ?? 'unknown'} input · ${cacheReadTokens ?? 'unknown'} hit · ${cacheMissTokens ?? 'unknown'} miss · ${outputTokens ?? 'unknown'} output · ${totalTokens ?? 'unknown'} total · hit rate ${hitRate === undefined ? 'unknown' : `${(hitRate * 100).toFixed(1)}%`}`,
    snapshot
      ? `${phase} rates · hit ${formatRuntimeUsd(finiteNumber(snapshot.cacheHitInputUsdPerMillion))} / 1M · miss ${formatRuntimeUsd(finiteNumber(snapshot.cacheMissInputUsdPerMillion))} / 1M · output ${formatRuntimeUsd(finiteNumber(snapshot.outputUsdPerMillion))} / 1M`
      : undefined,
    breakdown
      ? `${phase} cost · hit ${formatRuntimeUsd(finiteNumber(breakdown.cacheHitInputUsd))} · miss ${formatRuntimeUsd(finiteNumber(breakdown.cacheMissInputUsd))} · output ${formatRuntimeUsd(finiteNumber(breakdown.outputUsd))} · total ${formatRuntimeUsd(finiteNumber(breakdown.totalUsd))}`
      : undefined,
  ].filter(isPresent)
}

function providerCallEvidenceItem(
  event: CodingAgentEvent,
  call: Record<string, unknown>,
): AgentEvidenceItem {
  const phase = typeof call.phase === 'string' ? call.phase : 'unknown phase'
  const status = typeof call.status === 'string' ? call.status : event.kind
  const providerId = typeof call.providerId === 'string' ? call.providerId : 'unknown provider'
  const model = typeof call.model === 'string' ? call.model : 'unknown model'
  const durationMs = finiteNumber(call.durationMs)
  const timeoutMs = finiteNumber(call.timeoutMs)
  const manifestPathCount = finiteNumber(call.manifestPathCount)
  const excerptCount = finiteNumber(call.excerptCount)
  const promptChars = finiteNumber(call.promptChars)
  const promptBytes = finiteNumber(call.promptBytes)
  const maxOutputTokens = finiteNumber(call.maxOutputTokens)
  const errorCode = typeof call.errorCode === 'string' ? call.errorCode : undefined
  const sanitizedCause = typeof call.sanitizedCause === 'string' ? call.sanitizedCause : undefined
  const deliveryState = typeof call.deliveryState === 'string' ? call.deliveryState : 'unknown'
  const billingState = typeof call.billingState === 'string' ? call.billingState : 'unknown'
  const retryable = call.retryable === true
  const targetHost = typeof call.targetHost === 'string' ? call.targetHost : undefined
  const httpStatus = finiteNumber(call.httpStatus)
  const providerResponseId = typeof call.providerResponseId === 'string'
    ? call.providerResponseId
    : undefined
  const systemFingerprint = typeof call.systemFingerprint === 'string'
    ? call.systemFingerprint
    : undefined
  const usage = recordValue(call.usage)
  const inputTokens = finiteNumber(usage?.inputTokens)
  const outputTokens = finiteNumber(usage?.outputTokens)
  const cacheReadTokens = finiteNumber(usage?.cacheReadTokens)
  const cacheMissTokens = finiteNumber(usage?.cacheMissTokens)
  const totalTokens = finiteNumber(usage?.totalTokens)

  return {
    id: event.id,
    eyebrow: `${phase} · ${status}`,
    title: `${providerId} · ${model}`,
    body: event.message,
    meta: [
      durationMs === undefined
        ? `duration pending · timeout ${timeoutMs ?? 'unknown'}ms`
        : `duration ${durationMs}ms · timeout ${timeoutMs ?? 'unknown'}ms`,
      errorCode
        ? `${errorCode}${sanitizedCause ? ` · ${sanitizedCause}` : ''}`
        : undefined,
      `delivery ${deliveryState} · billing ${billingState}`,
      status === 'failed'
        ? retryable
          ? 'manual retry available'
          : 'manual retry not recommended'
        : undefined,
      manifestPathCount !== undefined && excerptCount !== undefined
        ? `${manifestPathCount} manifest paths · ${excerptCount} excerpts`
        : undefined,
      promptChars !== undefined && promptBytes !== undefined
        ? `${promptChars} chars · ${promptBytes} bytes · max output ${maxOutputTokens ?? 'unknown'}`
        : undefined,
      inputTokens !== undefined || outputTokens !== undefined
        ? `${inputTokens ?? 'unknown'} input · ${cacheReadTokens ?? 'unknown'} cache hit · ${cacheMissTokens ?? 'unknown'} cache miss · ${outputTokens ?? 'unknown'} output · ${totalTokens ?? 'unknown'} total`
        : undefined,
      targetHost,
      httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
      providerResponseId ? `response ${providerResponseId}` : undefined,
      systemFingerprint ? `fingerprint ${systemFingerprint}` : undefined,
      event.timestamp,
      event.redacted ? 'redacted' : undefined,
    ].filter(isPresent),
  }
}

function formatRuntimeUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown'
  const exact = value.toFixed(9).replace(/\.?0+$/u, '')
  return `$${exact}`
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function evidenceTone(status: string): AgentEvidenceTone {
  if (status === 'passed' || status === 'skipped') {
    return 'good'
  }
  if (status === 'failed' || status === 'timed_out') {
    return 'bad'
  }
  return 'warn'
}

function buildProviderModeLabel(provider: AgentProviderConfig | undefined): string {
  if (!provider) {
    return '请先添加 Provider Name、Base URL、模型和 API Key'
  }
  if (provider.kind === 'fake') {
    return '确定性开发适配器 · 不产生模型费用'
  }
  return '实时 OpenAI 兼容服务 · 可能消耗模型 Token'
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
