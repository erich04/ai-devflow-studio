import { Activity, Bot, CircleDollarSign, GitPullRequest, Users } from 'lucide-react'
import { formatUsd } from '@ai-devflow/shared'
import {
  fetchTeamOverview,
  runKnowledgeReview,
  type TeamOverviewResponse,
} from './lib/devflow-api'

async function runKnowledgeReviewAction(formData: FormData) {
  'use server'

  const runId = String(formData.get('runId') ?? '')
  const nodeId = String(formData.get('nodeId') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const providerId = String(formData.get('providerId') ?? 'fake-knowledge-review')

  if (!runId || !nodeId || !projectId) {
    return
  }

  await runKnowledgeReview({ runId, nodeId, projectId, providerId })
}

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
  const hasRuns = overview.runs.length > 0
  const hasEvidence = overview.testEvidenceSummaries.length > 0
  const hasAgentReviews = overview.agentReviews.length > 0
  const reviewTarget = overview.runs
    .map((run) => ({ run, node: run.nodes.find((node) => node.kind === 'gate') ?? run.nodes[0] }))
    .find((target) => target.node)
  const latestReview = overview.agentReviews[0]
  const latestUsage = overview.agentTokenUsage[0]

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
          <Kpi icon={<Bot />} label="Agent Reviews" value={String(overview.agentReviews.length)} />
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

          <div className="web-panel" id="runs">
            <div className="panel-title">
              <span>Recent Runs</span>
              <strong>团队同步</strong>
            </div>
            {hasRuns ? (
              overview.runs.slice(0, 5).map((run) => (
                <article className="run-row" key={run.id}>
                  <div>
                    <strong>{run.title}</strong>
                    <p>{run.branchName}</p>
                  </div>
                  <span>{run.status}</span>
                </article>
              ))
            ) : (
              <EmptyState title="暂无同步 Run" body="Electron 同步 Run 后会显示团队级状态。" />
            )}
          </div>

          <div className="web-panel" id="evidence">
            <div className="panel-title">
              <span>Test Evidence</span>
              <strong>测试证据</strong>
            </div>
            {hasEvidence ? (
              overview.testEvidenceSummaries.slice(0, 5).map((evidence) => (
                <article className="evidence-row" key={evidence.id}>
                  <div>
                    <strong>{evidence.summary}</strong>
                    <p>{evidence.command}</p>
                  </div>
                  <span>{evidence.status}</span>
                </article>
              ))
            ) : (
              <EmptyState title="暂无测试证据" body="Electron 上传脱敏测试摘要后会显示在这里。" />
            )}
          </div>

          <div className="web-panel web-panel--wide" id="agent-review">
            <div className="panel-title">
              <span>Knowledge Review Agent</span>
              <strong>后端 Agent 审查</strong>
            </div>
            <div className="agent-console">
              <div>
                <strong>Provider</strong>
                {overview.agentProviders.map((provider) => (
                  <article className="agent-provider-row" key={provider.id}>
                    <span>{provider.name}</span>
                    <code>{provider.maskedCredential ?? provider.model}</code>
                  </article>
                ))}
              </div>
              <form action={runKnowledgeReviewAction}>
                <input type="hidden" name="runId" value={reviewTarget?.run.id ?? ''} />
                <input type="hidden" name="nodeId" value={reviewTarget?.node?.id ?? ''} />
                <input type="hidden" name="projectId" value={reviewTarget?.run.projectId ?? ''} />
                <input type="hidden" name="providerId" value="fake-knowledge-review" />
                <button type="submit" disabled={!reviewTarget}>
                  <Bot size={16} />
                  Run backend review
                </button>
              </form>
              <div>
                <strong>Latest advisory</strong>
                {latestReview ? (
                  <article className="agent-review-row">
                    <span>{latestReview.gateAdvisory.level}</span>
                    <p>{latestReview.gateAdvisory.summary}</p>
                    <small>{latestReview.gateAdvisory.blocksApproval ? 'blocking' : 'warning-only'}</small>
                  </article>
                ) : (
                  <EmptyState title="暂无 Agent Review" body="触发后端审查后会显示 advisory、trace 与成本。" />
                )}
              </div>
            </div>
            {hasAgentReviews ? (
              overview.agentReviews.slice(0, 5).map((review) => (
                <article className="agent-review-row" key={review.id}>
                  <div>
                    <strong>{review.conclusion}</strong>
                    <p>{review.summary}</p>
                  </div>
                  <span>{review.runtime}</span>
                </article>
              ))
            ) : null}
            <div className="agent-cost-row">
              <span>Latest review cost</span>
              <strong>{latestUsage ? formatUsd(latestUsage.costUsd) : '$0.000'}</strong>
              <span>{latestUsage?.source ?? 'none'}</span>
            </div>
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
          <a href="#runs">Runs</a>
          <a href="#evidence">Evidence</a>
          <a href="#agent-review">Agent Review</a>
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
