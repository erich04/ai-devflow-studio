# AI DevFlow Studio

**可自行部署的 AI 开发工作台，连接本地编码、团队评审与交付。**

将一个需求依次推进到澄清、设计、实现、测试、草稿拉取请求（Draft pull request）和业务验收。开发者在 Electron 中工作；评审者通过 Web 控制台核对证据、策略与费用，再批准下一步。

[快速开始](#quick-start) · [完整流程](#from-request-to-acceptance) · [架构](#architecture) · [文档](#documentation) · [项目简介](docs/product/project-introduction.zh-CN.md)

![Electron 工作台全窗口：四个阶段已完成、三组测试通过，并显示用量与已有项目对话](docs/guides/screenshots/readme-20260924/desktop-workbench.png)

_2026 年 9 月 24 日的 Electron 全窗口截图。Payments API 示例包含四个工作流实例、阶段进度、产物、三条测试结果、用量估算和已保存的对话。流程历史、审查、用量和对话内容为演示样例；示例项目中的 14 项测试确已执行。点击图片可查看原始分辨率。[截图来源与范围](docs/guides/screenshots/readme-20260924/README.md)。_

> **发布与路线图状态**：最新已发布版本是 [`v2.3.0`](https://github.com/erich04/ai-devflow-studio/releases/tag/v2.3.0)，发布时间为 2026 年 9 月 14 日。本 README 介绍当前 `main` 源码，包括此后完成的工作台、记忆、模型治理和多组织改动。使用这些改动需要从源码构建，已发布安装包不会自动包含后续源码变化。详见 [V2.3 发布说明](docs/releases/v2.3.0/notes.md)与[路线图](docs/roadmap.md)。候选版本验证、正式验收和已发布安装包分别记录。

<a id="from-request-to-acceptance"></a>

## 从需求到验收

一个 **工作流实例（Run）** 串联原始需求、产物（Artifact）、代码变更、测试、审查决策和交付记录。默认流程包含六个阶段、八个节点，其中有两个中间人工门禁（Gate）。

| 阶段 | 主要工作 | 结果 |
| --- | --- | --- |
| **需求澄清** | 将请求整理为需求、验收标准和非目标，并评审需求确认 Gate。 | 澄清产物与人工决策。 |
| **方案设计** | 阅读项目上下文，提出实现方案，并评审方案 Gate。 | 设计产物、参考依据与开发批准。 |
| **开发实现** | 在受管理的 Git 工作树中运行 Native Coding 或 OpenCode，并检查权限。 | 可审查的变更、执行轨迹与用量记录。 |
| **测试证据** | 执行项目保存的测试命令，保留实际结果。 | 绑定 Run 和节点的测试证据（Test Evidence）。 |
| **PR 交付** | 准备交付包，取得独立的 Web 批准后发布获准的提交。 | 经核验的分支头与 Draft pull request。 |
| **业务验收** | 对照需求目标，核对交付结果与证据。 | 明确的业务验收结论。 |

浏览阶段不会推进 Run。工作台区分“正在查看”与“实际进度”；同阶段的 Gate 尚未通过时显示部分完成，并提供返回当前进度的操作。精简导航、流程视图和列表视图共用同一份流程状态。

<details>
<summary>查看包含阶段卡片与证据的完整流程看板</summary>

![Electron 流程视图全窗口：澄清、设计、实现与测试已完成，PR 交付待处理](docs/guides/screenshots/readme-20260924/desktop-workflow-overview.png)

_同一示例的流程视图，展示六个阶段、任务/门禁/测试/交付卡片、产物与轨迹数量、测试结果和独立对话。截图保留完整的 2560 × 1600 应用视口。_

</details>

<details>
<summary>Electron 阶段图集：需求 → 设计 → 代码变更 → PR 准备</summary>

**1. 需求澄清：原始请求、验收标准与非目标**

![Electron 全窗口：展开的需求澄清产物与原始请求，右侧保留项目对话](docs/guides/screenshots/readme-20260924/desktop-clarification.png)

_Run 仍停留在 PR 准备阶段，用户正在浏览已完成的澄清节点。阅读区展开了目标、验收标准与范围边界。_

**2. 方案设计：模块职责、取舍与评审问题**

![Electron 全窗口：支付幂等方案、组件职责与设计评审对话](docs/guides/screenshots/readme-20260924/desktop-design.png)

_幂等性示例将拟议模块、数据库一致性边界、测试计划和发布顺序问题串联起来。其方案评审 Gate 仍未通过。_

**3. 开发实现：变更文件与示例仓库的真实 Git 差异**

![Electron 全窗口：变更文件摘要、展开的 Git 差异，以及测试和交付进度](docs/guides/screenshots/readme-20260924/desktop-implementation.png)

_产物包含隔离示例仓库的真实差异，涉及实现文件与测试文件。流程历史和对话仍为演示样例。_

**5. PR 准备：交付范围、测试证据与剩余检查**

![Electron 全窗口：展开的 PR 准备材料，包含变更文件、已通过的示例测试与未完成的交付检查清单](docs/guides/screenshots/readme-20260924/desktop-pr-preparation.png)

_人工编写的 PR 材料预览用于展示交付阅读区，其中明确记录尚未实现的超时要求和待完成的团队批准。该示例没有发布 PR，也没有完成业务验收。_

</details>

<a id="agents-and-conversations"></a>

## 智能体与独立对话

| 能力 | 当前实现 |
| --- | --- |
| **澄清与设计** | Direct Provider 或只读 OpenCode 分析生成正式阶段产物；可以为当前节点选择模型。 |
| **独立对话** | Direct Provider 或 OpenCode 可查询 Run、节点、产物、仓库文件及已配置的知识。每个会话分别保存历史、草稿、问题和执行方式。 |
| **编码** | 共享的编码执行器（Coding Executor）契约支持 OpenCode 和有明确边界的 Native Coding。Native v2 支持仓库调查、多文件变更集（Change Set）、明确批准、受管理工作树内的修改、已保存的测试命令及有限次数修复。 |
| **门禁审查（Gate Review）** | 根据知识提出意见、证据缺口、建议测试和策略建议，帮助人工判断是否批准。模型不会批准 Gate。 |
| **有界协作** | 高级 Supervisor/Specialist 运行时采用预先定义的任务依赖图、共享预算、限定能力和工作区单写入者租约。详见 [V2.2 契约与评估范围](docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md)。 |

浏览流程时，独立对话保留在节点详情旁。新建会话时可选择执行方式，也可从历史记录重新打开会话，或通过会话页签菜单查看详情和模型调用记录。讨论可以保存为**待确认的节点提案**；保存本身不会修改代码、批准 Gate 或发布 PR。

<a id="knowledge-memory-and-evidence"></a>

## 知识、记忆与证据

- **仓库知识**：Git 管理的 Markdown 是规范、决策、检查清单和项目上下文的可审查来源。检索结果带有引用；知识关系视图连接文档、术语和流程证据。
- **智能体记忆（Agent Memory）**：被接受的运行时结果可以存为候选项。当前产品要求人工明确提升候选项，才能形成持久记忆。编码时自动召回符合条件的已保存记忆，并检查作用范围、修订版本、过期和删除状态。尚未实现每次 Coding Run 后自动学习。
- **有界上下文**：Native Coding 和 OpenCode 共用编码任务简报（Coding Brief）。已有摘要与明确约束用于压缩较早上下文，同时保留当前请求和选定的记忆。这是一种有长度边界的抽取式压缩。
- **真实证据**：编码完成时，系统对照当前产物、代码差异和实际执行的测试记录检查结果。成功的评估样例不能替代缺失或过期的证据。记忆和模型建议均不能满足 Gate 条件或授权操作。

实现边界与实验记录见[记忆与上下文验证](docs/engineering/memory-context-execution-validation.md)、[记忆生命周期 ADR](docs/adr/0018-scoped-agent-memory-lifecycle.md)和[编码上下文 ADR](docs/adr/0021-coding-memory-context-and-evidence-evaluation.md)。

![Electron 全窗口：待批准的方案 Gate、就绪检查、策略详情与已有设计评审对话](docs/guides/screenshots/readme-20260924/desktop-gate-review.png)

_第二个示例 Run 展示待批准的方案 Gate、就绪检查与策略详情，右侧保留关于并发、发布顺序和兼容性的讨论。设计、审查和对话均为明确标注的预置演示记录，Gate 仍未获批准。_

<a id="team-collaboration-and-delivery"></a>

## 团队协作与交付

当前 Web 界面包含工作台、团队概览、项目设置、预算和策略页面。历史 `/legacy-shell` 地址会重定向到当前界面。

- **项目与请求**：创建团队项目（Team Project），提交工作请求（Work Request），再由已配对桌面端明确领取。有效项目成员可以为自己生成有期限、仅能使用一次的桌面配对码。
- **组织**：独立组织、成员关系、邀请、切换、归档/恢复和限定组织范围的 GitHub 仓库分配已实现，由 `DEVFLOW_MULTI_ORGANIZATION_ENABLED=true` 开启。默认入门流程仍为单团队模式。详见[部署指南](docs/guides/multi-organization-deployment.md)。
- **预算与策略**：查看用量、配置项目策略和预算、评审批准或修复请求。当权威预算上下文不可用或超出作用范围时，付费 Coding 与 Gate Review 运行时在调用提供方前拒绝继续；受治理的模型调用也覆盖阶段生成和工作台对话。
- **可恢复同步**：持久化发件箱保存脱敏同步任务，支持有限次数重试与重启恢复。桌面端仍是本地 Run 和完整执行记录的权威来源。
- **GitHub 交付（GitHub Delivery）**：交付意图（Delivery Intent）绑定精确提交、Run 版本、测试、仓库绑定和交付包。发布前必须取得独立签名的 Web 批准。遵循最小权限的 GitHub App 支持推送获准的精确分支，并通过 API 核验 Draft pull request。DevFlow 永不合并代码，也不强制推送、删除远端分支或发布标签。

![Web 团队概览全窗口：成员、项目费用估算、不同阶段的 Run 与三组已通过测试摘要](docs/guides/screenshots/readme-20260924/web-team-overview.png)

_Next.js 团队概览展示示例成员、项目费用、Run 状态与测试证据。隔离的演示 API 通过正常端点接收脱敏示例摘要。完整截图与源码提交见[截图记录](docs/guides/screenshots/readme-20260924/README.md)。_

<details>
<summary>Web 控制台图集：工作请求 → 证据与评审 → 预算 → 团队策略</summary>

**1. 工作请求：提交需求与查看待领取队列**

![Web 控制台全窗口：三条已保存请求、填写中的新请求草稿与项目/Run 选择器](docs/guides/screenshots/readme-20260924/web-work-requests.png)

_隔离的 Team API 保存了三条示例请求；填写中的表单是尚未提交的第四条草稿。桌面端须明确领取请求后才创建本地 Run。_

**2. 证据与人工评审：核对进度，再批准下一阶段**

![Web 全视口：交付指标、八个流程节点、38% 进度，以及带有评审草稿的待批准方案 Gate](docs/guides/screenshots/readme-20260924/web-evidence-review.png)

_页面滚动到证据链，八个节点与待处理的人工决策完整可见。本演示预置了完整 Run 图；评审意见尚未提交。_

**3. 预算治理：额度、用量记录与限定范围的批准**

![Web 设置全窗口：已保存项目预算、两条演示预算批准与填写中的批准草稿](docs/guides/screenshots/readme-20260924/web-budget-governance.png)

_示例使用每月 $200 的额度、$150 的预警阈值和两条批准记录展示控件。费用为演示值，没有调用付费模型。_

**4. 团队策略：规则动作、最低要求与修复指引**

![Web 团队策略全窗口：已保存的 Recommended 预设、规则动作、最低要求和项目生效策略](docs/guides/screenshots/readme-20260924/web-team-policy.png)

_演示 Owner 通过实际 Web 编辑器将内置 Recommended 预设保存为策略 v2。页面区分已保存的团队策略与桌面端上次同步的策略快照。_

</details>

<a id="architecture"></a>

## 架构

DevFlow 是采用 TypeScript/pnpm 的单一仓库，围绕**本地执行、团队治理与共享领域规则**构建。Electron 管理权威开发 Run 和仓库操作；Team API 管理协作权限与共享记录。两端共同使用 `@ai-devflow/shared` 校验流程迁移、证据、策略和版本化契约。

<a id="system-and-process-boundaries"></a>

### 系统与进程边界

```mermaid
flowchart TB
    subgraph Local["开发者电脑"]
        UI["Electron 渲染进程<br/>React + Vite 工作台"]
        Main["Electron 主进程<br/>流程、执行与同步"]
        SQLite[("SQLite / LocalStore<br/>本地状态与证据")]
        Git["仓库与 Git 工作树<br/>代码、Markdown、差异、测试"]
        UI -- "类型化 preload / IPC" --> Main
        Main <--> SQLite
        Main <--> Git
    end
    subgraph Team["团队服务"]
        Web["Next.js Web 控制台<br/>请求、评审、策略、预算"]
        API["Node.js Team API<br/>身份认证、协作、交付"]
        Postgres[("PostgreSQL<br/>团队记录与摘要")]
        Web -- "签名会话 / HTTP" --> API
        API <--> Postgres
    end
    Models["已配置的模型提供方"]
    GitHub["GitHub<br/>获准分支与草稿拉取请求"]
    Main <-- "限定范围的 HTTP<br/>同步、领取、命令轮询" --> API
    Main -- "选定的任务上下文" --> Models
    API -- "服务端门禁审查" --> Models
    Main -- "推送获准的精确提交" --> GitHub
    API -- "核验远端分支头 / 创建草稿 PR" --> GitHub
```

箭头表示运行时通信或本地访问。API 到桌面端的方向表示响应与轮询取得的命令。Desktop、Web、API 和 Worker 都导入 `@ai-devflow/shared`；它是代码库，无需作为服务部署。

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
| **阶段生成与对话** | 澄清/设计生成正式产物；项目对话通过有限定范围的只读工具调查流程、产物、仓库文件和知识。Direct Provider 与只读 OpenCode 是两种执行选择。 | [`workflow-agent.ts`](packages/shared/src/workflow-agent.ts)、[`workbench-conversation-service.ts`](apps/desktop/electron/workbench-conversation-service.ts) |
| **编码编排** | `coding-runtime` 准备受管理工作树和 Coding Brief，检查权限与预算，调用选定执行器，归档差异、测试、用量和结果。Native Coding 与 OpenCode 共用 Coding Executor 契约。 | [`coding-runtime.ts`](apps/desktop/electron/coding-runtime.ts)、[`coding-executor.ts`](apps/desktop/electron/coding-executor.ts)、[`native-coding-executor-v2.ts`](apps/desktop/electron/native-coding-executor-v2.ts) |
| **有界运行时与协作** | 观察、行动、评估、检查点保存组成有明确限制及恢复能力的执行循环。Supervisor/Specialist 协作增加预定义任务依赖、限定权限、共享预算与工作区归属；与单次阶段生成或审查调用分别建模。 | [`agent-runtime-runtime.ts`](apps/desktop/electron/agent-runtime-runtime.ts)、[`specialist-runtime-coordinator.ts`](apps/desktop/electron/specialist-runtime-coordinator.ts) |
| **知识与记忆** | 仓库 Markdown 建立索引用于检索和引用。版本化、限定范围的记忆经人工明确提升后可进入编码上下文。私有会话历史单独保存。 | [`repository-knowledge.ts`](apps/desktop/electron/repository-knowledge.ts)、[`coding-context.ts`](apps/desktop/electron/coding-context.ts)、[`agent-memory-human-actions.ts`](apps/desktop/electron/agent-memory-human-actions.ts) |
| **工具与 MCP** | 主进程管理的注册表校验工具定义与执行权限。可信本地 stdio MCP 安装与 OpenCode 对话临时只读 MCP 桥接各有边界。 | [`native-tool-registry.ts`](apps/desktop/electron/native-tool-registry.ts)、[`local-mcp-client.ts`](apps/desktop/electron/local-mcp-client.ts)、[`workbench-mcp-bridge.ts`](apps/desktop/electron/workbench-mcp-bridge.ts) |
| **模型调用治理** | 受治理调用在发出前预留预算、记录尝试，再结算实际报告的用量或不确定结果。未完成记账须先对账，再进行下一次计费；运行时与权限限制仍独立生效。 | [`governed-provider.ts`](packages/shared/src/governed-provider.ts)、[`model-call-budget.ts`](apps/api/src/repositories/model-call-budget.ts) |

<a id="state-ownership-and-collaboration"></a>

### 状态归属与协作

| 数据或决策 | 权威归属 | 跨边界传递的内容 |
| --- | --- | --- |
| 权威 Run、完整节点图、产物、执行/检查点状态、差异、测试输出、私有对话与记忆正文 | **Electron / 本地 SQLite 与文件** | 白名单内的 Run、测试、审查、编码、运行时、记忆和协作摘要；不包含对话。 |
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

首次阅读代码，建议依次查看 **[`domain.ts`](packages/shared/src/domain.ts) → [`workflow-transition.ts`](packages/shared/src/workflow-transition.ts) → [`workflow-runtime.ts`](apps/desktop/electron/workflow-runtime.ts) → [`main.ts`](apps/desktop/electron/main.ts) → [`server-request.ts`](apps/api/src/server-request.ts)**，再查看相关桌面或 Web 视图。设计理由可从[数据归属](docs/adr/0003-postgres-sqlite-data-boundary.md)、[有界运行时](docs/adr/0014-bounded-agent-runtime.md)、[记忆生命周期](docs/adr/0018-scoped-agent-memory-lifecycle.md)、[多智能体协作](docs/adr/0019-bounded-multi-agent-coordination.md)和[组织隔离](docs/adr/0023-independent-organizations.md)开始。

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

这些开发标志启用确定性的流程/审查提供方和模拟编码引擎。本次演练在 **Agents** 中选择 **Deterministic Fake Provider**，不会调用付费模型。选择仓库并创建 Run 后，桌面端会显示相应内容。对网络开放的部署应关闭演示身份认证。

1. 选择一个已提交的小型 Git 仓库，保存检测到的测试命令。
2. 创建 Run，填写具体请求和验收标准。
3. 生成澄清与设计，核对材料，并评审人工 Gate。
4. 从开发节点运行编码，检查权限和工作树差异，再执行测试。
5. 核对产物、测试、轨迹与用量。真实 GitHub 发布还需要团队配置、仓库绑定和独立交付批准。

日常使用时，省略演示标志，在 **Agents** 中配置所需提供方/执行器，并在付费模型调用前完成团队项目配对与预算设置。凭据和执行方式需要明确配置；安装 DevFlow 不会自动配置模型提供方。

`corepack pnpm dev:desktop` 仅启动浏览器渲染预览。目录选择、本地命令、流程写入和编码执行需要 `corepack pnpm dev:electron`。

<a id="start-a-local-team-without-github-login"></a>

### 无需 GitHub 登录，启动本地团队环境

创建专用本地 PostgreSQL 数据库，API 和 Web 使用相同的回环主机名：

```bash
export DEVFLOW_DATABASE_URL='postgres://postgres:devflow@127.0.0.1:5432/devflow_local'
export DEVFLOW_ENABLE_DEMO_DATA=false
export DEVFLOW_LOCAL_AUTH_ENABLED=true
export DEVFLOW_REQUIRE_AUTH=true
export DEVFLOW_WEB_APP_URL='http://127.0.0.1:4311'
export HOST='127.0.0.1'

corepack pnpm --filter @ai-devflow/api db:setup
corepack pnpm --parallel --filter @ai-devflow/api --filter @ai-devflow/web dev
```

打开 `http://127.0.0.1:4311`，选择**使用本地开发身份**。在当前 Web 界面创建团队项目，通过**设置**配置预算并生成桌面配对码。在另一终端运行 `corepack pnpm dev:electron`，选择本地仓库并输入配对码完成绑定。本地开发身份要求真实 Postgres，不会启用演示种子数据，也不能替代生产身份认证。

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
| `corepack pnpm test:postgres-smoke` | Postgres 迁移、持久化、策略、批准与脱敏同步。 |
| `corepack pnpm test:organization-postgres` | 在专用测试数据库中验证组织成员、隔离、配对与仓库分配。 |
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
- 本地执行由 Electron 负责。Web 批准不提供远程 Shell 能力，对话也不能绕过流程权限。
- 记忆具有版本和作用范围；新增长期记忆仍需明确提升。会话历史与智能体记忆分别保存。
- 已实现经过评估的混合检索路径与可信本地 stdio MCP 执行；外部向量提供方集成和远程 MCP 传输仍延期处理。
- 有界协作具备明确限制。编码记忆集成没有扩展阶段/专家智能体的记忆路由。
- 草稿 PR 交付和业务验收不包含自动合并、生产部署或生产运维。
- macOS 已有真实窗口验证和未签名试用包；Windows 具备 CI/源码兼容性覆盖。签名安装包与完整平台发布验收仍需单独完成。

<a id="documentation"></a>

## 文档

| 需要了解的内容 | 阅读入口 |
| --- | --- |
| 项目简介 | [项目简介](docs/product/project-introduction.zh-CN.md) |
| 产品术语与历史设计 | [产品定义](docs/product/product-definition.md)、[上下文术语表](CONTEXT.md)、[架构决策](docs/adr/) |
| 工作台行为 | [阶段导航与会话栏](docs/validation/workflow-navigation-20260924.md)、[对话架构](docs/engineering/workbench-conversations.md) |
| 记忆、上下文与真实证据检查 | [实现验证](docs/engineering/memory-context-execution-validation.md) |
| 组织与租户隔离 | [部署](docs/guides/multi-organization-deployment.md)、[ADR 0023](docs/adr/0023-independent-organizations.md)、[验证](docs/validation/multi-organization-20260921.md) |
| 桌面配对 | [配对权限与诊断](docs/engineering/desktop-pairing-security.md) |
| 自行部署团队环境 | [试用部署指南](docs/guides/devflow-studio-self-hosted-pilot.md) |
| 受治理的 GitHub 交付 | [V1.5 演练](docs/guides/devflow-studio-v1.5-walkthrough.md) |
| 里程碑契约与计划 | [PRD 索引](docs/product/prd/README.md)、[路线图](docs/roadmap.md) |
| 历史功能演示 | [完整功能演练](docs/guides/devflow-studio-full-feature-walkthrough.md)（V1.3）、[V2.2 演练](docs/guides/devflow-studio-v2.2-walkthrough.md) |
| 本 README 的截图 | [源码提交、采集方法与演示数据范围](docs/guides/screenshots/readme-20260924/README.md) |
