import { ChevronDown, RefreshCw } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { DetailPopover } from '../components/DetailPopover'
import type { TeamConnectionView } from '../app/team-connection-view-model'

/** Top bar project menu: project name up front, full local path only on hover and inside (plan L1). */
export function TopbarProjectMenu({ projectName, projectPath, children }: {
  projectName: string | undefined
  projectPath: string | undefined
  children: ReactNode
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  // The panel overlays the navigation, so it closes on an outside click or Escape like other popovers.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menu.current?.open) return
      menu.current.open = false
      menu.current.querySelector<HTMLElement>(':scope > summary')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  return (
    <details className="topbar-project-menu" ref={menu}>
      <summary title={projectPath ?? '尚未选择本地项目'} aria-label={`项目：${projectName ?? '尚未选择'}`}>
        <span>{projectName ?? '选择本地项目'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="topbar-project-panel">{children}</div>
    </details>
  )
}

/**
 * Top bar team connection popover (plan Y7): three summary lines, 「更新团队数据」 and one way
 * into 设置／团队连接, where pairing, connection details and per-record uploads live.
 */
export function TeamConnectionMenu({
  view,
  identity,
  isSyncing,
  onUpdateTeamData,
  onOpenDetails,
}: {
  view: TeamConnectionView
  identity: string
  isSyncing: boolean
  onUpdateTeamData: () => void
  onOpenDetails: () => void
}) {
  return (
    <DetailPopover
      className={`team-connection-trigger team-connection-trigger--${view.tone}`}
      title="团队连接"
      triggerLabel={`团队连接：${view.summary}`}
      label={<>
        <span className={`team-connection-dot team-connection-dot--${view.tone}`} aria-hidden="true" />
        <span className="team-connection-summary">{view.summary}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </>}
    >
      {(close) => <>
      <section className="team-connection-section" aria-label="团队连接状态">
        <h3>连接状态</h3>
        <p>{view.connectionLine}</p>
        {identity ? <p className="meta" data-testid="desktop-pairing-identity">当前身份：{identity}</p> : null}
      </section>
      <section className="team-connection-section" aria-label="团队数据更新">
        <h3>团队数据</h3>
        <p>{view.dataLine}</p>
        {/* Only offered when it can succeed; otherwise the line above says what comes first (plan §4.3). */}
        {view.connection === 'connected' ? (
          <>
            <button type="button" className="ghost-button" onClick={onUpdateTeamData} disabled={isSyncing}>
              <RefreshCw size={16} aria-hidden="true" />
              {isSyncing ? '更新中' : '更新团队数据'}
            </button>
            <p className="meta">读取有权访问的项目、成员与任务摘要，并刷新本机策略和预算；不拉取或推送代码，也不上传本地结果。</p>
          </>
        ) : null}
      </section>
      <section className="team-connection-section" aria-label="结果上传">
        <h3>结果上传</h3>
        <p>{view.uploadLine}</p>
      </section>
      <button type="button" className="text-button team-connection-details-link" onClick={() => { close(); onOpenDetails() }}>{view.detailsActionLabel}</button>
      </>}
    </DetailPopover>
  )
}
