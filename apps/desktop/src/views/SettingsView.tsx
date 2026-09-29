import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  displayNodeTitle,
  settingsSections,
  type SettingsSection,
  type SupportContext,
} from '../app/desktop-view-model'
import type { WorkflowRun } from '@ai-devflow/shared'

/**
 * 设置 (plan §4.1, Y2): a section list and one section at a time. Each section names who the
 * setting applies to. Opened from a task, the section keeps 「来自任务 · 返回任务」 (plan W9).
 */
export function SettingsView({
  section,
  onSectionChange,
  supportContext,
  run,
  onReturnToTask,
  children,
}: {
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  supportContext: SupportContext | null
  run: WorkflowRun | undefined
  onReturnToTask: () => void
  /** Content of the active section only. */
  children: ReactNode
}) {
  const active = settingsSections.find((item) => item.id === section) ?? settingsSections[0]!
  const fromTask = supportContext && (supportContext.focusTarget === 'coding-agent' || supportContext.focusTarget === 'local-tests')
    ? supportContext
    : null
  const node = fromTask ? run?.nodes.find((candidate) => candidate.id === fromTask.nodeId) : undefined
  return (
    <section className="settings-page" data-testid="settings-view" aria-label="设置">
      <nav className="settings-sections" aria-label="设置分区">
        {settingsSections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-section-button ${item.id === active.id ? 'is-active' : ''}`}
            aria-current={item.id === active.id ? 'page' : undefined}
            onClick={() => onSectionChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-content" data-testid={`settings-section-${active.id}`}>
        <header className="settings-content-head">
          <h2>{active.label}</h2>
          <p className="meta"><span className="pill soft">作用范围：{active.scope}</span> {active.description}</p>
        </header>
        {fromTask ? (
          <div className="support-context-banner" data-testid="support-context-banner">
            <div>
              <span className="panel-label">来自任务</span>
              <strong>{fromTask.label}</strong>
              <p>当前目标：{run?.id === fromTask.runId ? run.title : fromTask.runId} · {node ? displayNodeTitle(node) : fromTask.nodeId}</p>
              {/* Saving never navigates or runs anything; the user returns explicitly (plan W9). */}
              <p role="status">
                {fromTask.savedAt
                  ? '已保存。可以返回任务，回到原来的阅读位置；返回后不会自动执行任何操作。'
                  : '保存后可以返回任务；返回后不会自动执行任何操作。'}
              </p>
            </div>
            <button className="ghost-button" type="button" onClick={onReturnToTask}>
              <ArrowLeft size={16} />
              返回任务
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </section>
  )
}
