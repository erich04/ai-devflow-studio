import { beforeEach, expect, it } from 'vitest'
import type { ConversationResponse } from '../../electron/workbench-conversation-contract'
import { buildDiscussionReference } from './discussion-reference'
import { discussedCardKey, discussionPlaceholder, readDiscussedCards, recordDiscussedCards } from './discussed-cards'
const reference = buildDiscussionReference({ materialId: 'change#finding:review:0', materialTitle: '意见 1', version: '改动 v1', label: '改动 v1 · 意见 1', projectName: '项目', runTitle: '任务', stageLabel: '开发实现', stepTitle: '开发', readAt: '2026-11-02T00:00:00.000Z' })
const result = (): ConversationResponse => ({ conversations: [{ id: 'chat', localProjectId: 'project', version: 1, title: '答疑', isOpen: true, inputDraft: '', status: 'idle', createdAt: '', updatedAt: '', messages: [{ id: 'message', role: 'user', text: '请解释意见 1', createdAt: '' }] }] })
beforeEach(() => localStorage.clear())
it('records only the persisted matching user message in the exact project and conversation', () => {
  expect(discussionPlaceholder([reference])).toBe('问问意见 1……')
  recordDiscussedCards('other', 'chat', '请解释意见 1', [reference], result()); expect(readDiscussedCards()).toEqual({})
  recordDiscussedCards('project', 'chat', '未发送的草稿', [reference], result()); expect(readDiscussedCards()).toEqual({})
  recordDiscussedCards('project', 'chat', '请解释意见 1', [reference], result())
  expect(readDiscussedCards()[discussedCardKey('project', reference.materialId)]).toBe('message')
})
it('ignores corrupt local receipts and never records an assistant answer as a discussion', () => {
  localStorage.setItem('devflow-discussed-cards', '{broken'); expect(readDiscussedCards()).toEqual({})
  const response = result(); response.conversations[0]!.messages[0]!.role = 'assistant'
  recordDiscussedCards('project', 'chat', '请解释意见 1', [reference], response); expect(readDiscussedCards()).toEqual({})
})
