# AI DevFlow Studio

**可自行部署的 AI 开发工作台，连接本地编码、团队评审与交付。**

将一个需求依次推进到澄清、设计、实现、测试、草稿拉取请求（Draft pull request）和业务验收。开发者在 Electron 中工作；评审者通过 Web 控制台核对证据、策略与费用，再批准下一步。

[快速开始](#quick-start) · [完整流程](#from-request-to-acceptance) · [架构](#architecture) · [文档](#documentation) · [项目简介](docs/product/project-introduction.zh-CN.md)

![Electron 任务页：前四个阶段已通过，PR 交付步骤的状态行写明“可以准备交付”与主动作](docs/guides/screenshots/workspace-redesign-20260928/desktop/shots/doc-tour-task-current-work-1440x900.jpg)

_2026 年 9 月 28 日工作区改造基线的 Electron 任务页，内容区 1440 × 900。左侧是任务、知识、团队、设置四个入口；标题下是六个阶段；下方是「当前工作」「材料与版本」「执行记录」三个页签。此后 `main` 已进一步将前四个阶段（需求澄清、方案设计、开发实现、测试证据）升级为统一的决定页（顶部「你的决定」栏、正文/差异、右侧审查/自检卡片与修订清单），并将右侧会话面板更名为「答疑」。示例在隔离环境中用 Deterministic Fake Provider 和模拟编码推进，正文为模拟模板。[截图来源与范围](docs/guides/screenshots/workspace-redesign-20260928/README.md)。_

> **发布与路线图状态**：最新已发布版本是 [`v2.3.0`](https://github.com/erich04/ai-devflow-studio/releases/tag/v2.3.0)，发布时间为 2026 年 9 月 14 日。本 README 介绍当前 `main` 源码，包括此后完成的工作台决定页改版（UX 第 1 批与第 2a 批）、Hindsight 项目记忆（ADR 0030）、常驻阶段知识上下文（ADR 0025）、OpenCode 问答与有界子任务、模型设置与定价治理，以及多组织改动。使用这些改动需要从源码构建，已发布安装包不会自动包含后续源码变化。多轮 Native Coding Harness v3 仍在独立分支（[PR #238](https://github.com/erich04/ai-devflow-studio/pull/238)）开发与评测，尚未合入 `main`。详见 [V2.3 发布说明](docs/releases/v2.3.0/notes.md)与[路线图](docs/roadmap.md)。候选版本验证、正式验收和已发布安装包分别记录。

<a id="from-request-to-acceptance"></a>

## 从需求到验收

一个 **工作流实例（Run）** 串联原始需求、产物（Artifact）、代码变更、测试、审查决策和交付记录。默认流程包含六个阶段、八个节点，其中有两个中间人工门禁（Gate）。

| 阶段 | 主要工作 | 结果 |
| --- | --- | --- |
| **需求澄清** | 将请求整理为需求、验收标准和非目标；在门禁决定页审阅原文、处理审查意见与待确认问题，并通过修订清单生成新版本或确认需求 Gate。 | 版本化澄清产物、修订记录与人工决策。 |
| **方案设计** | 结合常驻项目知识与上下文提出实现方案；在同一套门禁决定页按版本审阅、汇总修订清单生成新版或批准方案 Gate。 | 版本化设计产物、参考依据与开发批准。 |
| **开发实现** | 在受管理的 Git 工作树中运行 Native Coding（v2）或 OpenCode；在决定页审阅精确行级差异、权限/问答/自检卡片，支持 Native 按清单修订与手动自检。 | 可审查的不可变变更修订、执行轨迹与用量记录。 |
| **测试证据** | 执行项目保存的测试命令，将通过结果绑定精确已批准改动指纹，并由用户显式确认测试证据后再进入交付。 | 绑定 Run、节点与精确改动指纹的测试证据（Test Evidence）。 |
| **PR 交付** | 准备交付包，取得独立的 Web 批准后发布获准的提交。 | 经核验的分支头与 Draft pull request。 |
| **业务验收** | 对照需求目标，核对交付结果与证据。 | 明确的业务验收结论。 |

前四个阶段（需求澄清、方案设计、开发实现、测试证据）采用统一的**决定页**布局：顶部「你的决定」栏固定在页签上方、滚动区之外，汇总当前结论、进度、阻断原因与动作；左侧展示材料原文或精确行级差异，右侧并排展示审查意见、待确认问题、自检与权限卡片；用户采纳意见、回答问题或从右侧「答疑」加入建议形成按精确版本绑定的本机**修订清单**，一次提交生成新版本（窄窗口下自动切换为标记与弹出卡片）。

浏览阶段不会推进 Run。任务页区分“正在查看”与“实际进度”：浏览已完成、历史版本或尚未开始的步骤时，页面保持只读、同时写明实际进度，并提供「返回当前工作」或返回当前版本。决定栏的结论与按钮来自纯函数状态投影；仅警告的策略不显示为阻断，停止、取消和拒绝始终可见。

<details>
<summary>Electron 阶段图集（2026-09-28 工作区改造基线）：需求确认 → 方案评审 → 开发权限 → 浏览历史步骤</summary>

**1. 需求确认 Gate：策略仅警告、尚未运行门禁审查**

![Electron 任务页：状态行写明“等待你确认需求 v1 · 尚未运行 AI 审查”，同屏有运行门禁审查与确认需求 v1](docs/guides/screenshots/workspace-redesign-20260928/desktop/shots/clarify-gate-warn-1440x900.jpg)

_确认按钮写明所确认的版本。阅读历史版本或原始需求时，按钮仍指向待确认版本，第一次点击只提示，第二次才提交。_

**2. 方案评审 Gate：审批绑定所看到的方案版本**

![Electron 任务页：状态行写明所审方案与记录时间，主动作为运行门禁审查，次要动作为确认方案](docs/guides/screenshots/workspace-redesign-20260928/desktop/shots/design-gate-1440x900.jpg)

_确认时发送方案的标识、记录时间与内容摘要，主进程重新读取后逐项比对，不一致时在写入前拒绝。_

**3. 开发实现：权限请求在状态行上处理**

![Electron 任务页：等待处理权限请求，剩余时间、批准本次、查看权限详情、拒绝与停止执行都在状态行上](docs/guides/screenshots/workspace-redesign-20260928/desktop/shots/build-permission-1440x900.jpg)

_编码在任务页内运行；权限请求显示剩余时间，批准与拒绝不需要离开任务页。_

**4. 浏览已完成的步骤：实际进度仍然可见**

![Electron 任务页：正在查看历史步骤开发实现，提示条写明实际进度在 PR 交付](docs/guides/screenshots/workspace-redesign-20260928/desktop/shots/doc-tour-task-history-build-1440x900.jpg)

_在历史步骤上的操作不会改变实际进度。「材料与版本」按当前待处理、已确认依据、原始输入与参考、讨论提案、历史记录分组；「执行记录」保留模型调用、工具时间线与测试日志。_

</details>

<a id="agents-and-conversations"></a>

## 智能体与独立对话

| 能力 | 当前实现 |
| --- | --- |
| **澄清与设计** | Direct Provider 或只读 OpenCode 分析生成正式阶段产物；支持基于修订清单生成需求与方案新版本，并记录实际送出的知识与记忆回执。 |
| **独立对话（答疑）** | Direct Provider 或 OpenCode 可查询 Run、节点、产物、仓库文件、知识、项目记忆（`memory_search`）以及待批准改动与受管工作区。每个会话分别保存历史、草稿、问题和执行方式。 |
| **编码** | 共享编码执行器（Coding Executor）契约同时支持 **OpenCode** 与 **Native Coding**。OpenCode（核对版本 1.18.15）支持命令输入绑定授权、交互式[问答](docs/engineering/opencode-question-protocol.md)、单层串行[有界子任务](docs/engineering/opencode-bounded-tasks.md)（`devflow-worker`）和白名单只读[公开文档读取](docs/engineering/opencode-public-documents.md)（`devflow_document`）。`main` 当前内置 Native v2，支持仓库调查、多文件变更集、明确批准、按清单修订（最多 3 次）与手动自检（最多 2 次）、受管理工作树修改、已保存测试命令及有限次数修复。 |
| **门禁审查（Gate Review）** | 支持内置仓库只读审查（无需 OpenCode）或 Direct Provider；依据常驻阶段知识与已有证据提出带级别标记的意见、证据缺口、建议测试和策略建议，并可与待确认问题合并呈现。模型不会批准 Gate。 |
| **有界协作** | 高级 Supervisor/Specialist 运行时采用预先定义的任务依赖图、共享预算、限定能力和工作区单写入者租约。详见 [V2.2 契约与评估范围](docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md)。 |

右侧独立的项目会话面板现称「**答疑**」（默认收起，点标题行或卡片上的「讨论」展开并直接显示待发送输入框，无需弹窗；收起再打开时草稿仍在），自动展示当前查看的任务、步骤与材料版本，并在消息中以简洁引用标签替代展开的完整引用头。答疑中的建议可直接**加入当前版本的修订清单**，或保存为**待确认的节点提案**；保存或加入清单本身不会修改代码、批准 Gate 或发布 PR。

新建 Direct Provider 对话使用官方 `deepseek-flash` 时，普通回答直接显示 Markdown，读取操作使用原生 Function Calling。提案先保存候选再独立核对；核对失败或发现问题时，用户可以查看意见、重新核对，或明确确认后保存为尚未通过 AI 核对的待评审提案。旧会话保持原协议和进度；使用新版请新建独立对话。启用范围与回滚见 [ADR 0028](docs/adr/0028-native-conversations-and-proposal-review.md)。

协作中的委派深度、并发、能力和工作区写入均有明确边界。Agent 输出经过相应的确定性校验后才能作为工作流证据；推进流程和批准 Gate 仍由可信命令及人工决策控制。

<a id="knowledge-memory-and-evidence"></a>

## 知识、记忆与证据

- **仓库知识与常驻上下文（ADR 0025）**：仓库根目录的 `AGENTS.md`（无则 `CLAUDE.md`，上限 32 KiB）作为 L0 项目说明随各阶段调用一致提供；项目知识目录（默认 `docs/knowledge/`）按 front matter 的 `stages` 与 `gate` 组装为 L1 阶段知识上下文，Gate 治理检查仅针对声明覆盖当前阶段的规范文档。旧词法检索仅保留给显式调用方与评估基线。详见 [ADR 0025](docs/adr/0025-resident-knowledge-context.md)。
- **Hindsight 仓库知识投影（试验）**：选定知识可用于讨论、需求、设计、评审、编码和测试来源核验，支持配对项目显式启用本机私有知识投影。采用版本化语义模型、可恢复投影与当前原文回读；本地 Compose 使用自带 `intfloat/multilingual-e5-small` 的多语言镜像，网络闸门默认关闭。见[接入说明](docs/engineering/hindsight-integration.md)与[全链路验证记录](docs/validation/hindsight-fullchain-validation-20261020.md)。
- **项目记忆（Project Memory / Hindsight，ADR 0030）**：项目记忆是 DevFlow 当前唯一的活跃记忆系统；未开启项目记忆时没有记忆，旧版候选队列、业务规则待确认队列、「记住这条」与本地 BM25 召回已在 ADR 0030 第四期移除（历史旧方案见[自动经验记忆](docs/engineering/automatic-memory.md)）。
  - **自动整段采集与预算中继**：每个已配对团队项目与记忆归属用户在 Hindsight 中拥有独立 bank，自动脱敏写入公开讨论（长讨论按 46 KiB 分段写入与补发）、结束的 Coding Run（非 `fake`）、已批准的澄清/设计/验收产物、Gate 评审结果，以及当前分支最近 30 天的 Git 提交信息（开启时一次性迁移旧版本地有效记忆 `legacy:agent-memory`）。Hindsight 不持有 Provider 密钥，抽取、观察归纳与知识页整理调用经 Electron 本机中继（`127.0.0.1:8891`）转发并按调用计入团队项目预算。
  - **多语言召回、多意图拆分与知识页**：编码简报、阶段 Agent、Gate 评审与答疑共用 Hindsight 多语言召回（关闭重排和图扩展，按向量/关键词/时间倒数排名融合）；多子句请求自动拆分子意图召回并轮流合并；事实标注记录日期与距今天数并提醒先对照当前代码与已批准材料核对；沟通偏好单独召回置尾。每个 bank 维护五张 Hindsight 知识页，其中「每个任务都适用的约定」（`devflow-essentials`）自动注入编码简报（简版注入答疑、阶段与评审）。知识页的「项目记忆」面板支持开关、分页搜索查看、编辑/删除原始事实与经历、按来源忘记、清空与整理知识页；答疑另提供只读 `memory_search` 工具。每次发送或继续前核验记忆开关、归属及编辑/删除/清空回执状态。见 [ADR 0030](docs/adr/0030-hindsight-project-memory.md)、[项目记忆说明](docs/engineering/project-memory.md)与[收尾验证记录](docs/validation/project-memory-closeout-20261104.md)。
- **有界上下文**：Native Coding 和 OpenCode 共用编码任务简报（Coding Brief）。已有摘要与明确约束用于压缩较早上下文，同时保留当前请求、选定记忆与常驻约定页（超出容量时先省略约定页或背景记忆，不截断必要输入）。讨论长历史生成可追溯的确定性摘要，保留完整原文与配对工具记录，压缩后在容量允许时重新附带沟通偏好与背景记忆；上下文使用提供方相关的 Token 估算和字符/字节硬限制，不自动调用收费摘要模型。
- **真实证据**：编码完成时，系统对照当前产物、精确代码差异和实际执行的测试记录检查结果；测试阶段通过的报告需绑定已批准改动指纹并经人工显式确认才进入 PR 交付。成功的评估样例不能替代缺失或过期的证据，记忆和模型建议均不能满足 Gate 条件或授权操作。

早期记忆生命周期基线与实验记录见[记忆与上下文验证](docs/engineering/memory-context-execution-validation.md)、[记忆生命周期 ADR](docs/adr/0018-scoped-agent-memory-lifecycle.md)、[编码上下文 ADR](docs/adr/0021-coding-memory-context-and-evidence-evaluation.md)与 [P0/P1/P2 收尾记录](docs/validation/memory-p0-p2-20261004.md)（[PR #223](https://github.com/erich04/ai-devflow-studio/pull/223)）。安装包是否包含这些变化，以[路线图的发布记录](docs/roadmap.md#当前发布)和对应版本证据为准。

![Electron 知识页：仓库 Markdown 索引已更新，同一份文档的引用按任务、材料与 Gate 分组列出](docs/guides/screenshots/workspace-redesign-20260928/desktop/shots/doc-tour-knowledge-1440x900.jpg)

_知识页展示仓库 Markdown 索引与当前任务的引用。同一份文档被多处引用时按文档合并，每处写明引用关系、审查状态和检索方式；检索候选尚未经审查确认，不等于 Gate 依据。示例知识文档来自隔离示例仓库。_

<a id="team-collaboration-and-delivery"></a>

## 团队协作与交付

当前 Web 界面有我的待办、项目任务、团队、设置四个入口。我的待办列出当前项目中等待你处理的 Gate、交付审批与异常，并写明数据的读取时间；旧的 `projectId + runId` 链接仍直接打开对应任务，历史 `/legacy-shell` 地址会重定向到当前界面。

- **项目与请求**：创建团队项目（Team Project），在「项目任务」中提交团队请求（Work Request），再由已配对桌面端明确领取。有效项目成员可以在「设置 › 桌面连接」为自己生成有期限、仅能使用一次的桌面配对码。
- **Web 审批**：需求确认与方案评审绑定桌面端上传的材料版本；材料版本未同步或已变化时不能批准，但仍可驳回。没有审批权限的成员看到“等待负责人审批”，不显示按钮。
- **组织**：独立组织、成员关系、邀请、切换、归档/恢复和限定组织范围的 GitHub 仓库分配已实现，由 `DEVFLOW_MULTI_ORGANIZATION_ENABLED=true` 开启。默认入门流程仍为单团队模式。详见[部署指南](docs/guides/multi-organization-deployment.md)。
- **预算与策略**：在 Web「设置」中查看用量、配置项目策略和预算、创建一次性预算批准；桌面端「设置 › 模型与执行方式」按提供方 → 执行方式 → 团队预算的依赖顺序组织，仅突出阻断项与下一步动作，只读显示团队预算。当权威预算上下文不可用或超出作用范围时，付费 Coding 与 Gate Review 运行时在调用提供方前拒绝继续；受治理的模型调用也覆盖阶段生成、工作台对话与 Hindsight 项目记忆中继。版本化[运行费用目录](docs/engineering/runtime-pricing-catalog.md)已单独核验并覆盖 `deepseek-flash`、`deepseek-v4-flash` 与 `deepseek-v4-pro` 的费率及调用前上限。

费用待确认的调用有可靠上界时按上界占用预算；否则当前操作会展示继续确认卡，由 Lead/Owner 明确勾选有限授权。它不修改历史账单，也不关闭预算。对话按步骤保留查询进展，每步最多自动重试两次。完整策略与容量、私有内容备份及会话工具授权见 [ADR 0027](docs/adr/0027-request-recovery-and-budget-continuation.md)；原生对话的后续决定见 [ADR 0028](docs/adr/0028-native-conversations-and-proposal-review.md)。

桌面一级导航的**任务中心**汇总当前项目的团队请求与本地执行，提供待领取、进行中、待你处理和已完成筛选。点击标题先预览；只有“领取并进入”才领取任务。门禁的内置仓库只读审查可独立于开发执行器选择，无需 OpenCode。
- **可恢复同步**：持久化发件箱保存脱敏同步任务，支持有限次数重试与重启恢复。桌面端仍是本地 Run 和完整执行记录的权威来源。
- **GitHub 交付（GitHub Delivery）**：交付意图（Delivery Intent）绑定精确提交、Run 版本、测试、仓库绑定和交付包。发布前必须取得独立签名的 Web 批准。遵循最小权限的 GitHub App 支持推送获准的精确分支，并通过 API 核验 Draft pull request。DevFlow 永不合并代码，也不强制推送、删除远端分支或发布标签。

![Web 我的待办：数据读取时间，两条方案评审，其中一条写明材料版本未同步、暂不能批准](docs/guides/screenshots/workspace-redesign-20260928/web/web-todo.png)

_Next.js 控制台的我的待办。每行写明请求方、材料版本、更新时间和是否需要你处理，并只有一个「查看」入口。隔离的演示 API 通过正常同步接口接收脱敏示例摘要；左下角的 “N” 是 Next.js 开发模式标记。完整截图与源码提交见[截图记录](docs/guides/screenshots/workspace-redesign-20260928/README.md)。_

<details>
<summary>Web 控制台图集：任务详情与审批 → 项目任务 → 预算 → 团队策略</summary>

**1. 任务详情：所审材料、审批角色与你的角色**

![Web 任务详情：状态、当前步骤、数据时效，以及方案评审的所审材料、审批角色和审批说明](docs/guides/screenshots/workspace-redesign-20260928/web/web-task-detail.png)

_审批区写明所审材料的类型与记录时间，完整标识在技术详情中。批准前必须填写审批说明；Web 只提交协作意图，由拥有该任务的桌面端复核后执行。_

**2. 项目任务：团队请求与开发任务**

![Web 项目任务：团队请求表单（尚无请求），下方是两个等待审批的开发任务](docs/guides/screenshots/workspace-redesign-20260928/web/web-project-tasks.png)

_桌面端须明确领取团队请求后才创建本地任务；任务列表只读，进度来自桌面端最近一次上传。_

**3. 设置 › 预算：额度、用量与一次性批准**

![Web 设置的预算分区：当前规则、预算规则表单与一次性预算批准](docs/guides/screenshots/workspace-redesign-20260928/web/web-settings-budget.png)

_预算只在 Web 修改；桌面端设置中只读显示，并写明修改位置。_

**4. 设置 › 策略：规则动作、最低要求与修复指引**

![Web 设置的策略分区：团队策略规则表与预设](docs/guides/screenshots/workspace-redesign-20260928/web/web-settings-policy.png)

_页面区分已保存的团队策略与桌面端上次同步的策略快照；只有组织 Owner 可以修改。_

</details>

<a id="architecture"></a>

## 架构

DevFlow 是采用 TypeScript/pnpm 的单一仓库，围绕**本地执行、团队治理与共享领域规则**构建。Electron 管理权威开发 Run 和仓库操作；Team API 管理协作权限与共享记录。两端共同使用 `@ai-devflow/shared` 校验流程迁移、证据、策略和版本化契约。

<a id="system-and-process-boundaries"></a>

### 系统与进程边界

![AI DevFlow Studio 系统与进程边界：开发者本机 Electron 客户端、团队自托管服务、本机 Hindsight 项目记忆、模型提供方、GitHub 最小权限交付与共享领域核心的实时进程通信与信任边界](docs/guides/diagrams/system-process-boundaries.svg)

_动态箭头与脉冲光点表示运行时进程通信方向与本地/跨边界访问。API 到桌面端的方向表示响应、策略/预算决策与轮询取得的命令；本机 Hindsight 为可选模块，不持有模型密钥，其抽取与知识页整理调用经桌面中继（`:8891`）计入团队预算。Desktop、Web、API 和 Worker 编译时共同导入 `@ai-devflow/shared`；它是代码库，无需作为独立服务部署。_

| 层次 | 职责 | 代码 |
| --- | --- | --- |
| **桌面渲染进程** | 阶段导航、节点阅读区、独立对话、知识与执行控件。仓库操作通过类型化 preload 桥接完成。 | [`App.tsx`](apps/desktop/src/App.tsx)、[`preload.ts`](apps/desktop/electron/preload.ts)、[`ipc-contract.ts`](apps/desktop/electron/ipc-contract.ts) |
| **Electron 主进程** | 组装服务、校验 IPC，管理凭据、本地命令、工作树、SQLite、执行恢复与同步。 | [`main.ts`](apps/desktop/electron/main.ts)、[`LocalStore`](apps/desktop/electron/local-store.ts) |
| **Web** | 通过 Next.js 页面、服务端动作和 API 代理处理团队需求、评审、设置、组织管理与交付批准。 | [`apps/web/app`](apps/web/app)、[API 客户端](apps/web/app/lib/devflow-api.ts) |
| **Team API** | Node HTTP 请求处理，浏览器签名认证及已配对桌面认证、实时成员资格检查、业务路由、持久化与 GitHub 集成。 | [`server.ts`](apps/api/src/server.ts)、[`server-request.ts`](apps/api/src/server-request.ts)、[存储层](apps/api/src/repositories) |
| **共享领域核心** | 工作流/智能体契约、确定性迁移、策略评估、检索、记忆、协作、脱敏与费用规则。 | [`packages/shared/src`](packages/shared/src) |
| **Worker** | 独立的项目/成员费用汇总入口。目前没有后台任务队列，也不属于 Docker Compose 服务栈。 | [`apps/worker/src/index.ts`](apps/worker/src/index.ts) |

<a id="execution-model"></a>

### 执行模型

**确定性工作流管理进度；AI 执行产出候选结果与证据。**[桌面工作流运行时](apps/desktop/electron/workflow-runtime.ts)加载当前 Run 与证据，调用 [`applyWorkflowCommand`](packages/shared/src/workflow-transition.ts)，再通过 LocalStore 乐观事务提交被接受的变更。该事务同时将对应远端摘要加入队列。模型响应、会话答复或运行时的 `success` 本身不等于 Gate 批准。

| 子系统 | 在架构中的作用 | 实现入口 |
| --- | --- | --- |
| **阶段生成、决定页与对话** | 澄清/设计生成正式产物；纯函数投影驱动 01–04 统一决定页与本机修订清单；「答疑」通过受限只读工具调查流程、产物、仓库文件、知识、项目记忆与待批准改动。Direct Provider 与只读 OpenCode 是两种执行选择。 | [`workflow-agent.ts`](packages/shared/src/workflow-agent.ts)、[`gate-decision/`](apps/desktop/src/app/gate-decision)、[`build-test/`](apps/desktop/src/app/build-test)、[`workbench-conversation-service.ts`](apps/desktop/electron/workbench-conversation-service.ts) |
| **编码编排** | `coding-runtime` 准备受管理工作树和 Coding Brief，检查权限与预算，调用选定执行器，归档不可变变更修订、自检历史、差异、测试、用量和结果（桌面 schema 42）。Native Coding（v2）与 OpenCode（支持问答、有界子任务与公开文档工具）共用 Coding Executor 契约。 | [`coding-runtime.ts`](apps/desktop/electron/coding-runtime.ts)、[`coding-executor.ts`](apps/desktop/electron/coding-executor.ts)、[`native-coding-executor-v2.ts`](apps/desktop/electron/native-coding-executor-v2.ts) |
| **有界运行时与协作** | 观察、行动、评估、检查点保存组成有明确限制及恢复能力的执行循环。Supervisor/Specialist 协作增加预定义任务依赖、限定权限、共享预算与工作区归属；与单次阶段生成或审查调用分别建模。 | [`agent-runtime-runtime.ts`](apps/desktop/electron/agent-runtime-runtime.ts)、[`specialist-runtime-coordinator.ts`](apps/desktop/electron/specialist-runtime-coordinator.ts) |
| **知识与项目记忆** | `AGENTS.md` 与 `docs/knowledge/` 按阶段常驻组装（ADR 0025）。Hindsight 项目记忆由本地采集队列自动写入，经桌面中继计入项目预算，并向编码简报、阶段、评审和答疑提供多语言召回与知识页（ADR 0030）。私有会话历史、工具事件和派生摘要单独保存。 | [`repository-knowledge.ts`](apps/desktop/electron/repository-knowledge.ts)、[`project-memory-service.ts`](apps/desktop/electron/project-memory-service.ts)、[`memory-model-relay.ts`](apps/desktop/electron/memory-model-relay.ts)、[`coding-context.ts`](apps/desktop/electron/coding-context.ts) |
| **工具与 MCP** | 主进程管理的注册表校验工具定义与执行权限。可信本地 stdio MCP 安装与 OpenCode 对话临时只读 MCP 桥接各有边界。 | [`native-tool-registry.ts`](apps/desktop/electron/native-tool-registry.ts)、[`local-mcp-client.ts`](apps/desktop/electron/local-mcp-client.ts)、[`workbench-mcp-bridge.ts`](apps/desktop/electron/workbench-mcp-bridge.ts) |
| **模型调用治理** | 每次请求预留预算并保存用量；结算上传失败保留有效结果，重放账本。未知费用保留为未知，有可靠上界时占用预算，否则使用明确的有限继续授权；运行时与权限限制仍独立生效。 | [`governed-provider.ts`](packages/shared/src/governed-provider.ts)、[`model-call-budget.ts`](apps/api/src/repositories/model-call-budget.ts) |

<a id="state-ownership-and-collaboration"></a>

### 状态归属与协作

| 数据或决策 | 权威归属 | 跨边界传递的内容 |
| --- | --- | --- |
| 权威 Run、完整节点图、产物、变更修订与自检、执行/检查点状态、差异、测试输出、私有答疑对话 | **Electron / 本地 SQLite 与文件** | 白名单内的 Run、测试、审查、编码、运行时、记忆和协作摘要；不包含对话、自检正文或本地路径。 |
| 项目记忆 bank 与 Hindsight 知识页 | **本机 Hindsight 服务 + Electron 本地队列与预算中继** | 抽取/归纳调用经本机中继走团队预算预留与结算；记忆正文与来源文档不上传 Team API。 |
| 组织、成员关系、团队项目、工作请求、Gate 命令、策略、预算、仓库绑定与交付批准 | **Team API / PostgreSQL** | 向配对桌面端下发项目范围内的领取结果、命令、策略快照、预算决策与交付授权。 |
| 团队 Run 投影与管理概览 | **API 根据桌面摘要派生的读取模型** | 供 Web 使用的版本化、脱敏、有损视图；不复制完整本地 Run，也不独立管理流程。 |
| 已发布分支头与 Draft PR | **GitHub**，辅以本地/团队审计记录 | 桌面端推送获准提交；API 核验 GitHub 的实际分支头并记录 Draft PR 结果。 |

Electron 管理仓库访问、Shell 执行、完整本地证据与私有对话历史。团队服务接收白名单摘要，不接收原始仓库正文或本地路径。已配置的模型服务可以接收完成任务所需的选定代码和上下文。受管理 Git 工作树用于隔离变更，但不提供操作系统级沙箱。浏览器预览不能替代 Electron 的可信执行边界。

需要同步的本地变更通过**持久化发件箱**，将同步意图与状态变更一起提交。[发件箱处理器](apps/desktop/electron/remote-sync-outbox-processor.ts)重新读取权威记录，构建绑定项目的摘要，并处理有限次数重试和重启恢复。共享记录受组织与实时项目成员资格约束；桌面凭据始终绑定配对时的组织/项目。多组织入门流程由 `DEVFLOW_MULTI_ORGANIZATION_ENABLED` 单独启用。

下图展示**源自团队端的请求**。纯本地 Run 可以直接在桌面端启动；受治理的 GitHub 发布还需要团队绑定与批准。

```mermaid
sequenceDiagram
    participant Web as Web / 评审者
    participant API as Team API + PostgreSQL
    participant Desktop as Electron 主进程
    participant Local as LocalStore + 工作树
    participant GitHub as GitHub
    Web->>API: 创建版本化工作请求
    Desktop->>API: 使用配对身份明确领取请求
    API-->>Desktop: 将请求绑定到稳定的本地 Run ID
    Desktop->>Local: 原子创建权威 Run
    Note over Desktop,Local: 澄清/设计产物与审查证据
    Desktop->>API: 上传脱敏的当前摘要
    Web->>API: 提交绑定版本的 Gate 命令
    Desktop->>API: 轮询收件箱并取得回执
    Desktop->>Local: 校验证据并应用工作流命令
    Desktop->>API: 确认接收并同步结果摘要
    Note over Desktop,Local: 获准编码、工作树测试、交付包
    Desktop->>API: 登记绑定精确提交的交付请求
    Web->>API: 单独批准该交付请求
    Desktop->>API: 取得限定范围的短期发布授权
    Desktop->>GitHub: 仅推送获准的提交和分支
    Desktop->>API: 请求核验远端分支头并创建草稿 PR
    API->>GitHub: 核验预期分支头，创建或对账草稿 PR
    API-->>Desktop: 返回已核验的交付结果
    Desktop->>Local: 记录交付，准备业务验收
    Note over Desktop,Local: 验收仅在自身检查与人工决策通过后推进
```

Web 批准将意图加入队列；所属桌面端对照本地证据重新评估后才修改 Run。确认收到回执本身不会推进团队投影。浏览器 GitHub OAuth 用于身份认证；另行配置的 GitHub App 提供范围受限的发布能力。详见 [Web/桌面端权限边界](docs/adr/0012-web-desktop-work-authority.md)与 [GitHub 交付权限](docs/adr/0013-github-app-delivery-authority.md)。

<a id="deployment-and-code-reading-map"></a>

### 部署与代码阅读导航

默认 [Docker Compose 部署](docker-compose.yml)启动 PostgreSQL、一次性迁移任务、API 和 Web。Electron 运行在各开发者电脑上，此拓扑无需独立 Worker。API 使用 Postgres 持久化；只有未配置数据库且明确开启演示标志时，才选择内存种子仓库。

```text
apps/
  desktop/
    src/          React 工作台、视图、状态与界面动作
    electron/     主进程/preload、IPC、LocalStore、执行与同步
  web/app/        Next.js 团队控制台、服务端动作与 API 代理
  api/src/
    auth/         浏览器会话、身份与桌面认证
    routes/       团队、组织、协作与交付端点
    repositories/ 持久化契约、Postgres 与演示适配器
    db/           数据库客户端与版本化 SQL 迁移
  worker/src/     独立费用汇总
packages/shared/ 领域类型、解析器、工作流/智能体规则与投影
docs/adr/         架构决策与权限边界
scripts/          集成冒烟测试、评估与发布检查
```

首次阅读代码，建议依次查看 **[`domain.ts`](packages/shared/src/domain.ts) → [`workflow-transition.ts`](packages/shared/src/workflow-transition.ts) → [`workflow-runtime.ts`](apps/desktop/electron/workflow-runtime.ts) → [`main.ts`](apps/desktop/electron/main.ts) → [`server-request.ts`](apps/api/src/server-request.ts)**，再查看相关桌面或 Web 视图。设计理由可从[数据归属](docs/adr/0003-postgres-sqlite-data-boundary.md)、[有界运行时](docs/adr/0014-bounded-agent-runtime.md)、[多智能体协作](docs/adr/0019-bounded-multi-agent-coordination.md)、[组织隔离](docs/adr/0023-independent-organizations.md)、[常驻知识上下文](docs/adr/0025-resident-knowledge-context.md)和[Hindsight 项目记忆](docs/adr/0030-hindsight-project-memory.md)开始。

[AI 原生软件生命周期对照](docs/engineering/anthropic-ai-native-sdlc-alignment-2026-09-10.zh-CN.md)记录了阶段交接、配置评估与维护反馈的历史分析和增量建议。当前交付边界到经核验的 Draft PR 与业务验收；生产部署、回滚和持续维护需要独立设计与授权。其他代码阅读资料见[研究索引](docs/research/README.md)，当前能力与发布状态仍以本 README 和路线图为准。

<a id="quick-start"></a>

## 快速开始

使用 **Node.js 24**、**Corepack** 和仓库锁定的 **pnpm 9.15.0**。受管理工作树需要 Git。源码流程在 macOS 上进行验证；Windows 的验证范围见 [Windows 指南](docs/guides/windows-zip-smoke.md)。

```bash
git clone https://github.com/erich04/ai-devflow-studio.git
cd ai-devflow-studio
corepack pnpm install --frozen-lockfile
```

<a id="try-the-desktop-with-deterministic-demo-runtimes"></a>

### 使用确定性演示运行时体验桌面端

```bash
DEVFLOW_ENABLE_DEMO_DATA=true \
DEV_AUTH_ENABLED=true \
DEVFLOW_ENABLE_FAKE_RUNTIME=true \
DEVFLOW_CODING_ENGINE=fake \
corepack pnpm dev:electron
```

这些开发标志启用确定性的流程/审查提供方和模拟编码引擎。本次演练在**设置 › 模型与执行方式**中选择 **Deterministic Fake Provider**，不会调用付费模型。选择仓库并新建任务后，桌面端会显示相应内容。对网络开放的部署应关闭演示身份认证。

`corepack pnpm install` 不会下载 Electron 二进制。`dev:electron` 启动前会运行 `scripts/ensure-electron-install.mjs`，在本机缺少与当前平台匹配的二进制时再下载。

1. 在顶栏的项目菜单中选择一个已提交的小型 Git 仓库，在**设置 › 本地项目**保存检测到的测试命令。
2. 点击**新建任务**，填写具体请求和验收标准。
3. 在任务页生成需求澄清与方案，在门禁决定页阅读材料、整理修订清单并按「你的决定」栏确认需求与方案 Gate。
4. 在开发实现步骤运行编码，在决定页处理权限请求与精确差异，再到测试步骤运行检查并显式确认测试证据。
5. 在「材料与版本」和「执行记录」中核对材料、测试、轨迹与用量。真实 GitHub 发布还需要团队配置、仓库绑定和独立交付批准。

日常使用时，省略演示标志，在**设置 › 模型与执行方式**中配置所需提供方与执行器，并在付费模型调用前于**设置 › 团队连接**连接团队项目（顶栏的「团队连接」弹层显示连接状态），由团队在 Web「设置 › 预算」中配置预算。凭据和执行方式需要明确配置；安装 DevFlow 不会自动配置模型提供方。

`corepack pnpm dev:desktop` 仅启动浏览器渲染预览。目录选择、本地命令、流程写入和编码执行需要 `corepack pnpm dev:electron`。

<a id="start-a-local-team-without-github-login"></a>

### 无需 GitHub 登录，启动本地团队环境

先用 PostgreSQL 超级用户创建专用角色和数据库：角色 `devflow_local`（密码 `devflow`，只用于本机开发）和同名数据库。已存在时跳过，不修改已有角色和其他数据库。

```bash
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE devflow_local LOGIN PASSWORD ''devflow'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devflow_local')\gexec
SELECT 'CREATE DATABASE devflow_local OWNER devflow_local'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'devflow_local')\gexec
SQL
```

Debian 与 Ubuntu 的默认集群通过操作系统用户 `postgres` 做本地认证。macOS Homebrew 的当前用户通常已是超级用户，把开头换成 `psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'`。改用其他角色或密码时，同步修改下面的连接串。

API 和 Web 使用相同的回环主机名：

```bash
export DEVFLOW_DATABASE_URL='postgres://devflow_local:devflow@127.0.0.1:5432/devflow_local'
export DEVFLOW_ENABLE_DEMO_DATA=false
export DEVFLOW_LOCAL_AUTH_ENABLED=true
export DEVFLOW_REQUIRE_AUTH=true
export DEVFLOW_WEB_APP_URL='http://127.0.0.1:4311'
export HOST='127.0.0.1'

corepack pnpm --filter @ai-devflow/api db:setup
corepack pnpm --parallel --filter @ai-devflow/api --filter @ai-devflow/web dev
```

打开 `http://127.0.0.1:4311`，选择**使用本地开发身份**。创建团队项目，在「设置 › 预算」配置预算，在「设置 › 桌面连接」生成桌面配对码。在另一终端运行 `corepack pnpm dev:electron`，选择本地仓库，在**设置 › 团队连接**粘贴配对码并点击**连接**。本地开发身份要求真实 Postgres，不会启用演示种子数据，也不能替代生产身份认证。

Docker、GitHub OAuth、部署密钥、备份恢复与发布包的操作见[自行部署试用指南](docs/guides/devflow-studio-self-hosted-pilot.md)。启用多组织时，另请阅读[组织部署指南](docs/guides/multi-organization-deployment.md)。

<a id="verification"></a>

## 验证

```bash
corepack pnpm verify
```

该命令执行 TypeScript 检查、单元/组件测试和跨平台静态检查。以下入口适用于对应验证环境：

| 命令 | 范围 |
| --- | --- |
| `corepack pnpm test:e2e` | 使用隔离演示服务验证浏览器工作台与 Web 交互。 |
| `corepack pnpm test:electron-smoke` | 真实 Electron 主进程/preload、本地 SQLite 与流程操作。 |
| `corepack pnpm test:native-coding-electron-smoke` | 通过受控本地模型服务验证 Native Coding 批准、工作树修改、测试与证据。 |
| `corepack pnpm test:build-test-electron-smoke` | 通过本机模型替身与真实 Electron 验证开发/测试决定页、修订清单、自动修复、证据失效与显式确认。 |
| `corepack pnpm test:workbench-conversation-electron-smoke` | 真实 Electron 中验证答疑对话、逐步骤恢复、预算继续、原生工具、候选人工确认保存与重启历史；模型端点为本地模拟。 |
| `corepack pnpm test:native-conversation-live` | 显式选择既有授权凭证，在隔离 Electron 中验证官方 flash 的原生协议和提案；会真实计费，配置与证据见 [#231 验证记录](docs/validation/issue-231-native-conversation-20261010.md)。 |
| `corepack pnpm test:stage-agent-design-electron` | 真实 OpenCode 与 Electron 生成及修订方案、取消、重试和重启；模型端点为本地模拟。 |
| `corepack pnpm test:opencode-question-electron` / `corepack pnpm test:opencode-task-electron` | 真实 OpenCode 与 Electron 验证交互式问答、单层串行有界子任务、命令审批、预算拦截、取消与刷新/重启边界；模型端点为本地合成服务。 |
| `corepack pnpm hindsight:up` + `corepack pnpm test:hindsight-electron` | 启动本机多语言 Hindsight 服务，或在关闭网络闸门下验证 Electron Hindsight 配置、持久化和来源核验。项目记忆验证入口见[项目记忆说明](docs/engineering/project-memory.md)。 |
| `corepack pnpm test:postgres-smoke` | Postgres 迁移、持久化、策略、批准与脱敏同步。 |
| `corepack pnpm test:organization-postgres` | 在专用测试数据库中验证组织成员、隔离、配对与仓库分配。 |
| `DEVFLOW_BUDGET_TEST_DATABASE_URL=... corepack pnpm test:budget-postgres` | 在专用 Postgres 的临时 schema 验证并发预算预留、继续授权、重启与迟到用量；需数据库建 schema 权限。 |
| `corepack pnpm test:docker-smoke` / `corepack pnpm test:docker-lifecycle-smoke` | 容器启动、迁移、数据保留与恢复。 |
| `corepack pnpm test:v15-github-delivery` | 离线验证受治理分支发布与草稿 PR 交付。 |
| `corepack pnpm build:desktop-pilot` + `corepack pnpm test:v15-github-delivery-packaged-smoke` | 打包桌面端连接隔离 Postgres 和本地 GitHub 替代服务，验证交付。 |
| `corepack pnpm test:v21-retrieval-memory-evaluator` / `corepack pnpm v21:completion-status` | 冻结的检索/记忆评估与绑定候选版本的里程碑证据。 |
| `corepack pnpm test:v22-multi-agent-evaluator` / `corepack pnpm v22:completion-status` | 有界协作评估与绑定候选版本的里程碑证据。 |
| `corepack pnpm audit:production` | 根据注册表当前安全公告检查生产依赖。 |

这些命令是验证入口，不表示每个提交都已通过全部环境与发布门槛。真实提供方实验需要明确选择运行，可能消耗额度。详见[测试策略](docs/engineering/testing-strategy.md)、[演示与冒烟指南](docs/engineering/demo-and-smoke.md)及[发布证据](docs/releases/)。

<a id="current-boundaries"></a>

## 当前边界

- 产品面向自行部署的团队工作台；运营托管公共 SaaS 尚不属于当前发布范围。
- 本地执行由 Electron 负责。Web 批准不提供远程 Shell 能力，答疑对话也不能绕过流程权限。
- 项目记忆由已配对项目在 Hindsight 中的独立 bank 自动采集并经本机中继计入团队预算（ADR 0030），未配对项目暂不启用项目记忆；记忆仅作低信任背景，不能满足 Gate 条件或授权操作。会话历史与项目记忆分别保存。
- 已实现常驻阶段知识、经过评估的混合检索路径、本机 Hindsight 接入与可信本地 stdio MCP 执行；外部托管向量服务集成和远程 MCP 传输仍延期处理。
- 任务页 01–04 阶段已统一为决定页，05 PR 交付与 06 业务验收的决定页改造留待后续 UX 第 2b 批；多轮 Native Coding Harness v3 仍在独立分支（[PR #238](https://github.com/erich04/ai-devflow-studio/pull/238)）开发验证，尚未合入 `main`。
- 有界协作具备明确限制。草稿 PR 交付和业务验收不包含自动合并、生产部署或生产运维。
- macOS 已有真实窗口验证和未签名试用包；Windows 具备 CI/源码兼容性覆盖。签名安装包与完整平台发布验收仍需单独完成。

<a id="documentation"></a>

## 文档

| 需要了解的内容 | 阅读入口 |
| --- | --- |
| 项目简介 | [项目简介](docs/product/project-introduction.zh-CN.md) |
| 产品术语与历史设计 | [产品定义](docs/product/product-definition.md)、[上下文术语表](CONTEXT.md)、[架构决策](docs/adr/) |
| 任务页、决定页与 Web 控制台结构 | [工作区改造方案](docs/plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md)、[UX 第 1 批（澄清/设计）](docs/plans/ux-batch1-clarify-design-2026-10-30.zh-CN.md)、[UX 第 2a 批（开发/测试）](docs/plans/ux-batch2a-build-test-2026-10-31.zh-CN.md)、[界面设计理由](docs/product/details/ui-design-rationale.md)、[对话架构](docs/engineering/workbench-conversations.md) |
| 知识、项目记忆与上下文 | [常驻知识上下文（ADR 0025）](docs/adr/0025-resident-knowledge-context.md)、[项目记忆（Hindsight）](docs/engineering/project-memory.md)、[ADR 0030](docs/adr/0030-hindsight-project-memory.md)、[Hindsight 接入](docs/engineering/hindsight-integration.md)、[项目记忆收尾验证](docs/validation/project-memory-closeout-20261104.md)、[早期记忆与上下文验证](docs/engineering/memory-context-execution-validation.md) |
| OpenCode 编码扩展 | [问答协议](docs/engineering/opencode-question-protocol.md)、[有界子任务](docs/engineering/opencode-bounded-tasks.md)、[公开文档读取](docs/engineering/opencode-public-documents.md)、[B 工作包交付验收](docs/validation/devflow-b-delivery-20261024.md) |
| 模型设置、费用与定价目录 | [运行费用目录](docs/engineering/runtime-pricing-catalog.md)、[预算继续与恢复（ADR 0027）](docs/adr/0027-request-recovery-and-budget-continuation.md) |
| 组织与租户隔离 | [部署](docs/guides/multi-organization-deployment.md)、[ADR 0023](docs/adr/0023-independent-organizations.md)、[验证](docs/validation/multi-organization-20260921.md) |
| 桌面配对 | [配对权限与诊断](docs/engineering/desktop-pairing-security.md) |
| 自行部署团队环境 | [试用部署指南](docs/guides/devflow-studio-self-hosted-pilot.md) |
| 受治理的 GitHub 交付 | [V1.5 演练](docs/guides/devflow-studio-v1.5-walkthrough.md) |
| 里程碑契约与计划 | [PRD 索引](docs/product/prd/README.md)、[路线图](docs/roadmap.md) |
| 历史功能演示 | [完整功能演练](docs/guides/devflow-studio-full-feature-walkthrough.md)（V1.3）、[V2.2 演练](docs/guides/devflow-studio-v2.2-walkthrough.md) |
| 本 README 的截图 | [源码提交、采集方法与演示数据范围](docs/guides/screenshots/workspace-redesign-20260928/README.md)；改造前的截图见[历史记录](docs/guides/screenshots/current-20260928/README.md) |
