// Live assertions used by the Electron full-chain runner in project-memory mode.
import assert from 'node:assert/strict'
import { expect, type Page } from '@playwright/test'
import type { ProjectKnowledgePages, ProjectMemoryPage, ProjectMemoryStatus } from '../packages/shared/src/project-memory.ts'
import type { ConversationResponse } from '../apps/desktop/electron/workbench-conversation-contract.ts'

type Ipc = <T>(method: string, payload: unknown) => Promise<T>
type Identity = { id: string; contentDigest: string }

export function assertMemoryDelivery(entry: string, memories: readonly Identity[] | undefined) {
  assert(memories, `${entry}: missing memory receipt`)
  assert(memories.some(({ id }) => id === 'pm-devflow-essentials'), `${entry}: no essentials page in the actual receipt`)
  assert(memories.some(({ id }) => id.startsWith('pm-') && id !== 'pm-devflow-essentials'), `${entry}: missing recalled project memory`)
  assert(memories.every(({ contentDigest }) => /^sha256:[a-f0-9]{64}$/u.test(contentDigest)))
  return memories
}

export async function exerciseProjectMemoryChat(ipc: Ipc, projectId: string, providerId: string, endpoint: string) {
  const configured = await ipc<ProjectMemoryStatus>('configureProjectMemory', { projectId, providerId, endpoint, enabled: true })
  assert(configured.enabled && configured.pairedProject && configured.bankId?.startsWith('df-memory-'))
  const chat = async (text: string, executor: 'opencode' | 'direct-provider' = 'direct-provider') => {
    const { conversationId } = await ipc<ConversationResponse>('workbenchConversation', { type: 'create', projectId, executor })
    assert(conversationId)
    const sent = await ipc<ConversationResponse>('workbenchConversation', { type: 'send', projectId, conversationId, providerId, text })
    assert(!sent.error, sent.error)
    const session = async () => (await ipc<ConversationResponse>('workbenchConversation', { type: 'list', projectId })).conversations.find(s => s.id === conversationId)
    await expect.poll(async () => (await session())?.status, { timeout: 150_000, intervals: [1000] }).not.toBe('running')
    const result = await session()
    assert.equal(result?.status, 'idle', result?.error)
    return result
  }
  await chat('这个 Todo 项目今后的通用约定是新增代码注释一律使用英文。同步失败最多重试 5 次，退避上限 30 秒。请简短确认。')
  // Wait for an actual turn to leave the durable outbox. Reading a page does not trigger extraction.
  await expect.poll(async () => (await ipc<ProjectMemoryStatus>('getProjectMemoryStatus', { projectId })).recent
    .some(row => row.sourceKind === 'conversation' && row.status === 'retained'), { timeout: 420_000, intervals: [3000] }).toBe(true)
  const page = async () => (await ipc<ProjectKnowledgePages>('listProjectKnowledgePages', { projectId })).pages.find(p => p.id === 'essentials')?.content
  if (!/英文|English/iu.test(await page() ?? '')) await ipc('refreshProjectKnowledgePage', { projectId, pageId: 'essentials' })
  await expect.poll(page, { timeout: 240_000, intervals: [3000] }).toMatch(/英文|English/iu)
  const second = await chat('按之前讨论过的设置，同步重试的次数和退避上限分别是多少？新增注释使用什么语言？')
  const answer = second.messages.filter(m => m.role === 'assistant').at(-1)?.text ?? ''
  assert.match(answer, /5|五/u)
  assert.match(answer, /30|三十/u)
  assert.match(answer, /英文|英语|English/iu)
  const identities = assertMemoryDelivery('discussion', second.contextReceipt?.memory?.memories)
  let openCodeMemory
  if (process.env.DEVFLOW_MEMORY_VERIFY_OPENCODE === '1') {
    const session = await chat('根据项目记忆，新增的代码注释约定用什么语言？请用一句话作答。', 'opencode')
    assert.equal(session.contextReceipt?.memory?.executor, 'opencode')
    assert.match(session.messages.filter(m => m.role === 'assistant').at(-1)?.text ?? '', /英文|英语|English/iu)
    openCodeMemory = assertMemoryDelivery('opencode', session.contextReceipt?.memory?.memories)
  }
  return { openCodeMemory, bankId: configured.bankId, pageBytes: Buffer.byteLength(await page() ?? ''), identities, answer }
}

export async function exerciseCurationPanel(page: Page, ipc: Ipc, projectId: string) {
  await page.reload()
  await page.getByRole('button', { name: '知识', exact: true }).click()
  const panel = page.getByRole('region', { name: '项目记忆' })
  const rows = panel.getByRole('list', { name: '记忆列表' })
  await expect(rows.getByRole('listitem').first()).toBeVisible()
  await expect(rows.getByRole('button', { name: /编辑|删除/u })).toHaveCount(0)
  await panel.getByRole('tab', { name: '事实', exact: true }).click()
  const facts = async () => (await ipc<ProjectMemoryPage>('listProjectMemories', { projectId, kind: 'world' })).items
  const fact = (await facts())[0]
  assert(fact)
  const row = rows.getByRole('listitem').filter({ has: page.getByText(fact.text, { exact: true }) })
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  const edited = '用户修订：合成 Todo 新注释使用英文，代码示例放在 README。'
  await panel.getByRole('textbox', { name: '编辑记忆内容' }).fill(edited)
  await panel.getByRole('button', { name: '保存修改' }).click()
  await expect.poll(async () => (await facts()).find(item => item.id === fact.id)?.text).toBe(edited)
  await rows.getByRole('listitem').filter({ hasText: edited }).getByRole('button', { name: '删除', exact: true }).click()
  await expect.poll(async () => (await facts()).some(item => item.id === fact.id)).toBe(false)
  await panel.getByRole('tab', { name: '观察', exact: true }).click()
  await expect(panel.getByText(/观察由 Hindsight 从来源归纳/u)).toBeVisible()
  return { observationReadOnly: true, editVerifiedInHindsight: true, deletedFactAbsent: true }
}
