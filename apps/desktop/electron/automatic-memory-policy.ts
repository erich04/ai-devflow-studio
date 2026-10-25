import type { AutomaticMemoryDecision, AutomaticMemoryEvent, AutomaticMemoryFact, AutomaticMemoryMaterial, AutomaticMemoryStatementKind } from '@ai-devflow/shared'
import { AUTOMATIC_MEMORY_POLICY_VERSION, redactSensitiveText } from '@ai-devflow/shared'
import { createHash } from 'node:crypto'
const automaticMemoryDigest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`
export type AutomaticMemoryExistingMemory = { memoryId: string; revision: number; statement: string; semanticKey?: string; semanticValue?: string }

const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
type Supported = { kind: AutomaticMemoryStatementKind; key: string; value: string; statement: string }
export type MemoryCommunicationPreference =
  | { kind: 'language'; value: 'chinese' | 'english' }
  | { kind: 'detail'; value: 'concise' | 'detailed' }
  | { kind: 'change_order'; value: 'behavior_then_tests' }
const rulePattern = /(?:验收|业务规则|权限|管理员|用户角色|退款|订单|支付|发布审批|必须.{0,20}(?:删除|撤销|收费|登录)|删除.{0,20}(?:撤销|恢复)|acceptance criteria|business rule|administrator|authorization|refund|payment|permissions)/iu
export const isMemoryBusinessRule = (text: string): boolean => rulePattern.test(text)
/** Deliberately narrow host policy: source role + complete supported form + remote grounding.
 * Keywords can veto automatic saving, but can never establish evidence or grant authority.
 */
function supportedStatement(text: string): Supported | null {
  if (Buffer.byteLength(text) > 1_800 || rulePattern.test(text)) return null
  const sentence = text.trim().replace(/[。.!！]+$/u, '')
  const language = sentence.match(/^(?:(?:我希望|我偏好|以后|今后|默认|请|都|回答时|解释时|解释改动时)[，, ]*)*(?:请)?(?:用|使用)(中文|英文|英语)(?:回答|解释|回复|解释改动|说明改动)?$/u)
    ?? sentence.match(/^(?:i prefer|please (?:answer|respond|explain)(?: in)?|use) (chinese|english)(?: (?:for (?:answers|explanations)|by default))?$/iu)
    ?? sentence.match(/^(?:the user|user|they) (?:prefers?|requests?) (?:responses?|answers?|explanations?) in (chinese|english)$/iu)
  if (language) return { kind: 'communication_preference', key: 'communication.language',
    value: /^(中文|chinese)$/iu.test(language[1]!) ? 'chinese' : 'english', statement: text.trim() }
  if (/^(?:以后|请|默认)?(?:回答|回复|解释改动)(?:时)?(?:请)?(?:保持)?(?:简洁|简短|详细)(?:一些|一点)?$/u.test(sentence) ||
      /^(?:i prefer|the user prefers?) (?:concise|detailed) (?:answers|responses|explanations)$/iu.test(sentence)) {
    return { kind: 'communication_preference', key: 'communication.detail', value: /详细|detailed/iu.test(sentence) ? 'detailed' : 'concise', statement: text.trim() }
  }
  if (/^(?:以后|请|默认)?(?:解释|说明)(?:代码)?改动(?:时)?[，, ]*(?:请)?先(?:说|讲|介绍)(?:行为变化|变化|改了什么|结果)[，, ]*再(?:说|讲|介绍)(?:测试|验证)$/u.test(sentence)) {
    return { kind: 'communication_preference', key: 'communication.change_order', value: 'behavior_then_tests', statement: text.trim() }
  }
  const version = sentence.match(/^(?:(?:本项目|这个项目|项目|开发环境)(?:的)?[：: ]*)?(node(?:\.js)?|pnpm|npm|python|postgres(?:ql)?|java|rust)(?:\s*(?:版本)?(?:是|为|使用|:|=|version)?\s*)v?(\d+(?:\.\d+){0,3})$/iu)
    ?? sentence.match(/^(?:本项目|这个项目|项目|开发环境)(?:使用|采用)\s*(node(?:\.js)?|pnpm|npm|python|postgres(?:ql)?|java|rust)\s*v?(\d+(?:\.\d+){0,3})$/iu)
    ?? sentence.match(/^(?:(?:the|this) )?project (?:uses|runs|requires) (node(?:\.js)?|pnpm|npm|python|postgres(?:ql)?|java|rust) (?:version )?v?(\d+(?:\.\d+){0,3})$/iu)
  if (version) return { kind: 'environment_fact', key: `environment.version.${version[1]!.toLowerCase().replace('.js', '').replace('postgresql', 'postgres')}`,
    value: version[2]!, statement: text.trim() }
  const platform = sentence.match(/^(?:本项目|这个项目|项目|开发环境)(?:在|使用|运行于)\s*(macos|linux|windows|ubuntu)(?:\s+(\d+(?:\.\d+){0,2}))?$/iu)
  if (platform) return { kind: 'environment_fact', key: 'environment.platform', value: `${platform[1]!.toLowerCase()}:${platform[2] ?? ''}`, statement: text.trim() }
  const manager = sentence.match(/^(?:本项目|这个项目|项目)(?:统一)?(?:使用|用|采用)\s*(corepack\s+)?(pnpm|npm|yarn|bun)\s*(?:管理依赖|安装依赖|作为包管理器)?$/iu)
    ?? sentence.match(/^(?:(?:the|this) )?project uses (corepack\s+)?(pnpm|npm|yarn|bun)(?: (?:as (?:its |the )?package manager|to manage dependencies))?$/iu)
  if (manager) return { kind: 'working_practice', key: 'practice.package_manager', value: `${manager[1] ? 'corepack ' : ''}${manager[2]!.toLowerCase()}`, statement: text.trim() }
  const command = sentence.match(/^(?:本项目|这个项目|项目)?(?:测试命令|验证命令)(?:是|为|使用|:|：)\s*((?:corepack\s+)?(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?[a-zA-Z0-9:_-]+)$/u)
  if (command) return { kind: 'working_practice', key: 'practice.test_command', value: command[1]!.replace(/\s+/gu, ' '), statement: text.trim() }
  return null
}
/** A bounded expression setting from the original supported wording. Callers must
 * separately verify that the current revision still matches its durable candidate.
 * This deliberately does not accept Hindsight paraphrases or arbitrary instructions.
 */
export function memoryCommunicationPreference(text: string): MemoryCommunicationPreference | null {
  const parsed = supportedStatement(text)
  if (parsed?.kind !== 'communication_preference') return null
  if (parsed.key === 'communication.language' && (parsed.value === 'chinese' || parsed.value === 'english')) {
    return { kind: 'language', value: parsed.value }
  }
  if (parsed.key === 'communication.detail' && (parsed.value === 'concise' || parsed.value === 'detailed')) {
    return { kind: 'detail', value: parsed.value }
  }
  if (parsed.key === 'communication.change_order' && parsed.value === 'behavior_then_tests') {
    return { kind: 'change_order', value: parsed.value }
  }
  return null
}
/** Parse only a remote extraction, never a user's original statement. Hindsight may
 * append entity labels or render a direct preference as a third-person statement.
 * Only the known role-label suffix is removable; other payload stays part of the
 * complete sentence and must satisfy the grammar. This produces no new evidence.
 */
function supportedRemoteStatement(text: string): Supported | null {
  if (rulePattern.test(text)) return null
  const sentence = text.trim().replace(/ \| Involving: (?:user|assistant)(?:, (?:user|assistant))*$/u, '')
  const direct = supportedStatement(sentence)
  if (direct) return direct
  if (Buffer.byteLength(sentence) > 1_800) return null
  const language = sentence.replace(/[。.!！]+$/u, '').match(
    /^(?:用户|该用户)(?:要求|请求|希望|偏好)(?:助手)?(?:(?:以后|今后|之后|默认)|(?:在)?(?:后续|今后|以后)(?:的)?(?:对话|交流)(?:中)?)?(?:用|使用)(中文|英文|英语)(?:回答|解释|回复|解释改动|说明改动)$/u,
  )
  return language ? { kind: 'communication_preference', key: 'communication.language',
    value: language[1] === '中文' ? 'chinese' : 'english', statement: sentence } : null
}
function sourceSegments(material: AutomaticMemoryMaterial): AutomaticMemoryMaterial[] {
  // Do not turn a conditional, negated, quoted, or one-off instruction into an unconditional preference.
  if (material.role === 'user' && /(?:如果|假如|否则|除非|不要|不是|并非|不想|暂时|这次|比如|例如|示例|假设|他说|她说|引用|[“”"「」]|\b(?:if|unless|not|example|quoted|temporary)\b)/iu.test(material.text)) return []
  if (material.role === 'tool') return [material]
  return material.text.split(/[。！？\n；;]+|[，,](?=\s*(?:本项目|这个项目|项目|解释改动|说明改动|以后|请用|node|pnpm|npm|python|postgres))/iu)
    .map((text) => text.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/u, '')).filter(Boolean).slice(0, 32).map((text) => ({ ...material, text }))
}
function sourceSupported(material: AutomaticMemoryMaterial, event: AutomaticMemoryEvent): Supported | null {
  if (!material.evidence || material.evidence.sourceId.length === 0 || material.evidence.sourceRevision.length === 0) return null
  if (material.role === 'user' && material.evidence.kind === 'user_statement') return supportedStatement(material.text)
  if (material.role !== 'tool' || material.evidence.kind !== 'verified_tool_result' || event.outcome !== 'completed') return null
  const command = material.text.match(/^command: ([^\r\n]{1,400})\r?\nexitCode: 0$/u)
  if (command && /^(?:corepack )?(?:pnpm|npm|yarn|bun) (?:run )?[A-Za-z0-9:_-]+$/u.test(command[1]!)) {
    return { kind: 'verified_procedure', key: 'practice.test_command', value: command[1]!, statement: `已验证的项目命令：${command[1]}` }
  }
  // Structured host evidence from a verified recovery, not arbitrary assistant prose.
  const repair = material.text.match(/^failure: ([^\r\n]{1,300})\r?\nremedy: ([^\r\n]{1,300})\r?\nverification: ([^\r\n]{1,400})\r?\nexitCode: 0$/u)
  if (repair && !rulePattern.test(material.text)) return { kind: 'troubleshooting', key: `repair.${automaticMemoryDigest(normalized(repair[1]!)).slice(7, 31)}`,
    value: normalized(repair[2]!), statement: `遇到“${repair[1]}”时，采用“${repair[2]}”；已通过“${repair[3]}”验证。` }
  return supportedStatement(material.text)
}
/** Human-authored content is allowed beyond the automatic grammar, but known slots still require conflict review. */
export function classifyManualMemoryDecision(decision: AutomaticMemoryDecision,
  existing: readonly AutomaticMemoryExistingMemory[] = []): AutomaticMemoryDecision {
  if (!decision.manual) throw new Error('Expected an explicit manual memory request')
  const { conflictsWith: _oldConflicts, semanticKey: _oldKey, ...base } = decision
  if (isMemoryBusinessRule(decision.statement)) return { ...base, statementKind: 'business_rule', disposition: 'rule_candidate', reason: 'requires_workflow_approval' }
  const supported = supportedStatement(decision.statement)
  if (!supported) return { ...base, statementKind: 'unclassified', disposition: 'auto_save', reason: 'explicit_manual_request' }
  const conflicts = existing.filter((memory) => {
    const parsed = supportedStatement(memory.statement)
    return (memory.semanticKey === supported.key || parsed?.key === supported.key) &&
      normalized(memory.statement) !== normalized(supported.statement) && (memory.semanticValue ?? parsed?.value) !== supported.value
  }).map(({ memoryId, revision, statement }) => ({ memoryId, revision, statement }))
  return { ...base, statementKind: supported.kind, semanticKey: supported.key,
    disposition: conflicts.length ? 'conflict' : 'auto_save', ...(conflicts.length ? { conflictsWith: conflicts } : {}),
    reason: conflicts.length ? 'conflicts_with_active_memory' : 'explicit_manual_request' }
}
export function classifyMemoryLearningFact(event: AutomaticMemoryEvent, fact: AutomaticMemoryFact,
  existing: readonly AutomaticMemoryExistingMemory[] = [], now = new Date().toISOString()): AutomaticMemoryDecision {
  const base: AutomaticMemoryDecision = { id: `decision-${automaticMemoryDigest(`${event.id}:${fact.id}:${event.policyVersion}`).slice(7)}`,
    eventId: event.id, factId: fact.id, projectId: event.scope.localProjectId, statement: fact.text,
    statementKind: 'unclassified', disposition: 'ignored', evidenceMaterialIds: [], reason: 'unsupported_evidence', createdAt: now }
  if (event.sourceKind === 'manual_remember' || event.manualRequest) return { ...base, reason: 'explicit_human_decision_required' }
  if (event.revoked || fact.eventId !== event.id || fact.sourceDigest !== event.sourceDigest ||
      event.policyVersion !== AUTOMATIC_MEMORY_POLICY_VERSION || fact.contentDigest !== automaticMemoryDigest(fact.text) ||
      redactSensitiveText(fact.text).value !== fact.text) return base
  const originalGrounded = event.materials.filter((material) => material.role !== 'assistant' && material.evidence &&
    ((material.role === 'user' && material.evidence.kind === 'user_statement') ||
      (material.role === 'tool' && material.evidence.kind === 'verified_tool_result') ||
      (material.role === 'artifact' && material.evidence.kind === 'approved_artifact')))
  const grounded = originalGrounded.flatMap(sourceSegments)
  // Rule candidates are proposals. No keyword path below is allowed to promote anything.
  // A persisted draft artifact may propose a rule without pretending it is approved evidence.
  const ruleSources = [...originalGrounded, ...event.materials.filter((material) => material.role === 'artifact')]
    .flatMap((material) => material.text.split(/[。！？\n；;]+/u).filter(Boolean).slice(0, 32).map((text) => ({ ...material, text: text.trim() })))
  const ruleSource = ruleSources.find((material) => rulePattern.test(material.text) && rulePattern.test(fact.text) &&
    (normalized(material.text).includes(normalized(fact.text)) || normalized(fact.text).includes(normalized(material.text))))
  if (ruleSource) return { ...base, statement: ruleSource.text, statementKind: 'business_rule', disposition: 'rule_candidate',
    evidenceMaterialIds: [ruleSource.id], reason: 'requires_workflow_approval' }
  // World extraction may paraphrase a user's rule. If the source contains only
  // one identifiable rule, surface the original material for human review; never
  // give the remote explanation authority or strip a source's qualification.
  // More than one rule clause/source is ambiguous and must not be guessed here.
  const userRuleSources = originalGrounded.filter((material) => material.role === 'user' &&
    material.evidence?.sourceId && material.evidence.sourceRevision && rulePattern.test(material.text))
  const uniqueRuleSource = userRuleSources.length === 1 ? userRuleSources[0] : undefined
  if (fact.factType === 'world' && rulePattern.test(fact.text) && uniqueRuleSource &&
      Buffer.byteLength(uniqueRuleSource.text) <= 1_800 &&
      uniqueRuleSource.text.split(/[。！？\n；;，,]+|并且|同时|以及|\band\b/iu).filter((clause) => rulePattern.test(clause)).length === 1) {
    return { ...base, statement: uniqueRuleSource.text.trim(), statementKind: 'business_rule', disposition: 'rule_candidate',
      evidenceMaterialIds: [uniqueRuleSource.id], reason: 'requires_workflow_approval' }
  }
  // An extraction mixing an experience with additional business rules is not an
  // experience candidate. A separately grounded rule can still be proposed above.
  if (rulePattern.test(fact.text)) return base
  for (const material of grounded) {
    const supported = sourceSupported(material, event)
    if (!supported) continue
    const remote = supportedRemoteStatement(fact.text)
    // A user experience must match a complete semantic slot, not merely appear
    // inside a quote, negation, conditional or a longer unsupported statement.
    const exactGrounding = material.role === 'tool' && normalized(fact.text) === normalized(material.text)
    const semanticGrounding = remote?.key === supported.key && remote.value === supported.value
    const toolGrounding = material.role === 'tool' && (supported.kind === 'verified_procedure'
      ? fact.text.includes(supported.value) : supported.kind === 'troubleshooting'
        ? fact.text.includes(material.text.split('\n')[0]!.slice('failure: '.length)) && fact.text.includes(material.text.split('\n')[1]!.slice('remedy: '.length)) : false)
    if (!exactGrounding && !semanticGrounding && !toolGrounding) continue
    const conflictingSource = grounded.some((other) => {
      const otherSupported = sourceSupported(other, event)
      return other.text !== material.text && otherSupported?.key === supported.key && otherSupported.value !== supported.value
    })
    if (conflictingSource) return { ...base, statement: supported.statement, statementKind: supported.kind,
      semanticKey: supported.key, evidenceMaterialIds: [material.id], disposition: 'conflict', reason: 'conflicting_event_sources' }
    const sameSlot = existing.filter((memory) => memory.semanticKey === supported.key || supportedStatement(memory.statement)?.key === supported.key)
    const duplicate = sameSlot.some((memory) => normalized(memory.statement) === normalized(supported.statement) ||
      (memory.semanticValue ?? supportedStatement(memory.statement)?.value) === supported.value)
    if (duplicate) return { ...base, statement: supported.statement, statementKind: supported.kind, semanticKey: supported.key,
      evidenceMaterialIds: [material.id], reason: 'duplicate' }
    const conflicts = sameSlot.map(({ memoryId, revision, statement }) => ({ memoryId, revision, statement }))
    return { ...base, statement: supported.statement, statementKind: supported.kind, semanticKey: supported.key,
      evidenceMaterialIds: [material.id], disposition: conflicts.length ? 'conflict' : 'auto_save',
      ...(conflicts.length ? { conflictsWith: conflicts } : {}), retentionDays: 30,
      reason: conflicts.length ? 'conflicts_with_active_memory' : 'verified_source_policy' }
  }
  return base
}
