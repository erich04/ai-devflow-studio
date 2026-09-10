import { formatUsd, type Project } from '@ai-devflow/shared'
import type { BrowserAuthSessionResponse, TeamOverviewResponse } from './lib/devflow-api'
import { RuntimeBudgetPanel } from './RuntimeBudgetPanel'
import { createRuntimeBudgetApprovalAction, saveRuntimeBudgetPolicyAction } from './runtime-budget-actions'
import { TeamPolicyEditor } from './TeamPolicyEditor'
import { readTeamPolicyAction, saveTeamPolicyAction } from './team-policy-actions'
import { studioHref } from './studio-navigation'

export function StudioManagement({ overview, session, project, view, section }: {
  overview: TeamOverviewResponse
  session: BrowserAuthSessionResponse | null
  project: Project | undefined
  view: 'team' | 'settings'
  section: 'budget' | 'policy'
}) {
  if (view === 'team') return <section className="studio-management" aria-label="团队总览">
    <div className="studio-management-grid">
      <section className="studio-management-panel"><h2>团队成员</h2>
        {overview.members.length ? overview.members.map((member) => <article className="studio-management-row" key={member.id}><strong>{member.name}</strong><span>{member.role}</span></article>) : <p>暂无成员数据。</p>}
      </section>
      <section className="studio-management-panel"><h2>项目费用</h2><p>团队合计：{overview.totalCost}</p>
        {overview.projectCost.length ? overview.projectCost.map((cost) => <article className="studio-management-row" key={cost.key}><a href={studioHref(cost.key)}>{overview.projects.find((candidate) => candidate.id === cost.key)?.name ?? cost.key}</a><span>{formatUsd(cost.costUsd)}{cost.unknownCostCount ? ` + ${cost.unknownCostCount} 项金额待确认` : ''}</span></article>) : <p>暂无模型用量，同步后显示项目费用。</p>}
      </section>
      <section className="studio-management-panel"><h2>最近 Run</h2>
        {overview.runs.length ? overview.runs.slice(0, 20).map((run) => <article className="studio-management-row" key={run.id}><a href={`${studioHref(run.projectId)}&runId=${encodeURIComponent(run.id)}`}>{run.title}</a><span>{run.status}</span></article>) : <p>暂无同步 Run。在工作台创建需求，Desktop 承接后同步进度。</p>}
      </section>
      <section className="studio-management-panel"><h2>最近测试证据</h2>
        {overview.testEvidenceSummaries.length ? overview.testEvidenceSummaries.slice(0, 10).map((evidence) => <article className="studio-management-row" key={evidence.id}><div><a href={`${studioHref(evidence.projectId)}&runId=${encodeURIComponent(evidence.runId)}#tests`}>{evidence.summary}</a><p>{evidence.command}</p></div><span>{evidence.status}</span></article>) : <p>暂无测试证据。</p>}
      </section>
    </div>
  </section>

  return <section className="studio-management" aria-label="团队设置">
    <nav className="studio-settings-tabs" aria-label="设置分类">
      <a href={studioHref(project?.id, 'settings', 'budget')} aria-current={section === 'budget' ? 'page' : undefined}>预算</a>
      <a href={studioHref(project?.id, 'settings', 'policy')} aria-current={section === 'policy' ? 'page' : undefined}>Policy</a>
    </nav>
    {section === 'policy' ? <section className="studio-management-panel" id="team-policy">
      <h2>Team Policy</h2>
      <TeamPolicyEditor key={overview.enforcementPolicies.organizationPolicy.organizationId}
        initialPolicy={overview.enforcementPolicies.organizationPolicy}
        initialSource={overview.enforcementPolicies.organizationPolicySource}
        effectivePolicy={overview.enforcementPolicies.effectivePolicies.find((policy) => policy.projectId === project?.id)}
        canEdit={session?.user.role === 'owner'} readAction={readTeamPolicyAction} saveAction={saveTeamPolicyAction} />
    </section> : <section className="studio-management-panel" id="runtime-budget"><h2>项目预算 · {project?.name ?? '未选择项目'}</h2>
      {project ? <RuntimeBudgetPanel key={project.id}
        projectId={project.id}
        initialPolicy={overview.runtimeBudgetPolicies.find((policy) => policy.projectId === project.id) ?? null}
        approvals={overview.runtimeBudgetApprovals.filter((approval) => approval.projectId === project.id)}
        spendUsd={overview.projectCost.find((cost) => cost.key === project.id)?.costUsd ?? 0}
        providers={overview.agentProviders} sessionUser={session?.user ?? null}
        savePolicyAction={saveRuntimeBudgetPolicyAction} createApprovalAction={createRuntimeBudgetApprovalAction} /> : <p>所选项目不可用，请先创建或选择有权限访问的项目。</p>}
    </section>}
  </section>
}
