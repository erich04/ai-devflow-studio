import {
  formatCostRollup,
  type DataOrigin,
  type GateEnforcementDecision,
  type PolicySnapshot,
  type Project,
  type TeamMember,
  type TokenUsageRollup,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { formatLocalTime, type FieldDataSource } from '../app/desktop-view-model'
import {
  dataOriginLabel,
  describeEnforcementRule,
  enforcementActionLabel,
  enforcementRuleSourceLabel,
  enforcementTargetLabel,
  gateSnapshotStatusLabel,
  policySourceLabel,
  projectHealthLabel,
  runtimeSourceLabel,
  teamRoleLabel,
} from '../app/team-overview-copy'

export function TeamOverview({
  projects,
  members,
  projectRollups,
  memberRollups,
  totalCost,
  dataOrigin,
  runtimeDataSource,
  selectedRun,
  selectedProjectId,
  policySnapshot,
  gateEnforcementDecision,
  isLoadingGateEnforcement,
  onSyncTeam,
  isSyncingTeam,
  syncFeedback,
}: {
  projects: Project[]
  members: TeamMember[]
  projectRollups: TokenUsageRollup[]
  memberRollups: TokenUsageRollup[]
  totalCost: string
  dataOrigin: DataOrigin
  runtimeDataSource: FieldDataSource
  selectedRun: WorkflowRun | undefined
  selectedProjectId?: string | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  onSyncTeam: () => void
  isSyncingTeam: boolean
  syncFeedback: { status: 'success' | 'error'; message: string } | null
}) {
  const memberSummary = members.length > 0
    ? members.map((member) => `${member.name}（${teamRoleLabel(member.role)}）`).join(' · ')
    : '未加载团队成员'
  const projectCostById = new Map(projectRollups.map((rollup) => [rollup.key, rollup]))
  const selectedProject = projects.find((project) => project.id === (selectedProjectId ?? selectedRun?.projectId))
  const selectedProjectLabel = selectedProject?.name ?? '未选择团队项目'
  const memberTokens = memberRollups.reduce((sum, rollup) => sum + rollup.totalTokens, 0)
  const snapshotSource = policySnapshot?.source ?? gateEnforcementDecision?.policySource ?? 'unavailable'
  const snapshotVersion = policySnapshot?.version ?? gateEnforcementDecision?.policyVersion
  const snapshotStatus = isLoadingGateEnforcement
    ? 'loading'
    : gateEnforcementDecision?.status ?? (policySnapshot ? 'loaded' : 'not loaded')
  const snapshotTone =
    snapshotStatus === 'pass' || snapshotStatus === 'overridden'
      ? 'good'
      : snapshotStatus === 'warn'
        ? 'warn'
        : snapshotStatus === 'not loaded' || snapshotStatus === 'loaded'
          ? 'soft'
          : 'bad'
  const snapshotStatusText = gateSnapshotStatusLabel(snapshotStatus, {
    warnings: gateEnforcementDecision?.warningReasons.length ?? 0,
  })
  const firstBlockingReason = gateEnforcementDecision?.blockingReasons[0]
  const blockingReasonText = firstBlockingReason ? describeEnforcementRule(firstBlockingReason).label : undefined

  return (
    <section className="route-page team-page" data-testid="team-overview">
      <div className="panel">
        <div className="panel-head">
            <span className="panel-title">团队概览 · 脱敏交付状况</span>
            <div className="row">
              <span className="pill soft">团队视图只显示脱敏摘要，不显示本地原始日志</span>
              <span
                className={`pill ${runtimeDataSource.tone}`}
                title={`${runtimeDataSource.label} · ${runtimeDataSource.detail}`}
              >
                {runtimeSourceLabel(runtimeDataSource.label)}
              </span>
              <span className="pill accent" title={dataOrigin}>{dataOriginLabel(dataOrigin)}</span>
            </div>
          </div>
        <div className="panel-body">
          <strong className="sr-copy">项目交付健康</strong>
          <table className="table">
            <thead>
              <tr>
                <th>项目</th>
                <th>仓库</th>
                <th>交付状况</th>
                <th>测试命令</th>
                <th>当前或最近任务</th>
                <th>Gate 状态</th>
                <th>Gate 汇总</th>
                <th>成员</th>
                <th>Token 与费用</th>
                <th>数据来源</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <p className="empty-note">尚未加载团队项目。更新团队数据后才会显示远端项目、成员、策略和费用摘要。</p>
                  </td>
                </tr>
              ) : projects.map((project) => {
                const rollup = projectCostById.get(project.id)
                const isSelectedProject = project.id === selectedProject?.id
                const rowSource = isSelectedProject ? snapshotSource : dataOrigin

                return (
                  <tr key={project.id}>
                    <td><strong>{project.name}</strong></td>
                    <td className="mono">{project.repository}</td>
                    <td>
                      <span
                        className={`pill ${project.health === 'on_track' ? 'good' : project.health === 'blocked' ? 'bad' : 'warn'}`}
                        title={project.health}
                      >
                        {projectHealthLabel(project.health)}
                      </span>
                    </td>
                    <td className="mono">{project.testCommand}</td>
                    <td>{isSelectedProject ? selectedRun?.title ?? '暂无任务' : '暂无当前任务'}</td>
                    <td>
                      <span
                        className={`pill ${isSelectedProject ? snapshotTone : 'soft'}`}
                        title={isSelectedProject ? snapshotStatus : 'not loaded'}
                      >
                        {isSelectedProject ? snapshotStatusText : gateSnapshotStatusLabel('not loaded', { warnings: 0 })}
                      </span>
                      {isSelectedProject && blockingReasonText ? <p className="meta">{blockingReasonText}</p> : null}
                    </td>
                    <td>
                      {isSelectedProject
                        ? `${gateEnforcementDecision?.blockingReasons.length ?? 0} 项阻断 · ${gateEnforcementDecision?.warningReasons.length ?? 0} 条建议 · ${gateEnforcementDecision?.requiredActions.length ?? 0} 项待处理`
                        : '无当前 Gate 数据'}
                    </td>
                    <td>{memberSummary}</td>
                    <td>{rollup ? `${rollup.totalTokens.toLocaleString()} · ${formatCostRollup([rollup])}` : `0 · ${totalCost}`}</td>
                    <td>
                      <span className={`pill ${isSelectedProject ? 'accent' : 'soft'}`} title={rowSource}>
                        {isSelectedProject ? policySourceLabel(snapshotSource) : dataOriginLabel(dataOrigin)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="member-roster" aria-label="团队成员">
            {members.length === 0 ? (
              <span className="pill soft">未加载团队成员</span>
            ) : members.map((member) => (
              <span className="pill soft" key={member.id}>{member.name}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="page-grid two policy-layout">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">团队项目策略</span>
            <span className="pill accent">管理员配置</span>
          </div>
          <div className="panel-body stack">
            <div className="policy-callout">
              <div className="row">
                <strong>策略归属：团队项目 · {selectedProjectLabel}</strong>
                <span className="pill warn">不是本地项目配置</span>
              </div>
              <p className="meta">这里定义 Gate 规则、角色权限、预算和必需的证据。任务页只读取策略快照并解释阻断原因，不能在任务中临时修改规则。</p>
            </div>
            {policySnapshot?.effectivePolicy?.rules.length ? (
              <div className="policy-matrix" aria-label="团队策略规则">
                <div className="policy-row header"><span>规则</span><span>检查对象</span><span>处理方式</span><span>来源</span></div>
                {policySnapshot.effectivePolicy.rules.map((rule) => {
                  const description = describeEnforcementRule(rule)
                  return (
                    <div className="policy-row" key={rule.ruleKey} data-testid="team-policy-rule">
                      <strong>{description.label}</strong>
                      <span>{enforcementTargetLabel(rule.target)}</span>
                      <span className={`pill ${rule.action === 'block' ? 'warn' : rule.action === 'warn' ? 'soft' : 'good'}`}>
                        {enforcementActionLabel(rule.action)}
                      </span>
                      <span>{enforcementRuleSourceLabel(rule.source)}</span>
                      <details className="credential-access-details">
                        <summary>详情</summary>
                        <code>{rule.ruleKey}</code>
                        <span className="meta">
                          {[
                            `对象 ${rule.target}`,
                            `处理 ${rule.action}`,
                            `来源 ${rule.source}`,
                            ...(rule.floorAction ? [`最低处理 ${rule.floorAction}`] : []),
                            ...(typeof rule.overridable === 'boolean' ? [rule.overridable ? '可申请例外' : '不可例外'] : []),
                            ...(snapshotVersion ? [`适用策略 v${snapshotVersion}`] : []),
                          ].join(' · ')}
                        </span>
                        {!description.recognized ? <span className="meta">无法识别这条规则，按原始规则键核实。</span> : null}
                        {rule.remediation ? <span className="meta">处理方法：{rule.remediation}</span> : null}
                      </details>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="empty-note">尚未加载团队策略规则。</p>
            )}
            <div className="mini-card">
              <p className="section-title">预算检查</p>
              <div className="row">
                <strong>{policySnapshot ? '远端预算策略已加载' : '预算策略未加载'}</strong>
                <span className={`pill ${policySnapshot ? 'good' : 'soft'}`} title={policySnapshot ? snapshotSource : 'not loaded'}>
                  {policySnapshot ? policySourceLabel(snapshotSource) : '尚未加载'}
                </span>
              </div>
              <p className="meta">没有团队策略快照时，任务页不显示预算结论。</p>
            </div>
            <button className="primary-button">保存团队策略草稿</button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">策略快照 · 本机读取</span>
            <span className={`pill ${snapshotTone}`} title={snapshotStatus}>{snapshotStatusText}</span>
          </div>
          <div className="panel-body stack">
            <div className="policy-source-grid">
              <div className="policy-source-row" data-testid="team-policy-source">
                <strong>来源</strong>
                <span>
                  {policySnapshot
                    ? `${policySourceLabel(snapshotSource)} · 策略 v${snapshotVersion} · 同步于 ${formatLocalTime(policySnapshot.syncedAt)}`
                    : '尚未加载策略快照；读取前 Gate 保持只读阻断。'}
                </span>
                <span className={`pill ${snapshotTone}`} title={snapshotStatus}>{snapshotStatusText}</span>
                <details className="credential-access-details">
                  <summary>详情</summary>
                  <code>
                    {policySnapshot
                      ? `${snapshotSource} snapshot v${snapshotVersion} · synced ${policySnapshot.syncedAt}`
                      : `来源 ${snapshotSource}`}
                  </code>
                  <span className="meta">评估状态 {snapshotStatus}</span>
                </details>
              </div>
              <div className="policy-source-row">
                <strong>当前任务</strong>
                <span>{selectedRun?.title ?? '尚未选择任务'} · {selectedProject?.name ?? '未绑定团队项目'}</span>
                <span className="pill soft">{snapshotVersion ? `策略 v${snapshotVersion}` : '尚未加载'}</span>
              </div>
              <div className="policy-source-row"><strong>使用方</strong><span>任务页的 Gate 条件、门禁审查建议、测试证据汇总</span><span className="pill soft">只读</span></div>
              <div className="policy-source-row"><strong>不影响</strong><span>本地项目配置、测试命令、托管工作树设置</span><span className="pill soft">分开管理</span></div>
            </div>
            <div className="mini-card soft">
              <p className="section-title">更新团队数据后发生什么</p>
              <ul>
                <li>读取团队项目的策略快照；不拉取或推送代码，也不上传本地结果。</li>
                <li>刷新团队概览中的策略、预算和 Gate 汇总。</li>
                <li>重新评估当前任务的 Gate 条件，但不会自动通过缺少审查或测试的 Gate。</li>
                <li>写入执行记录，说明本机使用了哪一版策略。</li>
              </ul>
            </div>
            <button className="ghost-button" type="button" onClick={onSyncTeam} disabled={isSyncingTeam}>
              {/* Same action and name as the team connection popover (plan T4). */}
              {isSyncingTeam ? '更新中' : '更新团队数据'}
            </button>
            {syncFeedback ? (
              <p className="meta" data-testid="team-sync-feedback" role={syncFeedback.status === 'error' ? 'alert' : 'status'}>
                {syncFeedback.message}
              </p>
            ) : null}
            <div className="compact-row">
              <span>总费用</span>
              <strong>{totalCost}</strong>
            </div>
            <div className="compact-row">
              <span>成员 Token 用量</span>
              <strong>{memberTokens.toLocaleString()}</strong>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
