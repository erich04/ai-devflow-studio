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
  compact = false,
}: {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
  /** Icon-only in the one-row top bar (plan L1); the label stays available to assistive tech. */
  compact?: boolean
}) {
  const next = value === 'system' ? 'light' : value === 'light' ? 'dark' : 'system'
  const label = value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'

  return (
    <button
      className={`theme-toggle ${compact ? 'theme-toggle--compact' : ''}`}
      onClick={() => onChange(next)}
      aria-label={`Toggle color theme · ${label}`}
      title={`主题：${label}`}
      data-testid="theme-toggle"
    >
      {value === 'dark' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
      {compact ? <span className="sr-only">{label}</span> : label}
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
  teamProjectSource: 'unbound' | 'bound_unsynced' | 'bound_synced'
  gitStatus: ProjectGitStatus | null
  isRefreshingGitStatus: boolean
  onRefreshGitStatus: () => void
  onSelectProject: () => void
  desktopConnected: boolean
}) {
  const branchLabel = getBranchLabel(project, gitStatus)
  // Same wording as the team connection summary: connection and team data are separate facts (plan T4, X3).
  const teamProjectSourceLabel = {
    unbound: '未连接团队',
    bound_unsynced: '已连接 · 团队数据未读取',
    bound_synced: '已连接 · 团队数据已读取',
  }[teamProjectSource]

  return (
    <section className="local-project-panel" aria-label="Local project">
      <div className="panel-head panel-head--compact">
        <span className="panel-title">项目与运行</span>
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
              <span className="meta">Team Project</span>
              {teamProjectSource !== 'unbound' ? <strong>{teamProjectLabel}</strong> : null}
              <span className={`pill ${teamProjectSource === 'unbound' ? 'soft' : 'accent'}`}>
                {teamProjectSourceLabel}
              </span>
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
