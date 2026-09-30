import type { ReactNode } from 'react'
import { formatCostRollup, type Project } from '@ai-devflow/shared'
import type { BrowserAuthSessionResponse, TeamOverviewResponse } from './lib/devflow-api'
import { RuntimeBudgetPanel } from './RuntimeBudgetPanel'
import { createRuntimeBudgetApprovalAction, saveRuntimeBudgetPolicyAction } from './runtime-budget-actions'
import { TeamPolicyEditor } from './TeamPolicyEditor'
import { readTeamPolicyAction, saveTeamPolicyAction } from './team-policy-actions'
import { studioHref, studioSettingsSections, taskHref, type StudioSettingsSection } from './studio-navigation'
import { roleLabel, runStatusLabel } from './web-labels'

/**
 * 团队 and 设置 (plan S5, Q6). Settings hold everything that is management rather than work:
 * budget, policy, desktop pairing and the GitHub repository binding.
 */
export function StudioManagement({ overview, session, project, view, section, desktopConnection, githubRepository }: {
  overview: TeamOverviewResponse
  session: BrowserAuthSessionResponse | null
  project: Project | undefined
  view: 'team' | 'settings'
  section: StudioSettingsSection
  desktopConnection?: ReactNode
  githubRepository?: ReactNode
}) {
  if (view === 'team') return <section className="studio-management" aria-label="团队">
    <div className="studio-management-grid">
      <section className="studio-management-panel"><h2>团队成员</h2>
        {overview.members.length ? overview.members.map((member) => <article className="studio-management-row" key={member.id}><strong>{member.name}</strong><span>{roleLabel(member.role)}</span></article>) : <p>暂无成员数据。</p>}
      </section>
      <section className="studio-management-panel"><h2>项目费用</h2><p>团队合计：{overview.totalCost}</p>
        {overview.projectCost.length ? overview.projectCost.map((cost) => <article className="studio-management-row" key={cost.key}><a href={studioHref(cost.key)}>{overview.projects.find((candidate) => candidate.id === cost.key)?.name ?? cost.key}</a><span>{formatCostRollup([cost])}</span></article>) : <p>暂无模型用量，桌面端上传后显示项目费用。</p>}
      </section>
      <section className="studio-management-panel"><h2>最近的任务</h2>
        {overview.runs.length ? overview.runs.slice(0, 20).map((run) => <article className="studio-management-row" key={run.id}><a href={taskHref(run.projectId, run.id)}>{run.title}</a><span>{runStatusLabel(run.status)}</span></article>) : <p>暂无任务。在项目任务中新建请求，桌面端领取后会上传进度。</p>}
      </section>
      <section className="studio-management-panel"><h2>最近的测试证据</h2>
        {overview.testEvidenceSummaries.length ? overview.testEvidenceSummaries.slice(0, 10).map((evidence) => <article className="studio-management-row" key={evidence.id}><div><a href={taskHref(evidence.projectId, evidence.runId, 'tests')}>{evidence.summary}</a><p>{evidence.command}</p></div><span>{evidence.status}</span></article>) : <p>暂无测试证据。</p>}
      </section>
    </div>
  </section>

  return <section className="studio-management" aria-label="团队设置">
    <nav className="studio-settings-tabs" aria-label="设置分类">
      {studioSettingsSections.map((candidate) => (
        <a key={candidate.id} href={studioHref(project?.id, 'settings', candidate.id)} aria-current={section === candidate.id ? 'page' : undefined}>{candidate.label}</a>
      ))}
    </nav>
    {section === 'policy' ? <section className="studio-management-panel" id="team-policy">
      <h2>团队策略</h2>
      <TeamPolicyEditor key={overview.enforcementPolicies.organizationPolicy.organizationId}
        initialPolicy={overview.enforcementPolicies.organizationPolicy}
        initialSource={overview.enforcementPolicies.organizationPolicySource}
        effectivePolicy={overview.enforcementPolicies.effectivePolicies.find((policy) => policy.projectId === project?.id)}
        canEdit={session?.user.role === 'owner'} readAction={readTeamPolicyAction} saveAction={saveTeamPolicyAction} />
    </section> : section === 'desktop' ? <section className="studio-management-panel" id="desktop-connection">
      <h2>桌面连接 · {project?.name ?? '未选择项目'}</h2>
      {project ? desktopConnection ?? <p>登录浏览器身份后才能为桌面端生成配对码。</p> : <p>请先选择有权限访问的项目。</p>}
    </section> : section === 'github' ? <section className="studio-management-panel" id="github-repository-settings">
      {project ? githubRepository ?? <p>登录浏览器身份后才能读取仓库绑定。</p> : <><h2>GitHub 仓库</h2><p>请先选择有权限访问的项目。</p></>}
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
