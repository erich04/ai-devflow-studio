# DevFlow Desktop 后端真实化数据源矩阵

本文件是 Airbnb-III 前端重构进入后端/IPC/local store 对接后的工程清单。目标不是新增一批接口，而是先把现有页面字段的来源讲清楚：哪些已经由 Electron IPC / 本地 SQLite / 远端 snapshot 驱动，哪些只是 renderer adapter 或 seed fallback，哪些需要后续 shared/API/IPC 合同变更。

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
| Test Evidence | `runProjectTests` result + `test_evidence` | `real IPC/API` + `local persisted` | 失败、超时状态已可表达；`skipped` 需后续合同变更。 |
| Budget guard | `CodingAgentRun.budgetDecision` | `local persisted` | 当前只在 Coding Agent runtime 下真实；通用 budget history 待补。 |
| Required Artifact | `Artifact[]` + node artifact ids | `local persisted` | 已可从现有合同计算。 |
| Handoff bundle | PR/acceptance artifacts + trace | `desktop-only adapter` | PR Draft / Acceptance Bundle 仍由 renderer action 汇总现有对象。 |

## Agents

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Provider 列表 | `listAgentProviders` + local credential metadata | `real IPC/API` + `local persisted` | fake provider 必须标注 fallback。 |
| Provider credential | `saveAgentProviderCredential`；renderer 只拿 masked metadata | `real IPC/API` + `local persisted` | 不让 raw key 回读 renderer。 |
| Knowledge Review trace | `AgentTrace[]` | `local persisted` | 已可回写当前 Run/Node。 |
| Token usage | `AgentTokenUsage[]` | `local persisted` | 保留 provider-reported/estimated source。 |
| Coding Agent run | `runCodingAgent` / subscriptions | `real IPC/API` + `local persisted` | 继续接 permission relay、tool timeline、diff preview。 |
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
| Snapshot history | 当前只有 latest snapshot | `missing contract` | 后续单独设计历史查询合同。 |

## Browser Preview Boundary

浏览器 Vite 预览不能访问 Electron IPC、本地 SQLite、本地测试执行、系统 credential store 或本机 worktree。预览模式只用于 UI fallback/demo，必须显示 `browser preview` 或 `seed fallback`。桌面端才是完整真实运行边界。

## 后续合同变更候选

- Knowledge source query/index：按当前本地仓库实时扫描 Markdown/图谱。
- Policy snapshot history：查询历史 snapshot、每次 sync 的 Gate re-evaluation 记录。
- TestEvidence `skipped`：需要 shared schema、API summary、local store、UI 状态一起变更。
- Batch Gate re-evaluation：Team 页对多个 Run/Node 的统一 rollup。
