import { isKnowledgeStage, utf8ByteLength } from './knowledge-context'

/** Declarative semantic extraction only. Names/labels never grant identity or approval. */
export type KnowledgeModelField = {
  type: 'value' | 'multi-values' | 'text' | 'multi-text' | 'map'
  description?: string
  values?: { value: string; description?: string }[]
  fields?: Record<string, KnowledgeModelField>
}
export type KnowledgeModelDefinition = {
  version: string
  dimensions: (KnowledgeModelField & { key: string; tag?: boolean })[]
}
export type HindsightSetupInput = {
  projectId: string; endpoint: string; apiKey?: string; selectedPaths: string[]
  includeMemories: boolean; enabled: boolean
  /** Fresh consent for the current paired identity; never inferred from an old enabled flag. */
  pairedProjectConsent?: boolean
}
export type HindsightStatus = {
  configured: boolean; enabled: boolean; transportAvailable: boolean; endpoint: string
  selectedPaths: string[]; includeMemories: boolean; modelVersion?: string
  counts: Record<string, number>; note: string
  pairedProject?: boolean
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('知识模型必须是 JSON 对象。')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('知识模型含有未支持的字段。')
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error('知识模型文本无效。')
  return value
}
export function parseKnowledgeModel(value: unknown): KnowledgeModelDefinition {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string' || utf8ByteLength(serialized) > 16_384) throw new Error('知识模型过大或无效。')
  const model = record(value); keys(model, ['version', 'dimensions'])
  const version = text(model.version, 80)
  if (!Array.isArray(model.dimensions) || model.dimensions.length < 1 || model.dimensions.length > 4) throw new Error('知识模型需要 1 至 4 个抽取维度。')
  let fields = 0
  function field(value: unknown, depth: number, top = false): KnowledgeModelField {
    if (depth > 3 || ++fields > 32) throw new Error('知识模型层级或字段过多。')
    const item = record(value)
    keys(item, ['type', 'description', 'values', 'fields', ...(top ? ['key', 'tag'] : [])])
    if (!['value', 'multi-values', 'text', 'multi-text', 'map'].includes(String(item.type))) throw new Error('不支持的知识模型字段类型。')
    const result: KnowledgeModelField = { type: item.type as KnowledgeModelField['type'] }
    if (item.description !== undefined) result.description = text(item.description, 500)
    if (item.type === 'map') {
      const nested = record(item.fields)
      if (!Object.keys(nested).length) throw new Error('map 需要字段。')
      result.fields = Object.fromEntries(Object.entries(nested).map(([key, item]) => {
        if (!/^[a-z][a-z0-9_]{0,40}$/u.test(key) || key.startsWith('df_')) throw new Error('知识模型字段名无效。')
        return [key, field(item, depth + 1)]
      }))
    } else if (item.fields !== undefined) throw new Error('只有 map 可以声明 fields。')
    if (item.type === 'value' || item.type === 'multi-values') {
      if (!Array.isArray(item.values) || item.values.length < 1 || item.values.length > 32) throw new Error('枚举值数量无效。')
      result.values = item.values.map((entry) => {
        const v = record(entry); keys(v, ['value', 'description'])
        return { value: text(v.value, 80), ...(v.description === undefined ? {} : { description: text(v.description, 500) }) }
      })
      if (new Set(result.values.map((v) => v.value)).size !== result.values.length) throw new Error('枚举值重复。')
    } else if (item.values !== undefined) throw new Error('文本和 map 不能声明枚举。')
    return result
  }
  const dimensions = model.dimensions.map((value) => {
    const item = record(value)
    if (typeof item.key !== 'string' || !/^sem_[a-z][a-z0-9_]{0,36}$/u.test(item.key)) throw new Error('抽取标签必须使用 sem_ 前缀。')
    if (item.tag !== undefined && typeof item.tag !== 'boolean') throw new Error('标签开关无效。')
    return { key: item.key, ...field(item, 0, true), ...(item.tag === undefined ? {} : { tag: item.tag }) }
  })
  if (new Set(dimensions.map((d) => d.key)).size !== dimensions.length) throw new Error('抽取标签重复。')
  return { version, dimensions }
}
export function knowledgeModelLabels(model: KnowledgeModelDefinition) { return model.dimensions }

export function parseHindsightSetup(value: unknown): HindsightSetupInput {
  const input = record(value)
  keys(input, ['projectId', 'endpoint', 'apiKey', 'selectedPaths', 'includeMemories', 'enabled', 'pairedProjectConsent'])
  if (!Array.isArray(input.selectedPaths) || input.selectedPaths.length > 20 ||
      typeof input.enabled !== 'boolean' || typeof input.includeMemories !== 'boolean') throw new Error('Hindsight 设置无效；最多选择 20 份文档。')
  const selectedPaths = input.selectedPaths.map((value) => text(value, 500))
  if (input.pairedProjectConsent !== undefined && typeof input.pairedProjectConsent !== 'boolean') throw new Error('配对项目授权无效。')
  if (new Set(selectedPaths).size !== selectedPaths.length) throw new Error('文档选择重复。')
  return { projectId: text(input.projectId, 200), endpoint: text(input.endpoint, 2000), selectedPaths,
    includeMemories: input.includeMemories, enabled: input.enabled,
    ...(input.pairedProjectConsent === undefined ? {} : { pairedProjectConsent: input.pairedProjectConsent }),
    ...(input.apiKey === undefined ? {} : { apiKey: typeof input.apiKey === 'string' && input.apiKey.length <= 4096 ? input.apiKey : text(input.apiKey, 4096) }) }
}

export function parseKnowledgeSearchArgs(value: unknown) {
  const args = record(value); keys(args, ['query', 'stage', 'limit'])
  const query = text(args.query, 2048).trim()
  if (utf8ByteLength(query) > 2048 || query.includes('\0')) throw new Error('知识搜索 query 最多 2 KiB。')
  if (args.stage !== undefined && !isKnowledgeStage(args.stage)) throw new Error('知识搜索阶段无效。')
  const limit = args.limit ?? 5
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 5) throw new Error('知识搜索最多返回 5 个来源。')
  return { query, limit: Number(limit), ...(args.stage === undefined ? {} : { stage: args.stage }) }
}

export function validateKnowledgeReadArgs(value: unknown): void {
  const args = record(value); keys(args, ['path', 'sourceRef', 'expectedDigest', 'offset', 'limit'])
  for (const key of ['path', 'sourceRef', 'expectedDigest']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !(args[key] as string).trim() ||
        (args[key] as string).length > 500 || (args[key] as string).includes('\0'))) throw new Error('知识回读参数无效。')
  }
  const continuation = args.sourceRef !== undefined || args.expectedDigest !== undefined
  if (continuation ? args.sourceRef === undefined || args.expectedDigest === undefined : args.path === undefined) throw new Error('知识回读需要路径，或完整的来源句柄和摘要。')
  if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0)) throw new Error('知识分页位置无效。')
  if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 18000)) throw new Error('知识分页上限无效。')
}
