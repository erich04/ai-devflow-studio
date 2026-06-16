import { Activity, CircleDollarSign, GitPullRequest, Users } from 'lucide-react'
import { formatUsd } from '@ai-devflow/shared'
import { fetchTeamOverview, type TeamOverviewResponse } from './lib/devflow-api'

export default async function Page() {
  let overview: TeamOverviewResponse

  try {
    overview = await fetchTeamOverview()
  } catch (error) {
    return (
      <WebShell>
        <section className="web-panel web-panel--wide">
          <div className="panel-title">
            <span>Team Overview</span>
            <strong>团队数据暂时不可用</strong>
          </div>
          <p>{error instanceof Error ? error.message : '无法连接 DevFlow API'}</p>
        </section>
      </WebShell>
    )
  }

  const hasProjects = overview.projects.length > 0
  const hasMembers = overview.members.length > 0
  const hasProjectCost = overview.projectCost.length > 0

  return (
    <WebShell>
      <section className="web-main" id="overview">
        <header className="web-header">
          <div>
            <span>Team Overview</span>
            <h1>项目交付健康</h1>
          </div>
          <button>跟随系统</button>
        </header>

        <div className="kpis">
          <Kpi icon={<Activity />} label="Active Runs" value={String(overview.runs.length)} />
          <Kpi icon={<GitPullRequest />} label="Pending PR" value="1" />
          <Kpi icon={<Users />} label="Members" value={String(overview.members.length)} />
          <Kpi icon={<CircleDollarSign />} label="Cost" value={overview.totalCost} />
        </div>

        <section className="web-grid">
          <div className="web-panel" id="projects">
            <div className="panel-title">
              <span>Projects</span>
              <strong>交付状态</strong>
            </div>
            {hasProjects ? (
              overview.projects.map((project) => (
                <article className="project-row" key={project.id}>
                  <div>
                    <strong>{project.name}</strong>
                    <p>{project.repository}</p>
                  </div>
                  <span>{project.health}</span>
                </article>
              ))
            ) : (
              <EmptyState title="还没有团队项目" body="等待 API 同步团队项目后显示交付健康。" />
            )}
          </div>

          <div className="web-panel" id="members">
            <div className="panel-title">
              <span>Members</span>
              <strong>成员负载</strong>
            </div>
            {hasMembers ? (
              overview.members.map((member) => (
                <article className="member-row" key={member.id}>
                  <div>{member.avatarInitials}</div>
                  <strong>{member.name}</strong>
                  <span>{member.role}</span>
                </article>
              ))
            ) : (
              <EmptyState title="暂无成员数据" body="等待 API 同步成员与角色边界。" />
            )}
          </div>

          <div className="web-panel web-panel--wide" id="cost">
            <div className="panel-title">
              <span>Token Cost</span>
              <strong>项目成本</strong>
            </div>
            {hasProjectCost ? (
              overview.projectCost.map((rollup) => (
                <article className="cost-row" key={rollup.key}>
                  <span>{rollup.key}</span>
                  <progress value={rollup.costUsd} max={0.2} />
                  <strong>{formatUsd(rollup.costUsd)}</strong>
                </article>
              ))
            ) : (
              <EmptyState title="暂无成本数据" body="同步 Token usage 后会显示项目成本。" />
            )}
          </div>
        </section>
      </section>
    </WebShell>
  )
}

function WebShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="web-shell">
      <aside className="web-sidebar">
        <strong>AI DevFlow</strong>
        <span>Team Console</span>
        <nav>
          <a href="#overview">Overview</a>
          <a href="#projects">Projects</a>
          <a href="#members">Members</a>
          <a href="#cost">Token Cost</a>
        </nav>
      </aside>

      {children}
    </main>
  )
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="kpi">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}
