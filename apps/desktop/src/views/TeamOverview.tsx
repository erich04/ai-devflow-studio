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
import type { FieldDataSource } from '../app/desktop-view-model'

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
    ? members.map((member) => `${member.name} ${member.role}`).join(' · ')
    : '未加载团队成员'
  const projectCostById = new Map(projectRollups.map((rollup) => [rollup.key, rollup]))
  const selectedProject = projects.find((project) => project.id === (selectedProjectId ?? selectedRun?.projectId))
  const selectedProjectLabel = selectedProject?.name ?? '未选择 Team Project'
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

  return (
    <section className="route-page team-page" data-testid="team-overview">
      <div className="panel">
        <div className="panel-head">
            <span className="panel-title">Team Overview · redacted delivery health</span>
            <div className="row">
              <span className="pill soft">团队视图只看脱敏摘要，不展示本地 raw log</span>
              <span className={`pill ${runtimeDataSource.tone}`} title={runtimeDataSource.detail}>
                {runtimeDataSource.label}
              </span>
              <span className="pill accent">{dataOrigin}</span>
            </div>
          </div>
        <div className="panel-body">
          <strong className="sr-copy">项目交付健康</strong>
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Repository</th>
                <th>Health</th>
                <th>Test command</th>
                <th>Active / Latest Run</th>
                <th>Gate</th>
                <th>Rollup</th>
                <th>Members</th>
                <th>Token / Cost</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <p className="empty-note">未加载 Team Project。更新团队数据后才会展示远端项目、成员、策略和成本摘要。</p>
                  </td>
                </tr>
              ) : projects.map((project) => {
                const rollup = projectCostById.get(project.id)
                const isSelectedProject = project.id === selectedProject?.id

                return (
                  <tr key={project.id}>
                    <td><strong>{project.name}</strong></td>
                    <td className="mono">{project.repository}</td>
                    <td><span className={`pill ${project.health === 'on_track' ? 'good' : project.health === 'blocked' ? 'bad' : 'warn'}`}>{project.health}</span></td>
                    <td className="mono">{project.testCommand}</td>
                    <td>{isSelectedProject ? selectedRun?.title ?? '暂无 Run' : '暂无当前 Run'}</td>
                    <td>
                      <span className={`pill ${isSelectedProject ? snapshotTone : 'soft'}`}>
                        {isSelectedProject ? snapshotStatus : 'not loaded'}
                      </span>
                    </td>
                    <td>
                      {isSelectedProject
                        ? `${gateEnforcementDecision?.blockingReasons.length ?? 0} block · ${gateEnforcementDecision?.warningReasons.length ?? 0} warn · ${gateEnforcementDecision?.requiredActions.length ?? 0} actions`
                        : '无当前 Gate 数据'}
                    </td>
                    <td>{memberSummary}</td>
                    <td>{rollup ? `${rollup.totalTokens.toLocaleString()} · ${formatCostRollup([rollup])}` : `0 · ${totalCost}`}</td>
                    <td><span className={`pill ${isSelectedProject ? 'accent' : 'soft'}`}>{isSelectedProject ? snapshotSource : dataOrigin}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="member-roster" aria-label="Team members">
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
            <span className="panel-title">Team Project Settings / Policy</span>
            <span className="pill accent">admin config</span>
          </div>
          <div className="panel-body stack">
            <div className="policy-callout">
              <div className="row">
                <strong>策略归属：Team Project · {selectedProjectLabel}</strong>
                <span className="pill warn">不是 Local Project 配置</span>
              </div>
              <p className="meta">这里定义 Gate policy、角色权限、预算和必需 Evidence。Workbench、Inspector、Agents、Tests 只读取 policy snapshot 并解释阻断原因，不能在 Run 内临时改规则。</p>
            </div>
            {policySnapshot?.effectivePolicy?.rules.length ? (
              <div className="policy-matrix" aria-label="Gate policy matrix">
                <div className="policy-row header"><span>Rule</span><span>Target</span><span>Action</span><span>Source</span></div>
                {policySnapshot.effectivePolicy.rules.map((rule) => (
                  <div className="policy-row" key={rule.ruleKey}>
                    <strong>{rule.ruleKey}</strong>
                    <span>{rule.target}</span>
                    <span className={`pill ${rule.action === 'block' ? 'warn' : rule.action === 'warn' ? 'soft' : 'good'}`}>
                      {rule.action}
                    </span>
                    <span>{rule.source}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">未加载 Team policy 规则。</p>
            )}
            <div className="mini-card">
              <p className="section-title">Budget Guard</p>
              <div className="row">
                <strong>{policySnapshot ? '远端预算策略已加载' : '预算策略未加载'}</strong>
                <span className={`pill ${policySnapshot ? 'good' : 'soft'}`}>{policySnapshot ? snapshotSource : 'not loaded'}</span>
              </div>
              <p className="meta">没有 Team policy snapshot 时，Workbench 不展示预算结论。</p>
            </div>
            <button className="primary-button">保存 Team Policy 草稿</button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Policy Snapshot · desktop read path</span>
            <span className={`pill ${snapshotTone}`}>{snapshotStatus}</span>
          </div>
          <div className="panel-body stack">
            <div className="policy-source-grid">
              <div className="policy-source-row">
                <strong>Source</strong>
                <span>
                  {policySnapshot
                    ? `${snapshotSource} snapshot v${snapshotVersion} · synced ${policySnapshot.syncedAt}`
                    : 'policy snapshot 尚未加载，Gate 写路径会保持只读阻断'}
                </span>
                <span className={`pill ${snapshotTone}`}>{snapshotStatus}</span>
              </div>
              <div className="policy-source-row">
                <strong>Selected Run</strong>
                <span>{selectedRun?.title ?? 'No selected Run'} · {selectedProject?.name ?? '未绑定 Team Project'}</span>
                <span className="pill soft">{snapshotVersion ? `policy v${snapshotVersion}` : 'not loaded'}</span>
              </div>
              <div className="policy-source-row"><strong>Used by</strong><span>Workbench Inspector · Agents Gate Advisory · Tests Evidence rollup</span><span className="pill soft">read only</span></div>
              <div className="policy-source-row"><strong>Not used by</strong><span>Local Project config、test command、managed worktree 设置</span><span className="pill soft">separate</span></div>
            </div>
            <div className="mini-card soft">
              <p className="section-title">更新团队数据后发生什么</p>
              <ul>
                <li>读取 Team Project policy snapshot；不拉取或推送代码，也不上传本地结果。</li>
                <li>刷新 Team Overview 的 policy / budget / Gate rollup。</li>
                <li>重新评估当前 Run 的 Gate 条件，但不会自动通过缺少 review 或 tests 的 Gate。</li>
                <li>写入 Event / Trace，说明本机使用了哪一版 policy。</li>
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
              <span>Total cost</span>
              <strong>{totalCost}</strong>
            </div>
            <div className="compact-row">
              <span>Member tokens</span>
              <strong>{memberTokens.toLocaleString()}</strong>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

