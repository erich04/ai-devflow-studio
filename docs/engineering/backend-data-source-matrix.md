# DevFlow Desktop 后端真实化数据源矩阵

本文件是 Airbnb-III 前端重构进入后端、IPC 和本地存储对接后的工程清单。目标不是新增一批接口，而是先把现有页面字段的来源讲清楚：哪些已经由 Electron IPC / 本地 SQLite / 远端快照驱动，哪些只是渲染进程适配或种子数据回退，哪些需要后续 shared/API/IPC 契约变更。

当前持久化基线是 Team schema v24 与 Desktop schema v35。Team 持久层记录非秘密的
由服务提供方确认的过期契约与观测时间，不把本机时钟或旧记录的 `NULL` 当作清除授权。
`v1.5.0` 已发布并完成 1.x；V2.0 Agent 运行时的实现正在按唯一路线图推进。

状态枚举：

- `real IPC/API`: 已有 Electron IPC 或远端 API 读写路径。
- `local persisted`: 已由 Electron 本地存储 / SQLite 持久化。
- `fixture fallback`: 浏览器预览或无本地数据时使用 seed/fake 数据。
- `desktop-only adapter`: 渲染进程由真实领域对象派生的界面视图模型。
- `missing contract`: 当前 shared/API/IPC 还没有稳定契约表达。

<a id="workbench"></a>

## 工作台

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Run 列表 | `loadState().runs`；同步后与 `loadRemoteSnapshot().runs` 合并 | `real IPC/API` + `local persisted` | 保持本地与远端合并，禁止恢复“同步后本地 Run 消失”。 |
| Run 来源标签 | `remoteRunIds` + `dataOrigin` | `desktop-only adapter` | 保留为仅供渲染进程使用的解释字段。 |
| 看板阶段列 | `WorkflowRun.nodes` 按 `NodeStage` 分组 | `desktop-only adapter` | 不进入共享领域结构；只解释阶段展示。 |
| 节点类型 | `WorkflowNode.kind/stage` → `WorkflowNodePresentation.nodeKind` | `desktop-only adapter` | Task、Gate、Test、Delivery、Acceptance 独立显示；方案设计保持底层 `agent`，展示为产出型 Task。门禁审查是 Gate 能力，不再冒充方案设计节点类型。 |
| 节点来源 | `WorkflowNode.kind` → `WorkflowNodePresentation.sourceKind` | `desktop-only adapter` | 使用统一映射显示 Run 模板、团队策略、本地运行时和系统派生来源。 |
| 节点展示方式 | `WorkflowNode.kind` → `WorkflowNodePresentation.displayMode` | `desktop-only adapter` | `standard` 不制造界面噪声；只有 PR/Acceptance 等特殊折叠节点显示“折叠输出”。展示方式不与类型或来源计数混排。 |
| ART/EVD/TRC 数量 | `Artifact[]`、`TestEvidence[]`、`AgentEvent[]` 按 `nodeId` 计算 | `local persisted` | 已具备真实化；继续补空/失败状态。 |
| Gate 状态 | `evaluateGateEnforcement` + `loadEnforcementPolicy` | `real IPC/API` | 继续让 Inspector 展示完整阻断原因。 |

<a id="workbench-conversations"></a>

## 工作台会话

| 数据 | 当前来源 | 边界 |
| --- | --- | --- |
| 会话、输入、问题、记忆、Tab 开闭 | Electron `workbenchConversation` → SQLite `workbench_conversations`（schema 35） | 按本地项目隔离；不进入 `LocalExecutionState` 或团队同步。 |
| 全项目流程与任意节点 | 主进程读取权威 Run、产物、测试证据、事件、编码/交付记录与 Gate 评估 | 每次提问重新查询；不受选中卡片约束；完成状态不从聊天推断。 |
| 代码与知识依据 | 受限相对路径读取/搜索及现有仓库知识解析器 | 只读；来源、时间、截断可见；未连接任意业务数据库。 |
| 可共享讨论提案 | 用户明确保存 → `log` Artifact 与会话引用在同一次持久化中提交 | 标记待确认；不替代正式产物，不推进流程或批准 Gate。 |

<a id="inspector"></a>

## 节点检查器

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 当前 Run/Node | `WorkflowRun.currentNodeId` 与选中状态 | `local persisted` | 已接真实状态。 |
| 节点语义 | 与看板共用 `WorkflowNodePresentation` | `desktop-only adapter` | Inspector 与卡片使用相同的类型、来源、展示方式和状态术语；旧 Run 的标题与 `agent` 类型不需要迁移。 |
| Task → Gate 影响 | 当前 `WorkflowRun.edges/nodes/currentNodeId` + `Artifact[]` → `WorkflowGateImpactViewModel` | `desktop-only adapter` | 从当前任务按有向边进行广度优先搜索，选择最近的下游 Gate（同距离按工作流节点顺序），只读显示 Gate 状态与已关联产物并允许跳转；不授予审批或例外放行权限。 |
| 策略快照 | `loadEnforcementPolicy` / `policy_snapshots` | `real IPC/API` + `local persisted` | 显示来源、版本、同步时间与不可用原因。 |
| 知识审查 | `runKnowledgeReview` 的结果 + `agent_reviews` | `real IPC/API` + `local persisted` | 继续从 Agent 管理入口运行并回写当前 Gate。 |
| 测试证据 | `runProjectTests` 的结果与 `test_evidence` | `real IPC/API` + `local persisted` | 主进程从权威证据自动同步；渲染进程无远端写接口。本地存储永久净化旧证据、测试报告、测试结果事件和编码事件，API 与仓库层再次净化。`skipped` 需后续契约变更。 |
| 预算保护 | `CodingAgentRun.budgetDecision` | `local persisted` | 当前仅编码 Agent 运行时有真实记录；通用预算历史待补充。 |
| 必需产物 | `Artifact[]` 与节点产物 ID | `local persisted` | 已可从现有合同计算。 |
| 处理建议（Remediation）恢复计划 | 当前 `GateEnforcementDecision`、临时 `RemediationPlan` 与运行时动作状态 | `desktop-only adapter` | 仅投影当前未满足事实的来源/规则、严重度、必做性、原因、动作、角色、证据、完成标准与 open/resolved/stale 状态。审查、测试、策略同步与编码重试复用现有受控入口，不新增第二套持久化事实。Lead 例外审批保持独立权限与审计界面。 |
| PR 交付包 | 权威 PR 产物与已审查的编码来源 | `real Electron IPC` + `local persisted` | 渲染进程只发送 Run/Node 标识；Electron 主进程从可信状态生成仅含元数据的交付包；浏览器预览拒绝执行。 |
| 交付意图与恢复 | `loadState().githubDeliveryIntents` 与 `githubDeliveryOperatorOutcomes` | `real Electron IPC` + `local persisted` | Electron 主进程绑定权威托管工作树、预期提交和证据；界面只提供明确的修订（Revise）、继续（Resume）、重试（Retry）、停止（Stop）操作。 |
| 草稿交付完成与业务验收 | 交付意图完成记录与验收产物/决定 | `real Electron IPC` + `local persisted` | 启用 GitHub 的验收仅能在远端提交和对应草稿 PR 均核实后推进；绝不执行合并。 |

<a id="agents"></a>

## Agent 管理

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 服务提供方列表 | `listAgentProviders` 与本地凭据元数据 | `real IPC/API` + `local persisted` | 用户只看服务提供方名称；稳定 `providerId` 由主进程/API 生成，旧的仅 ID 记录按兼容名称读取；假服务提供方必须标注回退用途。 |
| 服务提供方凭据 | `saveAgentProviderCredential`；渲染进程仅获得名称、内部 ID 和掩码元数据 | `real IPC/API` + `local persisted` | 原始密钥不能回读至渲染进程；可信边界拒绝空名称和规范化后的重名。 |
| 知识审查执行轨迹 | `AgentTrace[]` | `local persisted` | 已可回写当前 Run/Node。 |
| 需求阶段 Agent | `completeWorkflowAgentNode` 与 `StageAgentExecutor`（`direct-provider` / `local-agent`） | `real Electron IPC` + `local persisted` | 渲染进程只选择执行器；主进程解析仓库和 OpenCode 配置。本地 Agent 固定只读 read/glob/grep/list，并约束预算、超时、取消和引用摘要，不自动回退。需求 Gate 同屏绑定不可变原始请求、仓库调查和精确澄清版本；反馈生成新版本，过期审批必须拒绝。团队侧仅同步脱敏摘要。 |
| Token 用量 | `AgentTokenUsage[]` | `local persisted` | 保留 provider-reported/estimated 来源标识，区分提供方上报值与估算值。 |
| 编码 Agent 就绪检查 | `detectCodingRuntimeEngines`、项目 `CodingRuntimeConfiguration` 与 `getCodingRuntimeReadiness` | `real IPC/API` + `local persisted` | 工作台和 Agent 管理共用主进程维护的同一结论。OpenCode 检测仅返回候选，用户确认具体二进制及版本后才保存；Native 仅绑定本地安全保存的服务提供方。执行器、引擎、能力、服务提供方、团队项目、测试命令、预算策略/评估、并发和权限分别校验，任何未知项都阻止执行。机器错误码仅放在诊断详情。 |
| 编码 Agent 执行 | `runCodingAgent` 与事件订阅 | `real IPC/API` + `local persisted` | Electron 主进程解析项目级 Native/OpenCode 选择与就绪状态；模型只提出精确变更集，人工批准后才以事务方式写入托管工作树并运行已保存的测试命令。提供方结算统一校验输入、缓存命中/未命中和输出，保存不可变的提供方/模型/时间定价快照与分项；缺失拆分或未知价格明确为 unknown，缓存不重复计入 Token。Team schema v25 的 `cost_details` 仅同步白名单用量、定价与分项，不同步提示词、响应或凭据。 |
| Agent 运行时 | `startAgentRuntime` / `advanceAgentRuntime` / `cancelAgentRuntime` / `listAgentRuntimes` | `real IPC/API` + `local persisted` | Desktop schema v35 保留严格的执行轨迹、检查点、评估、终态摘要、可信本地 MCP/工具审计、主进程检索索引、完整运行时上下文附件、仅含记忆/协调 ID 的同步队列、持久化协调会话、项目级 Native/OpenCode 编码运行时配置与不可变 Native v2 变更集；schema 30–32 另存编码差异净化来源、发布前内容扫描与索引化存储证据的隐私来源。创建运行时时原子绑定精确的当前引用/记忆版本，并在每次外部工具操作前及持久化授权预留内重新验证快照、最新版本、删除标记、过期时间和配对；上下文过期即拒绝执行。渲染投影 v2 仅提供桌面附件 ID、知识引用/持久记忆计数以及身份/上下文摘要。Team schema v22 在 v21 原生编码摘要上为服务提供方持久化独立名称；v23 保存桌面配对的签发角色上限、撤销与令牌过期；v24 保存审查对象清单。源码、路径、变更集、记忆内容、原始输出、完整上下文、检查点和能力授权仍仅在 Electron 主进程。 |
| Agent 记忆生命周期 | 已接受的运行时观测与 `listAgentMemoryLifecycle` / `promoteAgentMemoryCandidate` / `reviseAgentMemory` / `deleteAgentMemory` | `real IPC/API` + `local persisted` | 成功观测转换与唯一、尚无效力的候选记忆原子提交。读取时渲染进程只发送所选 Run、已持久化运行时和本地项目 ID；提升为记忆另发送候选 ID 和界面观察到的内容/来源摘要；修订仅发送记忆 ID、当前修订/最新版本、当前内容/来源摘要与有界替换文本；删除发送相同的精确身份、版本和摘要，不发送权限、能力或清除时间。主进程从精确运行时派生完整用户/会话作用域，重验权威 Run、当前配对和精确来源，构造固定人工授权并消费不透明能力。修订继承已有可见性、敏感度、保留及过期权限；删除先持久化删除标记再清除，重启后仅从精确待处理标记恢复清除。随后仅投影候选 pending/promoted、持久记忆 active/conflict/expired/purge/deleted 状态与精确修订/最新版本。作用域会话、权限策略/操作人/摘要、不透明能力、原始输出、本地路径和已删除文本不离开主进程。 |
| Agent 记忆的团队投影 | `agent-memory-summary` 同步队列 → `/api/sync/agent-memory-summary` → `agent_memory_summaries` / `agent_memory_projection_audits` | `real IPC/API` + `local/Team persisted` | 主进程从当前团队范围的生命周期、权威 Run/Node、来源运行时与已接受上下文重建严格的纯元数据投影；同步队列仅保存记忆 ID。Seed/Postgres 固定作用域，分别单调校验生命周期 `headVersion` 与已接受上下文的 `qualityVersion`；同一最新版本的质量推进写入复合审计键。Web 只读展示引用/已接受上下文计数、修订、生命周期、可见性、敏感度和保留期，不能提升、修订、删除、清除、重建或继续运行。文本、内容摘要、作用域会话、路径、提示词、推理、凭据和原始输出绝不跨边界。 |
| Agent 协调的团队投影 | `agent-coordination-summary` 同步队列 → `/api/sync/agent-coordination-summary` → `agent_coordination_summaries` / `agent_coordination_projection_audits` | `real IPC/API` + `local/Team persisted` | 主进程从精确的持久化协调会话 ID 重建严格的纯元数据投影；每次协调版本变化在同一事务合并仅含 ID 的同步任务。Seed/Postgres 固定精确团队项目、Run、Node、会话作用域，仅接受不可变的图与角色结构、同版本精确重放，或更高版本的单调计数。Web 只读展示任务、状态、失败、交接、质量、费用、延迟和干预计数；不能创建、启动、指派、重试、继续、取消、租约操作或签发工具授权，也不能读取本地上下文、能力、资源、路径、补丁、提示词或输出。 |
| 权限请求传递 | `CodingPermissionRequest[]` 与审批决定 | `real IPC/API` + `local persisted` | 已有 IPC；继续补充真实界面状态。 |
| 差异预览 | `CodingDiffArtifact[]` | `local persisted` | 已可展示。 |

<a id="tests"></a>

## 测试

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 测试命令 | `LocalProject.testCommand` + `saveProjectTestCommand` | `real IPC/API` + `local persisted` | 保持命令安全校验。 |
| 命令安全 | `validateTestCommand`，浏览器回退使用共享校验器 | `real IPC/API` | 优先使用 Electron；浏览器回退必须明确标注仅为预览。 |
| 测试执行 | `runProjectTests` | `real IPC/API` | 真实执行只在 Electron 边界内。 |
| 证据列表 | `TestEvidence[]` | `local persisted` | 已可由真实测试结果驱动。 |
| 已跳过的测试证据 | 共享结构当前未定义 | `missing contract` | 单独列为契约变更，不混入界面真实化。 |

<a id="knowledge"></a>

## 知识

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| Git Markdown 索引 | `knowledgeDocuments` 内置共享索引 | `fixture fallback` / `desktop-only adapter` | 界面必须标识其为共享索引，不伪装成任意仓库实时索引。 |
| Run 引用 | `buildKnowledgeReferences` 从 Run/Artifact/TestEvidence 计算 | `desktop-only adapter` | 当前可用；真实仓库来源查询仍待契约设计。 |
| 知识图谱 | `knowledgeEntities` / `knowledgeRelations` 内置数据 | `fixture fallback` | 若要读真实仓库图谱，需要新增知识源查询契约。 |
| 来源定位高亮 | `supportContext.documentId/referenceId` | `desktop-only adapter` | 已支持检查器与搜索的深层链接。 |

<a id="team"></a>

## 团队

| UI 字段 | 当前来源 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 团队项目、成员和费用 | `loadRemoteSnapshot`；无远端数据时回退到种子数据 | `real IPC/API` + `fixture fallback` | 同步后显示快照与合并摘要。 |
| 策略快照来源与版本 | `loadEnforcementPolicy` / `policy_snapshots` | `real IPC/API` + `local persisted` | 继续展示来源、版本与同步时间。 |
| Gate 重新评估摘要 | `evaluateGateEnforcement` 的决策 | `real IPC/API` | 当前只针对选中的 Run/Node；批量历史需要新契约。 |
| 权威 Run 同步 | 主进程从本地存储读取 Run/当前节点，生成白名单摘要 | `real IPC/API` | 渲染进程无上传接口；只有原认证同步创建者可更新。Run 摘要独占状态/当前节点推进权，并收敛旧活动节点；子摘要不能推进或合成 Run。 |
| 关联摘要同步 | 从权威本地测试、审查、编码对象生成子摘要 | `real IPC/API` + `local persisted` | 先同步子摘要；`remote_sync_outbox` 持久化纯元数据操作、租约、退避、失败与显式恢复。ID 固定绑定组织、项目、Run、Node；重新绑定返回 409；迟到子记录不能激活旧节点。 |
| Agent 运行时的团队投影 | `agent-runtime-summary` 同步队列 → `/api/sync/agent-runtime-summary` → `agent_runtime_summaries` / `agent_runtime_projection_audits` | `real IPC/API` + `local persisted` | 仅团队范围运行时可上传；Seed/Postgres 校验权威 Run/Node、固定作用域、严格单调版本与终态不可变性。团队侧不能继续执行、注入工具结果、签发能力或推进工作流。 |
| 远端策略发现 | 脱敏 Agent 审查的 `policyFindings` | `real IPC/API` + `local persisted` | 保留重建精确阻断项 ID 所需的最小明细；拒绝仅含计数的载荷。本地证据/引用 ID 和敏感文本不进入团队读取模型。 |
| Gate 例外审批同步 | 主进程提交仅含标识和理由的例外审批；远端快照回传已接受审计 | `real IPC/API` + `local persisted` | 独立 Lead 不重传由创建者拥有的 Run。API 规范化 Postgres 节点命名空间，重新计算精确阻断项与策略；持久审计恢复带命名空间的外键，同作用域幂等更新保持该命名空间。 |
| GitHub App 仓库绑定 | Owner 管理的 API 路由与 Postgres 绑定、版本、撤销状态 | `real IPC/API` | API 验证安装、仓库和默认分支；私钥不进入 Postgres、桌面端或渲染进程。 |
| 交付请求与审批 | 脱敏请求与不可变签名 Web 审批 | `real IPC/API` | 桌面 Bearer 权限不能审批自身请求；审批精确绑定仓库绑定、交付系列/尝试/修订、提交与证据摘要。 |
| 凭据、发布与草稿 PR | API 凭据授权、桌面发布报告、API 远端核验与 PR 结果 | `real IPC/API` + `local persisted` | Electron 主进程仅在内存短暂使用限定仓库的令牌。Team schema v21 保留提供方确认的过期时间、观测时间、契约版本、提供方有界重试最早时间，以及已核实发布的采用来源；不持久化令牌、请求头或响应正文。API 独立确认远端提交后创建或核对一个草稿 PR。同系列后续已批准尝试仅在前次已核实发布、但草稿阶段失败时采用该证据，避免重复获取凭据和推送。 |
| 快照历史 | 当前只保留最新快照 | `missing contract` | 后续单独设计历史查询契约。 |

<a id="browser-preview-boundary"></a>

## 浏览器预览边界

浏览器 Vite 预览不能访问 Electron IPC、本地 SQLite、本地测试执行、系统凭据存储或本机工作树。预览模式只用于界面回退展示和演示，必须显示 `browser preview` 或 `seed fallback`；Agent、Gate、Test、PR、Acceptance 工作流推进会失败关闭。桌面端才是完整真实运行边界。

Team API 默认不接受未签名 `x-devflow-*` 身份头，CORS 也不放行这些请求头。仅本机命令行和冒烟测试可显式设置 `DEV_AUTH_ENABLED=true`，且带 `Origin` 的请求仍会被拒绝；生产写入使用签名 Cookie 或配对后的 Bearer Token。

<a id="后续合同变更候选"></a>

## 后续契约变更候选

- 知识源查询与索引：按当前本地仓库实时扫描 Markdown/图谱。
- 策略快照历史：查询历史快照与每次同步的 Gate 重新评估记录。
- TestEvidence `skipped`：需要同时变更共享结构、API 摘要、本地存储和界面状态。
- 批量 Gate 重新评估：团队页汇总多个 Run/Node 的评估结果。
