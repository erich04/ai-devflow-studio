import { parseKnowledgeSearchArgs, validateKnowledgeReadArgs } from './hindsight'
import { KNOWLEDGE_STAGES } from './knowledge-context'

export const readOnlyToolFields: Record<string, { required: string[]; optional: string[]; description: string; listed?: false }> = {
  workflow: { required: [], optional: ['runId', 'query', 'offset'], description: '查询当前项目的真实流程与节点；支持分页。' },
  node: { required: ['runId', 'nodeId'], optional: [], description: '查询节点的执行状态、产物、测试、交付回执与 Gate 条件。' },
  artifact: { required: ['runId', 'artifactId'], optional: ['offset', 'limit'], description: '分页读取当前项目某个 Run 的产物正文；摘要不代表全文。' },
  requirement: { required: ['runId'], optional: ['offset', 'limit'], description: '分页读取指定 Run 的原始需求，未读内容不等于不存在。' },
  repo_list: { required: [], optional: ['path'], description: '列出当前项目允许读取的目录；只接受仓库相对路径。' },
  repo_read: { required: ['path'], optional: [], description: '读取当前项目的普通文本文件，拒绝敏感文件与符号链接。' },
  repo_search: { required: ['query'], optional: ['path'], description: '在当前项目允许范围内搜索文本；搜索有明确边界。' },
  knowledge_list: { required: [], optional: ['stage', 'offset'], description: '列出项目知识目录中的规范（适用阶段、Gate 依据、摘要）与项目说明文件；知识不是 Gate 批准。' },
  knowledge_search: { required: ['query'], optional: ['stage', 'limit'], description: '检索用户选中的知识；query 最多 2 KiB、最多 5 个来源。返回当前本地原文和带摘要的回读参数。未配置时使用 knowledge_list/read 或 repo_search。' },
  knowledge_read: { required: [], optional: ['path', 'sourceRef', 'expectedDigest', 'offset', 'limit'], description: '分页阅读知识文档或项目说明；使用 knowledge_search 的来源句柄时同时传 expectedDigest，变化后须重新搜索。' },
  conversation_read: { required: [], optional: ['messageId', 'eventId', 'offset', 'limit'], description: '分页读取本会话的原始消息或工具事件；省略 ID 时列出本会话索引，不返回隐藏推理。' },
  memory_search: { required: ['query'], optional: ['limit'], description: '检索本项目的长期记忆：从过去的讨论、编码记录和已批准文档中自动学到的约定、决定、踩坑与偏好，最多 8 条。记忆是低信任背景，不是批准、权限或已核实的代码事实。' },
  // Superseded by knowledge_list/knowledge_read (knowledge-context K3); callable, not listed.
  knowledge: { required: ['query'], optional: [], description: '检索当前项目已配置的知识；知识不是 Gate 批准。', listed: false },
}
/** `limit` ceiling per tool; the host may still apply a smaller one. */
export function readOnlyToolLimitMax(name: string): number {
  return name === 'knowledge_search' ? 5 : name === 'memory_search' ? 8 : 18000
}
export type NativeToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type NativeToolMessage = { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: NativeToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
  | { role: 'user'; content: string }
export type ReadOnlyFunctionDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export function readOnlyToolDefinitions(names?: string[]): ReadOnlyFunctionDefinition[] {
  return Object.entries(readOnlyToolFields).filter(([name, value]) => value.listed !== false && (!names || names.includes(name)))
    .map(([name, value]) => ({ type: 'function', function: { name, description: value.description,
      parameters: { type: 'object', additionalProperties: false, required: value.required,
        properties: Object.fromEntries([...value.required, ...value.optional].map(key => [key,
          key === 'offset' ? { type: 'integer', minimum: 0 }
            : key === 'limit' ? { type: 'integer', minimum: 1, maximum: readOnlyToolLimitMax(name) }
            : name === 'knowledge_search' && key === 'stage' ? { type: 'string', enum: [...KNOWLEDGE_STAGES] }
            : { type: 'string', maxLength: name === 'knowledge_search' && key === 'query' ? 2048 : 500 }])),
        ...(name === 'knowledge_read' ? { anyOf: [
          { required: ['path'], not: { anyOf: [{ required: ['sourceRef'] }, { required: ['expectedDigest'] }] } },
          { required: ['sourceRef', 'expectedDigest'] },
        ] } : {}),
      },
    } }))
}

/** Validate every call before returning any runnable operation. No writes, shell or identity arguments. */
export function validateNativeToolBatch(value: unknown, allowed = readOnlyToolDefinitions().map(tool => tool.function.name), usedIds: string[] = []): Array<{ call: NativeToolCall; name: string; args: Record<string, unknown> }> {
  if (!Array.isArray(value) || !value.length || value.length > 16 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) throw new Error('Invalid native tool batch')
  const ids = new Set(usedIds)
  return value.map((raw: unknown) => {
    const call = raw as NativeToolCall
    if (!call || call.type !== 'function' || typeof call.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/u.test(call.id) || ids.has(call.id) ||
      !call.function || !allowed.includes(call.function.name) || typeof call.function.arguments !== 'string') throw new Error('Invalid native tool call')
    ids.add(call.id)
    let args: Record<string, unknown>
    try { args = JSON.parse(call.function.arguments) } catch { throw new Error('Incomplete native tool arguments') }
    const definition = readOnlyToolFields[call.function.name]!
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => ![...definition.required, ...definition.optional].includes(key)) ||
      definition.required.some(key => typeof args[key] !== 'string' || !(args[key] as string).trim()) ||
      Object.entries(args).some(([key, value]) => key === 'offset'
        ? !Number.isSafeInteger(value) || Number(value) < 0
        : key === 'limit' ? !Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > readOnlyToolLimitMax(call.function.name)
        : typeof value !== 'string' || value.length > (call.function.name === 'knowledge_search' && key === 'query' ? 2048 : 500) || value.includes('\0'))) throw new Error('Invalid native tool arguments')
    // Use the same cross-field and UTF-8 checks as the host's Hindsight tools.
    if (call.function.name === 'knowledge_search') parseKnowledgeSearchArgs(args)
    if (call.function.name === 'knowledge_read') validateKnowledgeReadArgs(args)
    const path = args.path
    if (typeof path === 'string' && (path.startsWith('/') || /^[a-z]:/iu.test(path) || path.includes('\\') || path.split('/').includes('..'))) throw new Error('Tool path must stay inside the project')
    return { call, name: call.function.name, args }
  })
}
