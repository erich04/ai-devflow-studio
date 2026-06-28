import { FolderOpen, Moon, RefreshCw, Sun } from 'lucide-react'
import type * as React from 'react'
import type {
  LocalProject,
  ThemePreference,
  ProjectGitStatus,
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
  teamProjectLabel,
  teamProjectSource,
  gitStatus,
  isRefreshingGitStatus,
  onRefreshGitStatus,
  onSelectProject,
  desktopConnected,
}: {
  project: LocalProject | undefined
  teamProjectLabel: string
  teamProjectSource: string
  gitStatus: ProjectGitStatus | null
  isRefreshingGitStatus: boolean
  onRefreshGitStatus: () => void
  onSelectProject: () => void
  desktopConnected: boolean
}) {
  const branchLabel = getBranchLabel(project, gitStatus)

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
          {!project ? <span className="pill warn">not selected</span> : null}
        </div>
        <p className="meta mono">
          {project?.path ??
            (desktopConnected
              ? '选择本地仓库后，DevFlow 会识别执行边界。'
              : '浏览器预览模式无法打开本地目录。')}
        </p>
        {project ? (
          <>
            <div className="row">
              <span className="meta">Team Project 归属</span>
              {teamProjectSource !== 'not bound' ? <strong>{teamProjectLabel}</strong> : null}
              <span className="pill soft">{teamProjectSource}</span>
            </div>
            <div className="row branch-row">
              <div className="branch-row-head">
                <span className="meta">Branch</span>
                <button
                  aria-label="刷新 Git 分支"
                  className="branch-refresh-button"
                  disabled={isRefreshingGitStatus}
                  onClick={onRefreshGitStatus}
                  type="button"
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              <div className="branch-status">
                <strong className="branch-name mono">{branchLabel}</strong>
              </div>
            </div>
          </>
        ) : null}
        <button className="ghost-button local-project-select" onClick={onSelectProject}>
          <FolderOpen size={16} />
          选择本地仓库
        </button>
      </div>
    </section>
  )
}

function getBranchLabel(project: LocalProject | undefined, gitStatus: ProjectGitStatus | null): string {
  if (!project) {
    return 'not selected'
  }
  if (!gitStatus || gitStatus.projectId !== project.id) {
    return 'loading'
  }

  if (gitStatus.status === 'branch') {
    return gitStatus.branch
  }
  if (gitStatus.status === 'detached') {
    return `detached · ${gitStatus.shortSha}`
  }
  if (gitStatus.status === 'not_git') {
    return 'not a git repo'
  }
  return 'unavailable'
}
