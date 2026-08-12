# DevFlow Desktop 后端真实化数据源矩阵

本文件是 Airbnb-III 前端重构进入后端/IPC/local store 对接后的工程清单。目标不是新增一批接口，而是先把现有页面字段的来源讲清楚：哪些已经由 Electron IPC / 本地 SQLite / 远端 snapshot 驱动，哪些只是 renderer adapter 或 seed fallback，哪些需要后续 shared/API/IPC 合同变更。

当前持久化基线是 Team schema v12 与 Desktop schema v16。V1.5 GitHub Delivery 已实现；
`v1.4.0` 仍是 current release，V1.5 release/signoff 尚未完成。

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
| Task/Gate/Review/Delivery 类型 | `WorkflowNode.kind/stage` 映射 | `desktop-only adapter` | 保持 UI 映射，不改变 domain kind。 |
| ART/EVD/TRC 数量 | `Artifact[]`、`TestEvidence[]`、`AgentEvent[]` 按 `nodeId` 计算 | `local persisted` | 已具备真实化；继续补空/失败状态。 |
| Gate 状态 | `evaluateGateEnforcement` + `loadEnforcementPolicy` | `real IPC/API` | 继续让 Inspector 展示完整阻断原因。 |

## Inspector

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 当前 Run/Node | `WorkflowRun.currentNodeId` + selected state | `local persisted` | 已接真实状态。 |
| Policy snapshot | `loadEnforcementPolicy` / `policy_snapshots` | `real IPC/API` + `local persisted` | 显示 source/version/syncedAt/unavailable reason。 |
| Knowledge Review | `runKnowledgeReview` result + `agent_reviews` | `real IPC/API` + `local persisted` | 继续从 Agents 入口运行并回写当前 Gate。 |
| Test Evidence | `runProjectTests` result + `test_evidence` | `real IPC/API` + `local persisted` | Main 从 canonical Evidence 自动同步；renderer 无远端写接口；LocalStore 永久净化旧 Evidence、Test Report、Test Result Event 与 Coding Event，API 与 Repository 再次净化。`skipped` 需后续合同变更。 |
| Budget guard | `CodingAgentRun.budgetDecision` | `local persisted` | 当前只在 Coding Agent runtime 下真实；通用 budget history 待补。 |
| Required Artifact | `Artifact[]` + node artifact ids | `local persisted` | 已可从现有合同计算。 |
| PR Delivery Package | canonical PR artifact + reviewed coding source | `real Electron IPC` + `local persisted` | Renderer 只发送 Run/Node 标识；Electron main 从可信状态生成 metadata-only package，浏览器预览失败关闭。 |
| Delivery Intent / recovery | `loadState().githubDeliveryIntents` + `githubDeliveryOperatorOutcomes` | `real Electron IPC` + `local persisted` | Electron main 绑定 canonical managed worktree、expected commit 与 evidence；UI 只提供明确的 Revise、Resume、Retry、Stop。 |
| Draft completion / Acceptance | Delivery Intent completion + acceptance artifact/decision | `real Electron IPC` + `local persisted` | 只有 verified remote head 和 matching Draft pull request 可推进 GitHub-enabled Acceptance；永不 merge。 |

## Agents

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Provider 列表 | `listAgentProviders` + local credential metadata | `real IPC/API` + `local persisted` | fake provider 必须标注 fallback。 |
| Provider credential | `saveAgentProviderCredential`；renderer 只拿 masked metadata | `real IPC/API` + `local persisted` | 不让 raw key 回读 renderer。 |
| Knowledge Review trace | `AgentTrace[]` | `local persisted` | 已可回写当前 Run/Node。 |
| Token usage | `AgentTokenUsage[]` | `local persisted` | 保留 provider-reported/estimated source。 |
| Coding Agent run | `runCodingAgent` / subscriptions | `real IPC/API` + `local persisted` | 继续接 permission relay、tool timeline、diff preview；Team summary 分别对白名单 structured metadata、model/cost、budget/reason 投影，净化允许字符串中的 secret/path，并丢弃未知嵌套键。 |
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
| Remote policy findings | redacted Agent Review `policyFindings` | `real IPC/API` + `local persisted` | 保留重建 exact blocker ID 所需的最小明细；count-only payload 被拒绝，本地 evidence/reference ID 与敏感文本不进入 Team read model。 |
| Gate override sync | main 提交 identifier/reason-only override；remote snapshot 回灌 accepted audit | `real IPC/API` + `local persisted` | 独立 Lead 不重传 creator-owned Run。API 规范化 Postgres node namespace、重算 exact blocker/policy；持久化 audit 恢复 namespaced FK，同 scope 幂等更新保持该命名空间。 |
| GitHub App repository binding | owner-managed API route + Postgres binding/version/revocation state | `real IPC/API` | API 验证 installation/repository/default branch；private key 不进入 Postgres、Desktop 或 renderer。 |
| Delivery Request / approval | redacted request + immutable signed Web approval | `real IPC/API` | Desktop Bearer authority 不能审批自身请求；approval 精确绑定 binding、series/attempt/revision、commit 与 evidence digests。 |
| Credential / publication / Draft | API credential grant、Desktop publication report、API remote verification 与 PR result | `real IPC/API` + `local persisted` | Electron main 内存中短暂使用 repository-scoped token；API 独立确认 remote head 后创建或 reconcile 一个 Draft pull request。 |
| Snapshot history | 当前只有 latest snapshot | `missing contract` | 后续单独设计历史查询合同。 |

## Browser Preview Boundary

浏览器 Vite 预览不能访问 Electron IPC、本地 SQLite、本地测试执行、系统 credential store 或本机 worktree。预览模式只用于 UI fallback/demo，必须显示 `browser preview` 或 `seed fallback`；Agent、Gate、Test、PR、Acceptance 工作流推进会失败关闭。桌面端才是完整真实运行边界。

Team API 默认不接受未签名 `x-devflow-*` 身份头，CORS 也不放行这些 header。仅本机 CLI/smoke 可显式设置 `DEV_AUTH_ENABLED=true`，且带 `Origin` 的请求仍会被拒绝；生产写入使用签名 Cookie 或配对后的 Bearer Token。

## 后续合同变更候选

- Knowledge source query/index：按当前本地仓库实时扫描 Markdown/图谱。
- Policy snapshot history：查询历史 snapshot、每次 sync 的 Gate re-evaluation 记录。
- TestEvidence `skipped`：需要 shared schema、API summary、local store、UI 状态一起变更。
- Batch Gate re-evaluation：Team 页对多个 Run/Node 的统一 rollup。
