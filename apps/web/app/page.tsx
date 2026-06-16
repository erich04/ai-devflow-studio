import { Activity, CircleDollarSign, GitPullRequest, Users } from 'lucide-react'
import {
  formatUsd,
  members,
  projects,
  rollupTokenUsage,
  runs,
  tokenUsage,
} from '@ai-devflow/shared'

export default function Page() {
  const totalCost = tokenUsage.reduce((sum, row) => sum + row.costUsd, 0)
  const projectCost = rollupTokenUsage(tokenUsage, 'projectId')

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

      <section className="web-main" id="overview">
        <header className="web-header">
          <div>
            <span>Team Overview</span>
            <h1>项目交付健康</h1>
          </div>
          <button>跟随系统</button>
        </header>

        <div className="kpis">
          <Kpi icon={<Activity />} label="Active Runs" value={String(runs.length)} />
          <Kpi icon={<GitPullRequest />} label="Pending PR" value="1" />
          <Kpi icon={<Users />} label="Members" value={String(members.length)} />
          <Kpi icon={<CircleDollarSign />} label="Cost" value={formatUsd(totalCost)} />
        </div>

        <section className="web-grid">
          <div className="web-panel" id="projects">
            <div className="panel-title">
              <span>Projects</span>
              <strong>交付状态</strong>
            </div>
            {projects.map((project) => (
              <article className="project-row" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <p>{project.repository}</p>
                </div>
                <span>{project.health}</span>
              </article>
            ))}
          </div>

          <div className="web-panel" id="members">
            <div className="panel-title">
              <span>Members</span>
              <strong>成员负载</strong>
            </div>
            {members.map((member) => (
              <article className="member-row" key={member.id}>
                <div>{member.avatarInitials}</div>
                <strong>{member.name}</strong>
                <span>{member.role}</span>
              </article>
            ))}
          </div>

          <div className="web-panel web-panel--wide" id="cost">
            <div className="panel-title">
              <span>Token Cost</span>
              <strong>项目成本</strong>
            </div>
            {projectCost.map((rollup) => (
              <article className="cost-row" key={rollup.key}>
                <span>{rollup.key}</span>
                <progress value={rollup.costUsd} max={0.2} />
                <strong>{formatUsd(rollup.costUsd)}</strong>
              </article>
            ))}
          </div>
        </section>
      </section>
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
