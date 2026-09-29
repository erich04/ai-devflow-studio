import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowNode, WorkflowRun } from '@ai-devflow/shared'
import { SettingsView } from './SettingsView'
import {
  legacyViewSettingsSection,
  settingsSectionForTaskTarget,
  settingsSections,
  type SupportContext,
} from '../app/desktop-view-model'

const testNode: WorkflowNode = {
  id: 'node-test',
  stage: 'test',
  title: 'Run tests',
  subtitle: 'Archive local evidence',
  kind: 'test',
  status: 'running',
  ownerId: 'user-1',
  retryCount: 0,
  artifactIds: [],
}

const run: WorkflowRun = {
  id: 'run-1',
  version: 1,
  title: 'Fixture run',
  request: 'Validate the release.',
  projectId: 'team-project-1',
  creatorId: 'user-1',
  status: 'testing',
  currentNodeId: testNode.id,
  branchName: 'devflow/run-1',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  nodes: [testNode],
  edges: [],
}

const fromTask: SupportContext = {
  runId: run.id,
  nodeId: testNode.id,
  sourceView: 'workbench',
  returnView: 'workbench',
  focusTarget: 'local-tests',
  label: '设置测试命令',
  inspectorTab: '当前工作',
  createdAt: '2026-09-28T00:00:00.000Z',
}

describe('settings sections (plan §4.1, §4.3, Y1)', () => {
  it('lists the six sections in order and maps the removed entries to them', () => {
    expect(settingsSections.map((section) => section.label)).toEqual(['本地项目', '模型与执行方式', '扩展能力', '团队连接', '外观', '高级'])
    expect(legacyViewSettingsSection).toEqual({ agents: 'models', skills: 'extensions', mcp: 'extensions', tests: 'project', diagnostics: 'advanced' })
    expect(settingsSectionForTaskTarget('coding')).toBe('models')
    expect(settingsSectionForTaskTarget('models')).toBe('models')
    expect(settingsSectionForTaskTarget('tests')).toBe('project')
  })

  it('shows one section with its scope and switches sections without leaving settings', () => {
    const onSectionChange = vi.fn()
    render(<SettingsView section="models" onSectionChange={onSectionChange} supportContext={null} run={run} onReturnToTask={vi.fn()}><p>模型内容</p></SettingsView>)

    const nav = screen.getByRole('navigation', { name: '设置分区' })
    expect(within(nav).getByRole('button', { name: '模型与执行方式' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: '模型与执行方式' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-section-models')).toHaveTextContent('作用范围：本机与团队')
    expect(screen.getByText('模型内容')).toBeInTheDocument()
    expect(screen.queryByTestId('support-context-banner')).not.toBeInTheDocument()
    fireEvent.click(within(nav).getByRole('button', { name: '团队连接' }))
    expect(onSectionChange).toHaveBeenCalledWith('team')
  })

  it('offers the way back after a save from a task and runs nothing (W9)', () => {
    const onReturnToTask = vi.fn()
    const { rerender } = render(<SettingsView section="project" onSectionChange={vi.fn()} supportContext={fromTask} run={run} onReturnToTask={onReturnToTask}><p /></SettingsView>)
    const banner = screen.getByTestId('support-context-banner')
    expect(banner).toHaveTextContent('来自任务')
    expect(banner).toHaveTextContent('设置测试命令')
    expect(banner).toHaveTextContent('当前目标：Fixture run · Run tests')
    expect(banner).toHaveTextContent('保存后可以返回任务；返回后不会自动执行任何操作。')

    rerender(<SettingsView section="project" onSectionChange={vi.fn()} supportContext={{ ...fromTask, savedAt: '2026-09-28T00:01:00.000Z' }} run={run} onReturnToTask={onReturnToTask}><p /></SettingsView>)
    expect(screen.getByTestId('support-context-banner')).toHaveTextContent('已保存。可以返回任务')
    fireEvent.click(screen.getByRole('button', { name: '返回任务' }))
    expect(onReturnToTask).toHaveBeenCalledTimes(1)
  })

  it('does not show a task banner for knowledge or search contexts', () => {
    render(<SettingsView section="project" onSectionChange={vi.fn()} supportContext={{ ...fromTask, focusTarget: 'knowledge-reference', label: '知识引用来源' }} run={run} onReturnToTask={vi.fn()}><p /></SettingsView>)
    expect(screen.queryByTestId('support-context-banner')).not.toBeInTheDocument()
  })
})
