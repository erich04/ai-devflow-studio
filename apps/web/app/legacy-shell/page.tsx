import { Activity, Bot, CircleDollarSign, GitPullRequest, Users } from 'lucide-react'
import { cookies } from 'next/headers'
import {
  createRecommendedEnforcementPreset,
  formatUsd,
  resolveDevFlowRuntimeFlags,
} from '@ai-devflow/shared'
import {
  createTeamProject,
  DevFlowApiError,
  fetchAuthSession,
  fetchTeamOverview,
  resolveDevFlowApiBaseUrl,
  resolveDevFlowPublicApiBaseUrl,
  runKnowledgeReview,
  saveEnforcementPolicy,
  type TeamOverviewResponse,
  type BrowserAuthSessionResponse,
} from '../lib/devflow-api'
import { PairingCodePanel } from '../PairingCodePanel'
import { RuntimeBudgetPanel } from './RuntimeBudgetPanel'
import {
  createRuntimeBudgetApprovalAction,
  saveRuntimeBudgetPolicyAction,
} from './runtime-budget-actions'

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

async function runKnowledgeReviewAction(formData: FormData) {
  'use server'

  const runId = String(formData.get('runId') ?? '')
  const nodeId = String(formData.get('nodeId') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const providerId = String(formData.get('providerId') ?? '').trim()

  if (!runId || !nodeId || !projectId) {
    return
  }

  const cookieHeader = await getDevFlowCookieHeader()
  await runKnowledgeReview({
    runId,
    nodeId,
    projectId,
    providerId,
    ...(cookieHeader ? { cookieHeader } : {}),
  })
}

async function applyRecommendedPolicyAction(formData: FormData) {
  'use server'

  const organizationId = String(formData.get('organizationId') ?? '').trim()
  if (!organizationId) return

  const cookieHeader = await getDevFlowCookieHeader()
  await saveEnforcementPolicy({
    policy: createRecommendedEnforcementPreset({
      organizationId,
      updatedAt: new Date().toISOString(),
    }),
    ...(cookieHeader ? { cookieHeader } : {}),
  })
}

async function createProjectAction(formData: FormData) {
  'use server'

  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const repository = String(formData.get('repository') ?? '').trim()

  if (!name || !slug || !description || !repository) {
    return
  }

  const cookieHeader = await getDevFlowCookieHeader()
  await createTeamProject({
    name,
    slug,
    description,
    repository,
    ...(cookieHeader ? { cookieHeader } : {}),
  })
}

export default async function Page() {
  let overview: TeamOverviewResponse
  const apiBaseUrl = resolveDevFlowPublicApiBaseUrl()
  const cookieHeader = await getDevFlowCookieHeader()
  const localAuthEnabled = resolveDevFlowRuntimeFlags({
    DEVFLOW_LOCAL_AUTH_ENABLED: process.env.DEVFLOW_LOCAL_AUTH_ENABLED,
  }).localDevelopmentAuthEnabled

  try {
    overview = await fetchTeamOverview({
      ...(cookieHeader ? { cookieHeader } : {}),
    })
  } catch (error) {
    const authenticationRequired =
      error instanceof DevFlowApiError && error.status === 401
    return (
      <WebShell>
        <section className="web-panel web-panel--wide">
          <div className="panel-title">
            <span>Team Overview</span>
            <strong>{authenticationRequired ? '需要登录' : '团队数据暂时不可用'}</strong>
          </div>
          <p>
            {authenticationRequired
              ? '请先建立浏览器身份，再进入团队控制台。'
              : '无法连接 DevFlow API，请确认本地服务与数据库已经启动。'}
          </p>
          {authenticationRequired && localAuthEnabled ? (
            <form action={`${apiBaseUrl}/api/auth/local/start`} method="post">
              <button type="submit">使用本地开发身份</button>
            </form>
          ) : null}
          {authenticationRequired ? (
            <a className="button-link" href={`${apiBaseUrl}/api/auth/github/start`}>
              Sign in with GitHub
            </a>
          ) : null}
        </section>
      </WebShell>
    )
  }

  let browserSession: BrowserAuthSessionResponse | null = null
  if (cookieHeader) {
    try {
      browserSession = await fetchAuthSession({ cookieHeader })
    } catch {
      browserSession = null
    }
  }

  const hasProjects = overview.projects.length > 0
  const hasMembers = overview.members.length > 0
  const hasProjectCost = overview.projectCost.length > 0
  const hasRuns = overview.runs.length > 0
  const hasEvidence = overview.testEvidenceSummaries.length > 0
  const hasAgentReviews = overview.agentReviews.length > 0
  const hasPolicyAwareDelivery = overview.policyAwareDeliverySummaries.length > 0
  const reviewTarget = overview.runs
    .map((run) => ({ run, node: run.nodes.find((node) => node.kind === 'gate') ?? run.nodes[0] }))
    .find((target) => target.node)
  const knowledgeReviewProviderId = overview.agentProviders[0]?.id ?? ''
  const latestReview = overview.agentReviews[0]
  const latestUsage = overview.agentTokenUsage[0]
  const organizationPolicy = overview.enforcementPolicies.organizationPolicy
  const blockingRuleCount = organizationPolicy.rules.filter((rule) => rule.defaultAction === 'block').length
  const clampedRuleCount = overview.enforcementPolicies.effectivePolicies.reduce(
    (sum, policy) => sum + policy.rules.filter((rule) => rule.source === 'project_clamped').length,
    0,
  )
  const selectedBudgetProject = overview.projects[0]
  const selectedBudgetPolicy = selectedBudgetProject
    ? overview.runtimeBudgetPolicies.find((policy) => policy.projectId === selectedBudgetProject.id)
    : undefined
  const selectedBudgetApprovals = selectedBudgetProject
    ? overview.runtimeBudgetApprovals.filter((approval) => approval.projectId === selectedBudgetProject.id)
    : []
  const selectedBudgetSpend = selectedBudgetProject
    ? overview.projectCost.find((rollup) => rollup.key === selectedBudgetProject.id)?.costUsd ?? 0
    : 0

  return (
    <WebShell>
      <section className="web-main" id="overview">
        <header className="web-header">
          <div>
            <span>Team Overview</span>
            <h1>项目交付健康</h1>
          </div>
          <div className="web-header-actions">
            <BrowserSessionControls
              apiBaseUrl={apiBaseUrl}
              hasSessionCookie={Boolean(cookieHeader)}
              session={browserSession}
            />
            <button>跟随系统</button>
          </div>
        </header>

        <div className="kpis">
          <Kpi icon={<Activity />} label="Active Runs" value={String(overview.runs.length)} />
          <Kpi icon={<GitPullRequest />} label="Pending PR" value="1" />
          <Kpi icon={<Users />} label="Members" value={String(overview.members.length)} />
          <Kpi icon={<CircleDollarSign />} label="Cost" value={overview.totalCost} />
          <Kpi icon={<Bot />} label="门禁审查" value={String(overview.agentReviews.length)} />
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
                    <PairingCodePanel
                      projectId={project.id}
                      projectName={project.name}
                      subject={(() => {
                        const membership = browserSession?.projectMemberships?.find(
                          (candidate) => candidate.projectId === project.id,
                        )
                        return browserSession && membership
                          ? {
                              userId: browserSession.user.id,
                              userName: browserSession.user.name,
                              role: membership.role,
                            }
                          : null
                      })()}
                    />
                  </div>
                  <span>{project.health}</span>
                </article>
              ))
            ) : (
              <EmptyState title="还没有团队项目" body="等待 API 同步团队项目后显示交付健康。" />
            )}
            <form className="project-create-form" action={createProjectAction}>
              <label>
                Name
                <input name="name" placeholder="Agent Platform" required />
              </label>
              <label>
                Slug
                <input name="slug" placeholder="agent-platform" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required />
              </label>
              <label>
                Repository
                <input name="repository" placeholder="erich/agent-platform" required />
              </label>
              <label>
                Description
                <textarea name="description" placeholder="Pilot project for team delivery." required />
              </label>
              <button type="submit">Create project</button>
            </form>
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
                  <strong>{formatUsd(rollup.costUsd)}{rollup.unknownCostCount ? ` + ${rollup.unknownCostCount} unknown` : ''}</strong>
                </article>
              ))
            ) : (
              <EmptyState title="暂无成本数据" body="同步 Token usage 后会显示项目成本。" />
            )}
          </div>

          <div className="web-panel web-panel--wide" id="runtime-budget">
            <div className="panel-title">
              <span>Runtime Budget</span>
              <strong>{selectedBudgetProject?.name ?? 'no project selected'}</strong>
            </div>
            {selectedBudgetProject ? (
              <RuntimeBudgetPanel
                approvals={selectedBudgetApprovals}
                createApprovalAction={createRuntimeBudgetApprovalAction}
                initialPolicy={selectedBudgetPolicy ?? null}
                projectId={selectedBudgetProject.id}
                providers={overview.agentProviders}
                savePolicyAction={saveRuntimeBudgetPolicyAction}
                sessionUser={browserSession?.user ?? null}
                spendUsd={selectedBudgetSpend}
              />
            ) : (
              <EmptyState title="暂无项目预算" body="创建团队项目后可配置真实 runtime 预算。" />
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

          <div className="web-panel web-panel--wide" id="policy">
            <div className="panel-title">
              <span>Gate Enforcement Policy</span>
              <strong>{organizationPolicy.name}</strong>
            </div>
            <div className="agent-console">
              <article className="agent-review-row">
                <div>
                  <strong>{blockingRuleCount > 0 ? 'Recommended enforcement active' : 'Warn-only default'}</strong>
                  <p>
                    {blockingRuleCount > 0
                      ? `${blockingRuleCount} deterministic rules can block protected Gate approval.`
                      : 'No rules block approval until the team explicitly applies enforcement.'}
                  </p>
                </div>
                <span>v{organizationPolicy.version}</span>
              </article>
              <article className="agent-review-row">
                <div>
                  <strong>Policy floor</strong>
                  <p>{clampedRuleCount} project choices currently clamped by organization floor.</p>
                </div>
                <span>{organizationPolicy.updatedAt}</span>
              </article>
              <form action={applyRecommendedPolicyAction}>
                <input type="hidden" name="organizationId" value={organizationPolicy.organizationId} />
                <button type="submit">
                  <GitPullRequest size={16} />
                  Apply recommended enforcement
                </button>
              </form>
            </div>
          </div>

          <div className="web-panel web-panel--wide" id="policy-delivery">
            <div className="panel-title">
              <span>Policy-Aware Delivery</span>
              <strong>remediation summary</strong>
            </div>
            {hasPolicyAwareDelivery ? (
              <div className="agent-console">
                {overview.policyAwareDeliverySummaries.map((summary) => {
                  const project = overview.projects.find((item) => item.id === summary.projectId)
                  return (
                    <article className="agent-review-row" key={summary.projectId}>
                      <div>
                        <strong>{project?.name ?? summary.projectId}</strong>
                        <p>
                          {summary.warningCount} warnings · {summary.blockedCount} blocking signals ·{' '}
                          {summary.overrideCount} overrides
                        </p>
                      </div>
                      <span>{summary.retryAttemptCount} retry attempts</span>
                    </article>
                  )
                })}
              </div>
            ) : (
              <EmptyState title="暂无策略交付摘要" body="同步门禁审查、override 或 Coding retry 后会显示 remediation 汇总。" />
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
              <span>基于知识的门禁审查</span>
              <strong>Knowledge-Grounded Gate Review</strong>
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
                <input type="hidden" name="providerId" value={knowledgeReviewProviderId} />
                <button type="submit" disabled={!reviewTarget}>
                  <Bot size={16} />
                  运行门禁审查
                </button>
              </form>
              <div>
                <strong>最新 Gate Advisory</strong>
                {latestReview ? (
                  <article className="agent-review-row">
                    <span>{latestReview.gateAdvisory.level}</span>
                    <p>{latestReview.gateAdvisory.summary}</p>
                    <small>{latestReview.gateAdvisory.blocksApproval ? 'blocking' : 'warning-only'}</small>
                  </article>
                ) : (
                  <EmptyState
                    title="尚未运行门禁审查"
                    body="系统会以 Knowledge 与规范为依据，审查当前 Gate 条件和阶段产物，并显示 advisory、trace 与成本。"
                  />
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

function BrowserSessionControls({
  apiBaseUrl,
  hasSessionCookie,
  session,
}: {
  apiBaseUrl: string
  hasSessionCookie: boolean
  session: BrowserAuthSessionResponse | null
}) {
  if (!hasSessionCookie) {
    return (
      <a className="button-link" href={`${apiBaseUrl}/api/auth/github/start`}>
        Sign in with GitHub
      </a>
    )
  }

  const label = session
    ? session.authentication.provider === 'local-development'
      ? '本地开发身份 · 仅本机'
      : `${session.user.name} · GitHub`
    : '会话信息暂时不可用'
  return (
    <>
      <span className="button-link">{label}</span>
      <form action="/api/auth/logout" method="post">
        <button type="submit">退出登录</button>
      </form>
    </>
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
          <a href="#runtime-budget">Budget</a>
          <a href="#runs">Runs</a>
          <a href="#policy">Policy</a>
          <a href="#policy-delivery">Delivery</a>
          <a href="#evidence">Evidence</a>
          <a href="#agent-review">门禁审查</a>
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
