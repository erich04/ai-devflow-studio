import { FolderOpen, Moon, Sun } from 'lucide-react'
import type * as React from 'react'
import type {
  CommandSafetyResult,
  LocalProject,
  ThemePreference,
} from '@ai-devflow/shared'

export function NavButton({
  active,
  ariaLabel,
  icon,
  label,
  onClick,
}: {
  active: boolean
  ariaLabel?: string
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className={`nav-button ${active ? 'is-active' : ''}`} aria-label={ariaLabel} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
}) {
  const next = value === 'system' ? 'light' : value === 'light' ? 'dark' : 'system'
  const label = value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'

  return (
    <button
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label="Toggle color theme"
      data-testid="theme-toggle"
    >
      {value === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
      {label}
    </button>
  )
}

export function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function LocalProjectPanel({
  project,
  commandDraft,
  onSelectProject,
  desktopConnected,
  commandSafety,
  isSavingCommand,
}: {
  project: LocalProject | undefined
  commandDraft: string
  onCommandDraftChange: (value: string) => void
  onSelectProject: () => void
  onSaveCommand: () => void
  desktopConnected: boolean
  commandSafety: CommandSafetyResult | null
  isCommandDirty: boolean
  isSavingCommand: boolean
}) {
  return (
    <section className="local-project-panel" aria-label="Local project">
      <div className="panel-head panel-head--compact">
        <span className="panel-title">Local Project + Runs</span>
        <span className="pill soft">local only</span>
      </div>
      <div className="mini-card local-project-summary">
        <p className="section-title">本地仓库</p>
        <div className="row">
          <strong>{project?.name ?? '未选择仓库'}</strong>
          <span className={`pill ${project ? 'good' : 'warn'}`}>{project ? 'connected' : 'not selected'}</span>
        </div>
        <p className="meta mono">
          {project?.path ??
            (desktopConnected
              ? '选择本地仓库后，DevFlow 会识别执行边界。'
              : '浏览器预览模式无法打开本地目录。')}
        </p>
        <div className="row">
          <span className="meta">Team Project 归属</span>
          <strong>Payments API</strong>
        </div>
        <div className="row">
          <span className="meta">Command safety</span>
          <span className={`pill ${commandSafety?.level === 'safe' ? 'good' : commandSafety ? 'warn' : 'soft'}`}>
            {commandSafety?.level === 'safe' ? 'package script' : commandSafety?.level ?? 'pending'}
          </span>
        </div>
        <div className="row">
          <span className="meta">Test command 来源</span>
          <span className="pill soft">{isSavingCommand ? 'saving' : 'Local Project config'}</span>
        </div>
        <p className="meta mono">{commandSafety?.normalizedCommand || commandDraft || 'pnpm verify --filter @devflow/desktop'}</p>
        <button className="ghost-button local-project-select" onClick={onSelectProject}>
          <FolderOpen size={16} />
          选择本地仓库
        </button>
      </div>
    </section>
  )
}
