import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect } from 'vitest'
import type { Artifact } from '@ai-devflow/shared'
import { GateMaterialReader } from './GateMaterialReader'

it('renders the chosen material, hides technical IDs and keeps the complete source available', () => {
  const artifact: Artifact = { id: 'internal-clarification-id', runId: 'r', nodeId: 'n', kind: 'clarification', title: '任务筛选', summary: '摘要', content: '# 任务筛选\n\n|项目|约定|\n|---|---|\n|状态|不持久化|\n\n**完整尾部正文**', updatedAt: '2026-09-23T00:00:00Z', redacted: true }
  render(<GateMaterialReader bundle={{ state: 'ready', message: '材料齐全', activeRevision: artifact, rawRequest: { ...artifact, id: 'raw-id', content: '原始需求正文' }, revisions: [artifact], feedback: [] }} reports={[]} knowledge={<p>知识依据</p>} />)
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getByText('完整尾部正文')).toBeVisible()
  expect(screen.getByText('internal-clarification-id')).not.toBeVisible()
  fireEvent.click(screen.getByText('来源与版本'))
  expect(screen.getByText('internal-clarification-id')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: '原始需求 需求来源' }))
  expect(screen.getByText('原始需求正文')).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(screen.getByText('原始需求正文')).toBeVisible()
})
