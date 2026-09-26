<a id="context"></a>

# 项目上下文与术语

<a id="organization-and-membership"></a>

## 组织与成员关系（Organization and Membership）

组织是团队项目、策略、预算、身份和脱敏投影的租户边界。同一个已验证的登录账户可以在多个组织中分别拥有用户身份和有效的成员关系。角色及项目访问权属于各自的成员关系，不是账户全局属性。带签名的浏览器会话选择一个组织；桌面凭据始终绑定一个组织和项目，直到用户明确重新配对。归档组织会保留记录，同时停止业务访问并撤销其桌面凭据。参见 ADR 0023。

<a id="run"></a>

## 工作流实例（Run）

一次 AI 辅助交付尝试，从任务请求开始，依次经过需求澄清、方案设计、开发、测试、拉取请求和业务验收。

<a id="delivery-workflow"></a>

## 交付工作流（Delivery Workflow）

Run 的六阶段流程：需求澄清、方案设计、开发实现、测试证据、受控的拉取请求交付，以及业务验收。

<a id="node"></a>

## 节点（Node）

Run 内的执行或审查单元，可以表示 Agent 工作、人工门禁、测试、拉取请求创建或验收步骤。

<a id="workbench-conversation"></a>

## 工作台独立会话（Workbench Conversation）

保存在本地、以项目为范围的会话，拥有独立的消息、问题和输入草稿。它可以调查该本地项目内任意 Run 或节点；当前选中的卡片不会限制会话的权限或上下文。最新工作流状态和已保存产物是共享查询来源。旧版手工笔记仍可查看，但不可编辑，也不会进入模型提示；新需求通过正常聊天表达。会话内容不进入 `LocalExecutionState`，也不参与团队同步。

DeepSeek 会话启用低强度思考。服务商返回的推理内容流式写入独立的本地会话记录；它不是最终回答、共享证据或持久 Agent 记忆，也不会加入后续会话提示或其他会话。最终回答和导航动作仍来自经过验证的结构化 `content` 响应。

会话上下文包含作用域内的原始需求正文，而非仅有摘要，并附带来源、版本和明确的续读范围。其他产物保留索引，按需读取。模型返回无效结构时，每轮最多重新生成一次，仍受既有调用次数和时间限制；两次调用都保留实际返回的用量。恢复过程不会发布提案或推进工作流。

<a id="conversation-proposal"></a>

## 会话提案（Conversation Proposal）

私有会话中的草稿，只有在用户明确将其保存到已有节点后，才成为共享、待确认的 `log` 类型产物。它可以作为下一次正式阶段生成的参考，但不能完成节点、批准 Gate，或替代不可变的阶段产物。

<a id="gate"></a>

## 门禁（Gate）

人工决策点，用于检查当前阶段是否已有足够证据，可以进入风险更高的下一阶段。

<a id="team-role"></a>

## 团队角色（Team Role）

产品的角色值严格限定为 `owner`、`lead` 和 `member`，不存在隐含的 `viewer` 角色。成员是权限最低的项目参与者；所有读取仍须按有效的组织及项目成员关系过滤。角色顺序用于普通项目访问和 Gate 要求，但不构成通用的越权层级：部分预算、策略和职责分离操作明确要求无利益冲突的 `lead`，因此 `owner` 也不能绕过这些检查。桌面 Bearer Token 固定绑定一个配对项目，最多具有 `lead` 权限，即使在浏览器中发起配对的人是组织所有者。

<a id="clarification-gate"></a>

## 需求确认门禁（Clarification Gate）

审查需求澄清是否足够完整、能否进入方案设计的 Gate。

<a id="solution-review-gate"></a>

## 方案评审门禁（Solution Review Gate）

审查设计方案是否足够完整、能否进入开发实现的 Gate。

<a id="artifact"></a>

## 产物（Artifact）

Run 或节点生成的持久材料，例如需求说明、设计文档、代码差异、测试报告、日志或拉取请求摘要。

<a id="requirement-decomposition-artifact"></a>

## 需求拆解产物（Requirement Decomposition Artifact）

将用户故事或需求拆解为领域语言、技术引用、假设和后续工作时生成的可审查产物。必须通过 Gate，才能作为可复用的团队知识。

<a id="pr-delivery-package"></a>

## PR 交付包（PR Delivery Package）

仅含元数据的交接产物，汇总原始请求、设计方案、变更路径、测试证据、策略状态和审查上下文。GitHub 交付可以使用其标题、正文和证据引用，但交付包不提供代码、仓库身份、分支操作权限或凭据。

<a id="github-repository-binding"></a>

## GitHub 仓库绑定（GitHub Repository Binding）

团队项目中的非机密记录，将一个项目绑定到经过验证的 GitHub App 安装、仓库、默认分支和绑定版本。所有者通过 Web 配置或撤销绑定。API 从 GitHub 查询仓库事实，不信任渲染进程提供的名称。

<a id="github-delivery"></a>

## GitHub 交付（GitHub Delivery）

V1.5 引入的受控交付路径：将规范受管工作树中的一个预期提交发布到获批的 `devflow/` 分支，并创建或核对一个草稿拉取请求。它需要独立的、带签名的 Web 审批，不会合并、强制推送、删除分支、发布标签，也不会让 GitHub 成为本地 Run 的权威状态来源。

<a id="delivery-series"></a>

## 交付系列（Delivery Series）

在同一仓库绑定下，从同一个受管工作区交付同一 Run/PR 目标时使用的稳定身份。重新绑定仓库后，只有向当前配对认领者证明前一个远端请求已经终结，才能创建新系列。

<a id="delivery-attempt"></a>

## 交付尝试（Delivery Attempt）

交付系列中的一次不可变发布尝试。只有证明对应的远端前序尝试已处于 `failed` 或 `revoked` 状态，才允许重试；重试会创建下一次尝试、新请求和新幂等键。已完成的尝试不会重新开启。

<a id="delivery-intent"></a>

## 交付意图（Delivery Intent）

桌面的不可变本地记录，绑定受管工作区、预期提交、仓库绑定、Run/节点/版本、测试证据、变更路径和 PR 交付包摘要。发布前若材料发生实质变化，使用修订操作在同一系列和尝试内创建新的意图版本，并使旧审批失效。

<a id="delivery-request"></a>

## 交付请求（Delivery Request）

交付意图在 API/Postgres 中的脱敏投影。它受配对项目和当前认领者范围约束，持久记录审批、发布、恢复和草稿拉取请求状态，不包含本地路径、原始输出、补丁、源码或凭据。

<a id="delivery-approval"></a>

## 交付审批（Delivery Approval）

`lead`/`owner` 通过带签名的 Web 会话，针对一个明确的交付请求版本作出的不可变决定。桌面 Bearer 权限不能审批自身请求；材料、尝试或绑定改变后，需要重新审批。

<a id="github-delivery-recovery-action"></a>

## GitHub 交付恢复操作（GitHub Delivery Recovery Action）

操作者明确选择的修订（Revise）、继续（Resume）、重试（Retry）或停止（Stop）动作。修订替换发布前发生变化的材料；继续恢复同一次 `recovery_required` 尝试；重试仅在远端终结状态得到权威确认后创建新尝试；停止暂停指定的活动尝试，交由人工恢复。后台调度不能悄悄代替用户作出这些决定。

<a id="github-delivery-completion"></a>

## GitHub 交付完成（GitHub Delivery Completion）

持久化的脱敏证据，证明预期提交确实是远端分支头，且对应的拉取请求仍为草稿。只有这份证据可以让 PR 节点向业务验收推进；它从不授权合并。

<a id="skill"></a>

## 技能（Skill）

可复用的团队能力，用于定义流程方法、提示策略、知识读取规则或审查清单。

<a id="mcp-server"></a>

## MCP 服务（MCP Server）

Agent 在 Run 期间可以调用的本地或远程工具连接器，受团队策略和开发者本地配置约束。

<a id="knowledge-base"></a>

## 知识库（Knowledge Base）

由团队维护、以 Git 和 Markdown 为来源的可复用标准、模板、决策、示例、项目上下文和术语表。

<a id="knowledge-repository"></a>

## 知识仓库（Knowledge Repository）

由 Git 管理的知识仓库，通过标准、领域术语、关系和来源引用，将一个团队知识底座连接到多个代码仓库。不要将其称为“代码仓库管理器”。

<a id="code-repository"></a>

## 代码仓库（Code Repository）

知识仓库关联的源码仓库。它仍是实现的来源；从中提炼出的可复用理解则成为仓库衍生知识。

<a id="repository-derived-knowledge"></a>

## 仓库衍生知识（Repository-Derived Knowledge）

从一个或多个关联代码仓库中总结出的、可审查的系统或业务知识，存入知识仓库，用于后续检索、审查和 Gate 证据。

<a id="candidate-knowledge"></a>

## 候选知识（Candidate Knowledge）

已经提取或总结、但尚未通过审查的仓库衍生知识。它可以辅助分析，但不能作为权威 Gate 证据。

<a id="confirmed-knowledge"></a>

## 已确认知识（Confirmed Knowledge）

已经通过审查的仓库衍生知识，可作为需求澄清、方案设计、知识审查和 Gate 决策的权威参考。

<a id="system-knowledge"></a>

## 系统知识（System Knowledge）

解释技术结构、系统边界、服务、接口、数据模型、依赖或实现约束的仓库衍生知识。

<a id="business-knowledge"></a>

## 业务知识（Business Knowledge）

解释业务术语、规则、用户流程、领域假设或业务概念间关系的仓库衍生知识。

<a id="team-knowledge-foundation"></a>

## 团队知识底座（Team Knowledge Foundation）

为 AI 辅助交付提供团队标准、领域语言、可检索引用和关系上下文的共享知识层。中文展示材料统一使用“团队知识底座”，避免使用“实时库”“知识频率”等误译。

<a id="knowledge-domain"></a>

## 知识领域（Knowledge Domain）

团队知识底座中的领域视图，例如前端、后端或数据库知识。领域用于组织可复用知识，不将其拆成彼此孤立的知识库。

<a id="knowledge-source-file"></a>

## 知识源文件（Knowledge Source File）

仓库中的 Markdown 文件，是团队标准、清单、ADR、契约、入门说明、Skill 规则或 MCP 规则的可审查权威来源。

<a id="knowledge-document"></a>

## 知识文档（Knowledge Document）

知识源文件的索引表示，包括标题、分类、摘要、标签、所有者、来源路径和 Markdown 正文。

<a id="knowledge-chunk"></a>

## 知识片段（Knowledge Chunk）

知识文档中按章节切分的片段，可以独立检索和引用，同时仍指向原始 Markdown 来源。

<a id="knowledge-graph"></a>

## 知识图谱（Knowledge Graph）

从知识库和 Run 产物中提取的轻量关系层，连接术语、系统、决策、任务、产物和所有者。

<a id="knowledge-retrieval"></a>

## 知识检索（Knowledge Retrieval）

为 Run、节点、产物、测试证据或 Gate 决策寻找相关知识片段的过程。检索推荐参考材料，不判断标准是否已经满足。

<a id="knowledge-retrieval-hit"></a>

## 知识检索命中（Knowledge Retrieval Hit）

带评分的检索结果，说明哪个知识片段匹配工作流上下文，以及匹配原因。

<a id="knowledge-citation"></a>

## 知识引用（Knowledge Citation）

从 Agent 回答或观察结果指向当前知识片段的精确、可检查链接。它绑定文档、片段、源文件相对路径、标题、内容哈希、知识快照、检索策略和排名来源。引用属于上下文，本身不会变成治理证据。

<a id="retrieval-evaluation-corpus"></a>

## 检索评估语料（Retrieval Evaluation Corpus）

经过版本管理、可以审查的一组人工构造材料，包括知识、作用域查询、相关及禁止命中的片段身份、引用预期、记忆测试数据和指标阈值。它以确定性方式比较词法基线与候选检索器，记录检索质量、引用忠实度、延迟及隔离结果；默认不调用付费服务商。

<a id="memory-candidate"></a>

## 记忆候选（Memory Candidate）

从已接受、可观察的 Agent 结果提出的有限陈述，默认不生效。它具有明确的范围和来源，只有 Electron 主进程负责的策略及操作者权限将其提升后，才能作为持久记忆检索。

<a id="durable-agent-memory"></a>

## 持久 Agent 记忆（Durable Agent Memory）

已提升、不可变且限定范围的记忆版本，可供之后的 Agent 会话召回。它记录可见性、来源摘要、保留规则、过期时间、敏感性和审计元数据。Agent 记忆不是工作流状态、Agent 检查点、仓库知识、隐藏推理或治理证据。

<a id="coding-context-receipt"></a>

## 编码上下文回执（Coding Context Receipt）

为一次 Coding Run 准备的任务简报所对应的不可变本地记录，绑定 Run/节点版本、操作者/配对范围、选中的记忆版本及其头部/内容摘要、简报准确的 SHA-256，以及抽取式压缩回执。它证明来源，不提供权限，也不能证明任务正确。Native Coding 和 OpenCode 在继续前都会重新核验来源。没有回执的历史运行不得声称使用过记忆。参见 ADR 0021。

<a id="context-compaction"></a>

## 上下文压缩（Context Compaction）

在 UTF-8 字节预算内，以确定性方式缩减历史材料。当前请求、用户指令、召回记忆、处理建议和最新测试诊断不可拆分。过长原文由产物摘要和可识别的显式约束行替代。回执记录每份来源的表示方式和大小。必要内容放不下时，在调用服务商之前停止执行。这是抽取式压缩，不是语义概括。

<a id="memory-revision"></a>

## 记忆版本（Memory Revision）

持久 Agent 记忆的一个不可变版本。更新时必须指定准确的当前版本，并创建通过 `supersedes` 关联的新版本；冲突版本明确保留，不采用静默的后写覆盖。记忆可见范围取交集，不能通过回退扩大范围。

<a id="memory-tombstone"></a>

## 记忆删除标记（Memory Tombstone）

针对一个持久记忆身份的单调删除记录。它将所有版本排除出检索，驱动衍生索引条目的清理，在重启和过期同步重放后仍有效，旧记录不能把它恢复为有效记忆。

<a id="knowledge-reference"></a>

## 知识关联（Knowledge Reference）

Run、节点、产物、测试证据或 Gate 决策与知识文档之间的关系，可以表示引用、满足标准、需要证据或违反标准。

<a id="knowledge-governance-check"></a>

## 知识治理检查（Knowledge Governance Check）

面向审查者的摘要，说明当前选中节点是否有足够证据满足适用标准。v0.4 展示这些检查；后续版本可对其实施强制约束。

<a id="agent-review-artifact"></a>

## Agent 审查产物（Agent Review Artifact）

知识审查 Agent 生成的持久报告，汇总选定 Run/节点的风险、缺失证据、建议测试、知识引用、模型置信度和门禁建议。

<a id="knowledge-review-agent"></a>

## 知识审查 Agent（Knowledge Review Agent）

由 DevFlow 管理的审查 Agent，根据团队知识、证据和策略上下文评估需求或工作流节点。它评审交付准备情况，不编写代码。

<a id="agent-trace"></a>

## Agent 审查轨迹（Agent Trace）

可审计的审查步骤记录，包括上下文准备、附加检索结果、调用服务商和创建产物。轨迹解释审查如何形成，不暴露私有本地路径或原始命令输出。

<a id="agent-runtime"></a>

## Agent 运行时（Agent Runtime）

当工作依赖工具、MCP 或编码执行器的观察结果时，由 DevFlow 管理的有界循环：观察、决策、行动、验证、评估、保存检查点和停止。确定性工作流仍掌握 Run 状态、策略、证据接纳和人工 Gate 的权威。Agent 运行时不能推进节点、批准 Gate、发布、合并或扩大自身能力。

<a id="agent-trajectory"></a>

## Agent 执行轨迹（Agent Trajectory）

按顺序记录、可审计的运行时外部可观察事件，例如附加上下文、观察、请求动作、权限决定、工具或执行器结果、评估、检查点和终结结果。它使用有界摘要和内容摘要，不会在团队可见状态中声称或保存隐藏推理、私有草稿、原始提示、源码、补丁、stdout/stderr、凭据或本地绝对路径。

<a id="agent-checkpoint"></a>

## Agent 检查点（Agent Checkpoint）

带版本且原子持久化的续行边界，将一次 Agent 运行时绑定到准确的 Run/节点版本、上下文和能力集合摘要、本地项目、已接受结果、序号、截止时间，以及已消耗和剩余限额。恢复时重新验证权限，并使用乐观并发控制；不能倒退或把已接受的副作用作为新动作重放。

<a id="agent-stop-reason"></a>

## Agent 停止原因（Agent Stop Reason）

有界运行时明确的终结原因：成功、失败、取消、超时、达到步骤上限、预算耗尽或策略拒绝。Agent 成功会产生可审查证据，但成功本身不是工作流状态迁移或 Gate 决策。

<a id="coordination-session"></a>

## 协调会话（Coordination Session）

由 Electron 主进程管理的有界容器，包含一个监督 Agent、固定的任务图，以及允许启动的少量专职 Agent 运行时。它绑定准确的 Run/节点权限、执行租户范围、上下文摘要、共享限额、已接受交接和终结结果。协调会话不能推进工作流状态、批准 Gate 或发布。

<a id="supervisor-agent"></a>

## 监督 Agent（Supervisor Agent）

协调会话中唯一可以将就绪任务分配给已接受的专职 Agent、汇总其有界结果、归因失败并停止会话的 Agent。它可以收窄既有权限，不能创造工具、工作流、Gate、凭据、仓库或交付权限。

<a id="specialist-agent"></a>

## 专职 Agent（Specialist Agent）

为一个明确任务节点和角色选定的有界 Agent 运行时。其范围、能力、上下文、截止时间和预算都是协调会话的严格子集。专职 Agent 不能创建其他 Agent 或向其委派，也不能写入明确租用资源之外的位置。

<a id="agent-task-graph"></a>

## Agent 任务图（Agent Task Graph）

带版本的有向无环图，由有界任务节点和依赖边构成，在专职 Agent 产生副作用之前固定。只有所有依赖都有已接受的终结结果，节点才会就绪。遇到环、未知依赖、无界分支扩张、重复所有权或模型修改任务图时，一律拒绝继续。

<a id="agent-handoff"></a>

## Agent 交接（Agent Handoff）

从一个明确的任务/运行时版本到另一个版本的不可变元数据传递，携带范围、结果、证据、上下文和资源摘要，以及允许列表内的概述；不包含隐藏推理、源码、补丁、提示、stdout/stderr、凭据或绝对路径。接收方在接受前重新检查当前范围和权限。

<a id="execution-tenancy"></a>

## 执行租户隔离（Execution Tenancy）

隔离契约将每个协调、任务、专职 Agent、能力授予、资源租约、检查点、交接和审计，绑定到其所属的准确组织、项目、用户、会话、本地项目、Run/节点和协调身份。核心规则是：范围、能力和预算均取交集，绝不通过回退扩大。跨租户标识符不能泄露数据或授予执行权限。

<a id="tool-definition"></a>

## 工具定义（Tool Definition）

主进程管理、带版本的可执行能力描述，包含严格的输入/输出结构、权限及副作用类别、截止时间、取消、大小限制、幂等策略和审计/脱敏规则。模型只能选择当前运行时已经接受的工具。

<a id="tool-capability-grant"></a>

## 工具能力授予（Tool Capability Grant）

由 Electron 主进程发放、不可解析且短期有效的授权，针对一个有界工具或 MCP 能力。它绑定运行时、组织、项目、用户、会话、本地项目、工具身份/版本、权限、资源范围、过期时间、剩余调用次数和预算。文本、渲染进程输入及团队元数据均不能伪造或扩大它。

<a id="local-mcp-installation"></a>

## 本地 MCP 安装（Local MCP Installation）

由 Electron 主进程管理、仅存在于桌面的授权记录，批准一个已验证的 MCP 可执行文件，并固定参数、本地 stdio 传输、环境变量名称允许列表、身份、截止时间、启用状态和版本。团队 MCP 元数据不构成本地执行权限，不能创建、修改、启用或调用该安装。

<a id="coding-executor"></a>

## 编码执行器（Coding Executor）

对限定范围的仓库读取/修改、获批命令/测试、权限事件、取消和结构化代码差异/测试证据实施治理的边界。OpenCode 是首个外部执行器；V2.0 在相同契约后增加了一个能力范围较窄、由 DevFlow 管理的 Coding Agent。执行器不拥有工作流、Gate 或交付权限。

<a id="coding-executor-capability"></a>

## 编码执行器能力（Coding Executor Capability）

选择执行器前声明的带版本功能，例如受管工作区读写、获批测试执行、权限转发、取消、检查点续行或结构化差异/测试证据。缺少能力会导致确定性的选择拒绝，不能通过提示要求执行器超出能力描述行事。

<a id="agent-evaluation-scenario"></a>

## Agent 评估场景（Agent Evaluation Scenario）

带版本、可复现的测试场景，固定初始上下文、允许能力、预期轨迹、限额、停止原因、证据、清理，以及质量、成本、延迟、人工干预、恢复和隔离指标，用于比较 Agent 运行时或编码执行器路径。

<a id="tool--skill-trace"></a>

## 工具与技能轨迹（Tool / Skill Trace）

Coding Agent 运行时间线，汇总有权限依据的工具活动、opencode 在可用时暴露的 Skill 元数据、DevFlow 权限转发决定和脱敏状态。它说明 DevFlow 实际观察到了什么，不声称重建 opencode 私有的内部 Skill 调用栈。

<a id="team-pilot-foundation"></a>

## 团队试点基础（Team Pilot Foundation）

v1.0 产品里程碑：DevFlow 从本地优先的项目展示工作台走向自托管团队试点。最低验证范围包括 GitHub 登录、项目创建、桌面配对、经身份认证的脱敏同步，以及小团队的 Web 可见性。

<a id="authenticated-session"></a>

## 已认证会话（Authenticated Session）

API 在服务端根据真实用户身份和项目成员关系解析出的会话。它不同于种子数据、测试和本地演练使用的显式演示会话。

<a id="user"></a>

## 用户（User）

组织中某个人的团队侧身份记录，是成员关系授权的数据来源，也可以投影为旧版团队成员界面卡片。

<a id="auth-account"></a>

## 登录账户（Auth Account）

与 DevFlow 用户关联的外部登录账户，例如 GitHub 账户。它保存身份提供方的身份元数据，不能与用于模型调用的本地服务商凭据混淆。

<a id="desktop-pairing"></a>

## 桌面配对（Desktop Pairing）

将 Electron 桌面客户端连接到团队项目的一次性流程。Web 发放短期配对码，桌面用它换取限定范围的令牌，后续同步使用该令牌，不再使用演示请求头。

<a id="self-hosted-pilot"></a>

## 自托管试点（Self-Hosted Pilot）

面向小团队、最低限度可部署的 v1.0 技术栈：通过 Docker Compose 运行 Web、API 和 Postgres，具有明确配置、迁移/种子数据初始化、桌面配对和经认证的脱敏同步。它证明团队连接能力，不代表已具备公共 SaaS、托管服务、自动 HTTPS 或生产发布打包能力。

<a id="gate-advisory"></a>

## 门禁建议（Gate Advisory）

Agent 审查后向 Gate 审查者展示的建议。v0.5 仅提供警告；从 v0.7 开始，建议可以进入门禁执行策略，但默认仍只警告，除非团队明确启用阻断策略。

<a id="gate-enforcement-policy"></a>

## 门禁执行策略（Gate Enforcement Policy）

团队可配置的规则，决定 Gate 审批应通过、警告、阻断、强制阻断还是要求同步策略。策略评估同时考虑确定性的知识治理检查和概率性的 Agent 策略发现。

<a id="policy-aware-delivery"></a>

## 策略感知交付（Policy-Aware Delivery）

根据策略结果、知识标准、证据缺口和人工 Gate 决策，确定下一步推荐开发动作的交付模式；它保留人工审批。

<a id="remediation-plan"></a>

## 处理建议（Remediation Plan）

面向审查者的一组建议动作，用于处理警告或被阻断的 Gate，例如运行知识审查、补充测试证据、更新 API 契约或重试 Coding Agent 任务。

<a id="retry-attempt"></a>

## 重试尝试（Retry Attempt）

经人工批准，利用已有 Run 的策略上下文、处理建议、证据和先前 Agent/Coding 历史，重新执行或继续工作的尝试。

<a id="policy-aware-delivery-summary"></a>

## 策略感知交付摘要（Policy-Aware Delivery Summary）

面向管理者的脱敏汇总，包括警告、阻断、例外批准、处理建议、重试和证据缺口数量。不包含本地路径、原始日志、提示、补丁或服务商密钥。

<a id="policy-floor"></a>

## 组织策略底线（Policy Floor）

组织级别为执行规则设定的最低要求。项目覆盖配置可以使规则更严格，但不能削弱组织底线。

<a id="protected-gate"></a>

## 受保护门禁（Protected Gate）

可能要求强制策略检查的人工决策节点。当前模型中，节点 `kind` 为 `gate` 或 `acceptance` 时属于受保护门禁。

<a id="agent-policy-finding"></a>

## Agent 策略发现（Agent Policy Finding）

知识审查 Agent 为策略评估输出的标准化发现。它具有概率性；只有明确策略才能赋予警告或阻断效果，绝不能造成强制阻断。

<a id="gate-override-decision"></a>

## 门禁例外决定（Gate Override Decision）

允许被阻断 Gate 继续推进、可审计的 `lead` 决定。例外必须说明理由，不能由 Run 创建者或选中节点的所有者执行，也不能覆盖强制阻断。

<a id="policy-snapshot"></a>

## 策略快照（Policy Snapshot）

桌面缓存的门禁执行策略包。团队项目离线时使用最近的权威缓存快照；纯本地项目使用内置的仅警告默认策略。

<a id="provider-credential"></a>

## 服务商凭据（Provider Credential）

Agent 服务商使用的机密信息。Electron 通过桌面凭据边界保存密钥，只向渲染进程返回掩码元数据。API 保存加密的密钥，也只返回掩码元数据。

<a id="agent-provider"></a>

## Agent 服务商（Agent Provider）

将脱敏审查上下文转换为结构化审查输出的运行依赖。DevFlow 支持用于测试的确定性模拟服务商，以及需要显式启用真实调用的 OpenAI 兼容服务商。

<a id="coding-agent-adapter"></a>

## 编码 Agent 适配器（Coding Agent Adapter）

DevFlow 承载 opencode 等外部编码引擎的边界。在这条外部适配路径中，DevFlow 不重建引擎核心，而是负责上下文组装、权限转发、工作树管理、证据采集、测试和适合团队共享的摘要。当前工作流中，Coding Agent 动作只能从开发阶段的任务节点启动。模拟引擎是自动化验证的确定性默认选项；真实 opencode HTTP 引擎通过环境配置启用，在足够稳定、能够成为默认编码引擎之前，采用人工冒烟测试。V2.0 增加的原生执行器仍遵循上文的编码执行器契约。

<a id="external-coding-engine"></a>

## 外部编码引擎（External Coding Engine）

opencode 或 OpenCode 等外部 Agent 运行时，在编码 Agent 适配器后执行代码编写工作。在这条路径中，DevFlow 使用外部能力，而非实现自己的编码引擎核心。

<a id="coding-agent"></a>

## 编码 Agent（Coding Agent）

通过受管适配器、权限转发和工作树修改源码的执行路径。它实现已经批准的工作，不取代知识审查。

<a id="managed-coding-workspace"></a>

## 受管编码工作区（Managed Coding Workspace）

由 Electron 主进程为每次 Coding Agent Run 创建的 Git 工作树和分支。它将修改与开发者主检出目录隔离，但不是安全沙箱。

<a id="dependency-bootstrap"></a>

## 依赖初始化（Dependency Bootstrap）

测试前为受管工作树准备依赖的可见步骤。基于锁文件的安装可执行固定命令；未锁定依赖的安装需要人工批准。

<a id="permission-relay"></a>

## 权限转发（Permission Relay）

DevFlow 居中处理编码引擎工具请求的路径，例如 edit、bash、write、patch、install 或外部目录访问。超时前无人回应时，DevFlow 默认拒绝。

<a id="coding-diff-artifact"></a>

## 编码差异产物（Coding Diff Artifact）

本地产物，包含受管编码工作区内发生变化的仓库相对路径，以及经过脱敏和大小限制的代码差异。团队后端仅接收脱敏摘要，不接收原始补丁。

<a id="token-usage"></a>

## Token 用量（Token Usage）

针对 Run、节点、成员、项目或模型服务商测得的模型用量。

<a id="runtime-cost-summary"></a>

## 运行成本摘要（Runtime Cost Summary）

Coding Agent 运行的脱敏费用摘要，记录服务商、模型、估算或服务商返回的 Token 用量、费用和来源，不保存原始提示、cwd、stdout/stderr、补丁正文或服务商密钥。

<a id="runtime-budget-guard"></a>

## 运行预算检查（Runtime Budget Guard）

调用服务商前，将预期 Coding Agent 运行成本与团队项目预算比较的策略检查。在调用真实服务商之前，它可以允许、警告、要求负责人审批，或接受已有的负责人审批。

<a id="runtime-budget-approval"></a>

## 运行预算审批（Runtime Budget Approval）

可审计的 `lead` 审批，在限定费用和时间窗口内，允许指定申请者执行超过项目配置预算的真实服务商任务。

<a id="local-project"></a>

## 本地项目（Local Project）

开发者在本机选择、用于本地执行的仓库目录，包含测试命令、检测到的包管理器等仅供本地使用的配置。

<a id="local-execution"></a>

## 本地执行（Local Execution）

桌面客户端在开发者机器上执行的工作，例如运行项目测试命令并采集证据。本地执行与团队同步状态分开管理。

<a id="test-evidence"></a>

## 测试证据（Test Evidence）

一次本地测试执行的持久记录，包括命令、工作目录、结果状态、耗时和脱敏输出。

<a id="data-origin"></a>

## 数据来源（Data Origin）

应用展示数据的来源类别：`seed` 表示测试/演示数据，`local` 表示 Electron SQLite 状态，`remote` 表示经过认证的 API/Postgres 团队状态，`adapter` 表示外部执行引擎的投影，例如 OpenCode Coding Agent 结果。

<a id="local-settings"></a>

## 本地设置（Local Settings）

开发者机器上保存在 Electron SQLite 中的偏好，例如主题和本地 MCP 界面状态。没有 Electron preload API 时，浏览器预览仍可回退到 localStorage。

<a id="remote-state"></a>

## 远端状态（Remote State）

由 API/Postgres 管理的团队共享状态，包括身份、项目、脱敏 Run 投影、策略、预算、协作命令、仓库绑定、交付请求、审批、审计和管理摘要。远端状态不掌握本地源码执行或完整的本地证据。

<a id="cross-platform-desktop"></a>

## 跨平台桌面（Cross-Platform Desktop）

要求 Electron 客户端同时支持 macOS 和 Windows。Windows 11 是主要 Windows 目标；Windows 10 尽力兼容。

<a id="windows-compatibility"></a>

## Windows 兼容性（Windows Compatibility）

产品约束：本地执行、SQLite 持久化、路径处理、命令安全和冒烟测试不能只假设 macOS 行为。

<a id="platform-safe-local-execution"></a>

## 平台安全的本地执行（Platform-Safe Local Execution）

通过跨平台 Node/Electron API 实现本地执行，例如 `path`、`os.tmpdir()`、带明确 `cwd`/`env` 的 `spawn`，以及 Electron `app.getPath('userData')`，不要求 `bash`、`zsh`、`/tmp` 或 POSIX 路径分隔符。
