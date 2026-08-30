# DevFlow Desktop 后端真实化数据源矩阵

本文件是 Airbnb-III 前端重构进入后端/IPC/local store 对接后的工程清单。目标不是新增一批接口，而是先把现有页面字段的来源讲清楚：哪些已经由 Electron IPC / 本地 SQLite / 远端 snapshot 驱动，哪些只是 renderer adapter 或 seed fallback，哪些需要后续 shared/API/IPC 合同变更。

当前持久化基线是 Team schema v24 与 Desktop schema v34。Team 持久层记录非秘密的
provider-authoritative expiry 合同与观测时间，不把本机时钟或 legacy NULL 当作清除授权。
`v1.5.0` 已发布并完成 1.x；V2.0 Agent Runtime 实现正在按唯一 Roadmap 推进。

状态枚举：

- `real IPC/API`: 已有 Electron IPC 或远端 API 读写路径。
- `local persisted`: 已由 Electron local store / SQLite 持久化。
- `fixture fallback`: 浏览器预览或无本地数据时使用 seed/fake 数据。
- `desktop-only adapter`: renderer 由真实 domain object 派生的 UI-only 视图模型。
- `missing contract`: 当前 shared/API/IPC 还没有稳定合同表达。

## Workbench

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Run 列表 | `loadState().runs`；同步后与 `loadRemoteSnapshot().runs` merge | `real IPC/API` + `local persisted` | 保持 local + remote merge，禁止恢复“同步后本地 Run 消失”。 |
| Run source badge | `remoteRunIds` + `dataOrigin` | `desktop-only adapter` | 保留为 renderer-only 解释字段。 |
| Board 阶段列 | `WorkflowRun.nodes` 按 `NodeStage` 分组 | `desktop-only adapter` | 不进 shared；只解释阶段视觉。 |
| 节点类型 | `WorkflowNode.kind/stage` → `WorkflowNodePresentation.nodeKind` | `desktop-only adapter` | Task、Gate、Test、Delivery、Acceptance 独立显示；方案设计保持底层 `agent`，展示为产出型 Task。Gate Review 是 Gate 能力，不再冒充方案设计节点类型。 |
| 节点来源 | `WorkflowNode.kind` → `WorkflowNodePresentation.sourceKind` | `desktop-only adapter` | 使用统一映射显示 Run 模板、Team Policy、本地 Runtime、系统派生来源。 |
| 节点展示方式 | `WorkflowNode.kind` → `WorkflowNodePresentation.displayMode` | `desktop-only adapter` | `standard` 不制造界面噪声；只有 PR/Acceptance 等特殊折叠节点显示“折叠输出”。展示方式不与类型或来源计数混排。 |
| ART/EVD/TRC 数量 | `Artifact[]`、`TestEvidence[]`、`AgentEvent[]` 按 `nodeId` 计算 | `local persisted` | 已具备真实化；继续补空/失败状态。 |
| Gate 状态 | `evaluateGateEnforcement` + `loadEnforcementPolicy` | `real IPC/API` | 继续让 Inspector 展示完整阻断原因。 |

## Inspector

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 当前 Run/Node | `WorkflowRun.currentNodeId` + selected state | `local persisted` | 已接真实状态。 |
| 节点语义 | 与 Board 共用 `WorkflowNodePresentation` | `desktop-only adapter` | Inspector 与卡片使用相同的类型、来源、展示方式和状态术语；旧 Run 的标题与 `agent` kind 不需要迁移。 |
| Task → Gate 影响 | 当前 `WorkflowRun.edges/nodes/currentNodeId` + `Artifact[]` → `WorkflowGateImpactViewModel` | `desktop-only adapter` | 从当前 Task 按有向边 BFS 选择最近下游 Gate（同距离按 workflow 节点顺序），只读显示 Gate 状态与已关联产物并允许跳转；不授予审批或 Override。 |
| Policy snapshot | `loadEnforcementPolicy` / `policy_snapshots` | `real IPC/API` + `local persisted` | 显示 source/version/syncedAt/unavailable reason。 |
| Knowledge Review | `runKnowledgeReview` result + `agent_reviews` | `real IPC/API` + `local persisted` | 继续从 Agents 入口运行并回写当前 Gate。 |
| Test Evidence | `runProjectTests` result + `test_evidence` | `real IPC/API` + `local persisted` | Main 从 canonical Evidence 自动同步；renderer 无远端写接口；LocalStore 永久净化旧 Evidence、Test Report、Test Result Event 与 Coding Event，API 与 Repository 再次净化。`skipped` 需后续合同变更。 |
| Budget guard | `CodingAgentRun.budgetDecision` | `local persisted` | 当前只在 Coding Agent runtime 下真实；通用 budget history 待补。 |
| Required Artifact | `Artifact[]` + node artifact ids | `local persisted` | 已可从现有合同计算。 |
| Remediation 恢复计划 | 当前 `GateEnforcementDecision` + 临时 `RemediationPlan` + runtime action state | `desktop-only adapter` | 只投影当前未满足事实的来源/规则、严重度、必做性、原因、动作、角色、证据、完成标准与 open/resolved/stale 状态；Review、Tests、Policy sync、Coding retry 复用现有受控入口，不新增第二套持久化事实。Lead Override 保持独立权限与审计面。 |
| PR Delivery Package | canonical PR artifact + reviewed coding source | `real Electron IPC` + `local persisted` | Renderer 只发送 Run/Node 标识；Electron main 从可信状态生成 metadata-only package，浏览器预览失败关闭。 |
| Delivery Intent / recovery | `loadState().githubDeliveryIntents` + `githubDeliveryOperatorOutcomes` | `real Electron IPC` + `local persisted` | Electron main 绑定 canonical managed worktree、expected commit 与 evidence；UI 只提供明确的 Revise、Resume、Retry、Stop。 |
| Draft completion / Acceptance | Delivery Intent completion + acceptance artifact/decision | `real Electron IPC` + `local persisted` | 只有 verified remote head 和 matching Draft pull request 可推进 GitHub-enabled Acceptance；永不 merge。 |

## Agents

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Provider 列表 | `listAgentProviders` + local credential metadata | `real IPC/API` + `local persisted` | 用户只看 Provider Name；稳定 `providerId` 由 Main/API 生成，旧 ID-only 记录按兼容名称读取；fake provider 必须标注 fallback。 |
| Provider credential | `saveAgentProviderCredential`；renderer 只拿 name、内部 ID 与 masked metadata | `real IPC/API` + `local persisted` | 不让 raw key 回读 renderer；空名称和规范化重名在可信边界拒绝。 |
| Knowledge Review trace | `AgentTrace[]` | `local persisted` | 已可回写当前 Run/Node。 |
| Requirement Stage Agent | `completeWorkflowAgentNode` + `StageAgentExecutor` (`direct-provider` / `local-agent`) | `real Electron IPC` + `local persisted` | Renderer 只选择执行器；Main 解析仓库和 OpenCode 配置。Local Agent 固定只读 read/glob/grep/list、预算/超时/取消和 citation digest 边界，无自动 fallback。Requirement Gate 同屏绑定 immutable Raw Request、Repository Findings、exact Clarification Revision；反馈生成新版本，stale approval fail closed。Team 仅同步脱敏摘要。 |
| Token usage | `AgentTokenUsage[]` | `local persisted` | 保留 provider-reported/estimated source。 |
| Coding Agent readiness | `detectCodingRuntimeEngines` + project `CodingRuntimeConfiguration` + `getCodingRuntimeReadiness` | `real IPC/API` + `local persisted` | Workbench 与 Agents 共用同一 main-owned 结论。OpenCode 检测只返回候选，用户确认 exact binary/version 后才保存；Native 只绑定本地安全保存的 Provider。Executor、Engine、capability、Provider、Team Project、测试命令、预算策略/评估、并发与权限分别阻断，任一未知即 fail closed。机器 code 只放诊断详情。 |
| Coding Agent run | `runCodingAgent` / subscriptions | `real IPC/API` + `local persisted` | 项目级 Native/OpenCode 选择与 readiness 由 Electron main 解析；模型只提出精确 Change Set，人工批准后事务性写入 managed worktree 并运行保存的测试命令。Provider settlement 统一校验 input/cache-hit/cache-miss/output，保存不可变 provider/model/time pricing snapshot 与分项；缺失拆分或未知价格明确为 unknown，cache 不重复计入 token。Team schema v25 的 `cost_details` 只同步白名单 usage/pricing/breakdown，不同步 prompt、response 或凭证。 |
| Agent Runtime | `startAgentRuntime` / `advanceAgentRuntime` / `cancelAgentRuntime` / `listAgentRuntimes` | `real IPC/API` + `local persisted` | Desktop schema v34 保留严格 trajectory、checkpoint、evaluation、terminal summary、trusted Local MCP/Tool audit、main-owned retrieval index、完整 Runtime Context attachment、Memory/Coordination ID-only outbox、durable Coordination Session、项目级 Native/OpenCode Coding Runtime 配置与不可变 Native v2 Change Set；schema 30–32 另持久化 Coding Diff sanitizer provenance、发布前 content scan 与索引化 stored-evidence privacy provenance。Runtime 创建时原子绑定 exact current Citation/Memory revision，并在每次外部 Tool action前及 durable grant reservation 内重验 snapshot/head/tombstone/expiry/pairing，stale Context fail closed。renderer projection v2 只给 Desktop attachment ID、Knowledge Citation/Durable Memory 计数与 identity/context digests。Team schema v22 在 v21 Native Coding summary 基础上为 Provider 持久化独立显示名称；Team schema v23 另持久化 Desktop pairing 的 issued-role ceiling、撤销与 token expiry；v24 持久化 review subject manifest。源码、路径、Change Set、Memory 内容、raw output、完整 Context、checkpoint 和 capability authority 仍仅在 Electron main。 |
| Agent Memory lifecycle | accepted Runtime observation + `listAgentMemoryLifecycle` / `promoteAgentMemoryCandidate` / `reviseAgentMemory` / `deleteAgentMemory` | `real IPC/API` + `local persisted` | 成功 observation transition 与唯一 inert Candidate 原子提交。renderer 读取时仅发送 selected Run、persisted Runtime 与 Local Project ID；promotion 另发送 Candidate ID 与 renderer-observed content/provenance digest；revision 仅发送 Memory ID、current revision/head version、current content/provenance digest 与 bounded replacement statement；deletion 发送相同 exact identity/version/digest 边界但不发送 authority、capability 或 purge time。Electron main 从 exact Runtime 派生完整 user/session scope，重验 canonical Run/current pairing/exact provenance，构造固定 human authority并消费 opaque capability；revision 继承现有 visibility/sensitivity/retention/expiry authority，deletion 先 durable tombstone 再 purge，restart 后只从 exact pending tombstone 恢复 purge。随后只投影有界 Candidate pending/promoted、Durable active/conflict/expired/purge/deleted 与 exact revision/head version。scope session、authority policy/actor/digest、opaque capability、raw output、local path 与 deleted statement 不出 main。 |
| Agent Memory Team projection | `agent-memory-summary` outbox → `/api/sync/agent-memory-summary` → `agent_memory_summaries` / `agent_memory_projection_audits` | `real IPC/API` + `local/Team persisted` | Electron main 从当前 Team-scoped lifecycle、canonical Run/Node、source Runtime 与 accepted Context 重建 strict metadata-only projection；outbox 只存 Memory ID。Seed/Postgres 固定 scope，并分别单调校验 lifecycle `headVersion` 与 accepted-Context `qualityVersion`；同一 head 的质量推进写入复合审计键。Web 只读显示 citation/accepted-Context counts、revision/lifecycle/visibility/sensitivity/retention，不能 promote/revise/delete/purge/rebuild/resume。statement、content digest、scope session、path、prompt、reasoning、credential 与 raw output 永不跨边界。 |
| Agent Coordination Team projection | `agent-coordination-summary` outbox → `/api/sync/agent-coordination-summary` → `agent_coordination_summaries` / `agent_coordination_projection_audits` | `real IPC/API` + `local/Team persisted` | Electron main 从 exact durable Coordination Session ID 重建 strict metadata-only projection；每次协调版本变化在同一事务 coalesce ID-only outbox。Seed/Postgres 固定 exact Team Project/Run/Node/session scope，并仅接受不可变 graph/role shape、同版本 exact replay 或更高版本单调 counters。Web 只读显示 task/status/failure/handoff、质量、cost、latency 与 intervention counts；不能 create/start/assign/retry/resume/cancel/lease、发 Tool grant，或读取本地 Context、capability、resource、path、patch、prompt、output。 |
| Permission relay | `CodingPermissionRequest[]` + decisions | `real IPC/API` + `local persisted` | 已有 IPC；继续补真实 UI 状态。 |
| Diff preview | `CodingDiffArtifact[]` | `local persisted` | 已可展示。 |

## Tests

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Test command | `LocalProject.testCommand` + `saveProjectTestCommand` | `real IPC/API` + `local persisted` | 保持命令安全校验。 |
| Command safety | `validateTestCommand`，浏览器 fallback 用 shared validator | `real IPC/API` | Electron 优先，browser fallback 必须明确只是预览。 |
| Test execution | `runProjectTests` | `real IPC/API` | 真实执行只在 Electron 边界内。 |
| Evidence list | `TestEvidence[]` | `local persisted` | 已可由真实测试结果驱动。 |
| skipped evidence | shared schema 当前未定义 | `missing contract` | 单独列合同变更，不混入 UI 真实化。 |

## Knowledge

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Git Markdown Index | `knowledgeDocuments` bundled shared index | `fixture fallback` / `desktop-only adapter` | UI 必须标识 shared index，不伪装成任意仓库实时索引。 |
| Run references | `buildKnowledgeReferences` 从 Run/Artifact/TestEvidence 计算 | `desktop-only adapter` | 当前可用；真实 repo source query 待合同设计。 |
| Knowledge graph | `knowledgeEntities` / `knowledgeRelations` bundled data | `fixture fallback` | 若要读真实仓库图谱，需要新增 knowledge source query 合同。 |
| Source highlighter | `supportContext.documentId/referenceId` | `desktop-only adapter` | 已可支持 Inspector/Search deep link。 |

## Team

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Team projects/members/cost | `loadRemoteSnapshot`；无远端时 seed fallback | `real IPC/API` + `fixture fallback` | 同步后显示 snapshot 与 merge 摘要。 |
| Policy snapshot source/version | `loadEnforcementPolicy` / `policy_snapshots` | `real IPC/API` + `local persisted` | 继续展示 source/version/syncedAt。 |
| Gate re-evaluation summary | `evaluateGateEnforcement` decision | `real IPC/API` | 当前只针对 selected Run/Node；批量历史需要新合同。 |
| Canonical Run sync | Electron main 从 LocalStore 读取 Run/current Node 后生成白名单 summary | `real IPC/API` | Renderer 无上传接口；只有原 authenticated sync creator 可更新。Run Summary 独占 status/current Node 推进，并收敛旧 active Node；child summary 不推进或合成 Run。 |
| Dependent summary sync | canonical local Test/Review/Coding 对象生成 child summary | `real IPC/API` + `local persisted` | Child-first；`remote_sync_outbox` 持久化 metadata-only 操作、租约、退避、失败和显式恢复；ID 固定绑定 organization/project/Run/Node，重绑定返回 409，迟到 child 不激活旧 Node。 |
| Agent Runtime Team projection | `agent-runtime-summary` outbox → `/api/sync/agent-runtime-summary` → `agent_runtime_summaries` / `agent_runtime_projection_audits` | `real IPC/API` + `local persisted` | 仅 Team-scoped Runtime 可上传；Seed/Postgres 校验 canonical Run/Node、固定 scope、严格单调版本与 terminal 不可变；Team 不得 resume、注入 Tool result、发 capability 或推进 Workflow。 |
| Remote policy findings | redacted Agent Review `policyFindings` | `real IPC/API` + `local persisted` | 保留重建 exact blocker ID 所需的最小明细；count-only payload 被拒绝，本地 evidence/reference ID 与敏感文本不进入 Team read model。 |
| Gate override sync | main 提交 identifier/reason-only override；remote snapshot 回灌 accepted audit | `real IPC/API` + `local persisted` | 独立 Lead 不重传 creator-owned Run。API 规范化 Postgres node namespace、重算 exact blocker/policy；持久化 audit 恢复 namespaced FK，同 scope 幂等更新保持该命名空间。 |
| GitHub App repository binding | owner-managed API route + Postgres binding/version/revocation state | `real IPC/API` | API 验证 installation/repository/default branch；private key 不进入 Postgres、Desktop 或 renderer。 |
| Delivery Request / approval | redacted request + immutable signed Web approval | `real IPC/API` | Desktop Bearer authority 不能审批自身请求；approval 精确绑定 binding、series/attempt/revision、commit 与 evidence digests。 |
| Credential / publication / Draft | API credential grant、Desktop publication report、API remote verification 与 PR result | `real IPC/API` + `local persisted` | Electron main 内存中短暂使用 repository-scoped token；Team schema v21 保留 provider-authoritative expiry、观测时间、合同版本、bounded provider retry not-before 与 verified publication adoption 来源，不持久化 token/header/body；API 独立确认 remote head 后创建或 reconcile 一个 Draft pull request。后续同 series 的已批准 attempt 仅可在前一 attempt 已 verified publication 且 Draft 阶段失败时采用该证据，避免重复 credential/push。 |
| Snapshot history | 当前只有 latest snapshot | `missing contract` | 后续单独设计历史查询合同。 |

## Browser Preview Boundary

浏览器 Vite 预览不能访问 Electron IPC、本地 SQLite、本地测试执行、系统 credential store 或本机 worktree。预览模式只用于 UI fallback/demo，必须显示 `browser preview` 或 `seed fallback`；Agent、Gate、Test、PR、Acceptance 工作流推进会失败关闭。桌面端才是完整真实运行边界。

Team API 默认不接受未签名 `x-devflow-*` 身份头，CORS 也不放行这些 header。仅本机 CLI/smoke 可显式设置 `DEV_AUTH_ENABLED=true`，且带 `Origin` 的请求仍会被拒绝；生产写入使用签名 Cookie 或配对后的 Bearer Token。

## 后续合同变更候选

- Knowledge source query/index：按当前本地仓库实时扫描 Markdown/图谱。
- Policy snapshot history：查询历史 snapshot、每次 sync 的 Gate re-evaluation 记录。
- TestEvidence `skipped`：需要 shared schema、API summary、local store、UI 状态一起变更。
- Batch Gate re-evaluation：Team 页对多个 Run/Node 的统一 rollup。
