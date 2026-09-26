# DevFlow Studio v0.8 使用指南与全量功能验收

> 历史版本说明：本文记录 2026-06-20 的版本、界面和验收范围；当时的限制与待完成项均保留，不代表当前候选版的状态。当前节点工作区布局以 #174、#177 及现行使用说明为准。历史英文按钮名以行内代码保留，便于与截图对应。

更新时间：2026-06-20
适用版本：`v0.8.1` 候选发布版。当前代码已完成 v0.8 策略驱动交付、PR #2 冒烟测试加固，以及 PR #3 的 v0.9 运行时计划及 OpenCode 真实冒烟的前置检查加固；包元数据仍为 `0.7.5`，将在 v0.8.1 演练通过后统一升级到 `0.8.1` 并创建标签。

## 结论

DevFlow Studio 现在已经具备从 `v0.1` 到 `v0.8` 的主流程能力：团队开发工作流、真实 Electron 本地执行、测试证据、知识治理、知识审查 Agent（Knowledge Review Agent）、编码 Agent 适配器、门禁策略执行（Gate Enforcement）、以及 v0.8 的处理建议与重试闭环。当前 v0.8.1 收口只做发布验收、版本对齐和演示核对，不新增运行时能力。

本轮验收使用了三层验证：

- 真实 Electron 窗口读屏：通过 Computer Use 读取 `AI DevFlow Studio` 的可访问性树，确认当前启动的是业务应用而不是 Electron 默认应用。
- 人类式点击与截图：通过 Playwright 对同一个本地 UI 执行导航、搜索、页面切换、节点选择，并保存截图。
- 自动化签收：`verify`、`build`、Electron 冒烟测试、Postgres 冒烟测试已在 v0.8.1 候选发布分支 `aa468cb` 上通过。

此外，v0.9 的真实 OpenCode 运行时冒烟测试已经增加前置检查门禁：默认仍走模拟引擎；只有同时显式设置 `DEVFLOW_RUN_OPENCODE_SMOKE=1` 和 `DEVFLOW_CODING_ENGINE=opencode-http` 时，才会进入真实模型服务商与 OpenCode 路径。

注意：当前 Computer Use 插件在本机能读屏，但点击接口调用会返回 `noWindowsAvailable`（早期也出现过 “Computer Use is not active”（电脑控制尚未启用））。所以本轮“点击模拟”由 Playwright 执行，真实 Electron 路径由 `test:electron-smoke` 覆盖。这个限制属于当前 Computer Use 工具层，不是 DevFlow UI 功能缺失。

远端 CI 注意：PR #3 最新一次远端 GitHub Actions 没有真正启动作业，GitHub 返回了
计费或消费额度（`billing/spending-limit`） 级别的提示。当前功能判断以本地 `verify`、`build`、
`test:electron-smoke` 和显式 Postgres 冒烟测试为准；处理 GitHub 计费后需要重跑 PR
检查。

## 启动方式

在项目根目录运行：

```bash
# 从 workbench 根目录进入本 Project
cd projects/agent-engineering/ai-devflow-studio
corepack pnpm dev:electron
```

启动成功后，应看到窗口标题为 `AI DevFlow Studio`，左侧有：

- 工作台
- 团队概览（Team Overview）
- 知识（Knowledge）
- Agents
- 技能
- MCP
- 测试

如果看到 Electron 默认欢迎页，说明没有用 DevFlow 的应用路径启动，应使用上面的 `corepack pnpm dev:electron`。

## 功能总览

| 版本 | 能力 | 当时状态 | 主要入口 |
|---|---|---|---|
| v0.1 | 由样例数据驱动的工作台、工作流实例、节点与门禁、基础 UI | 已完成 | 工作台 |
| v0.2 | Electron 本地仓库、测试命令识别/执行、SQLite 持久化测试证据 | 已完成 | 工作台、测试 |
| v0.3 | 团队 API、Web 与 Postgres、团队概览、同步摘要 | 已完成 | 团队概览、Web 控制台 |
| v0.4 | 知识治理、Markdown 知识索引、知识引用 | 已完成 | 知识、节点检查面板 |
| v0.5 | 知识审查 Agent、执行轨迹、Token 与费用、仅作警告的审查建议 | 已完成 | Agent 审查、Agents |
| v0.6 | 编码 Agent 适配器、托管工作树、权限转发、差异与测试证据 | 已完成 | 工作台开发节点、Agents |
| v0.7 | 可配置的门禁策略执行、策略下限、覆盖审批、离线契约 | 已完成 | 节点检查面板、团队策略 |
| v0.8 | 处理建议计划、携带策略的编码任务说明、经人工批准的重试、管理者交付摘要 | 已完成 | 节点检查面板、Agents、团队概览 |

<a id="1-工作台查看团队开发-workflow"></a>

## 1. 工作台：查看团队开发工作流

![工作台与门禁策略执行](./screenshots/14-electron-current-userdata-workbench.png)

工作台是开发者主界面。你可以在这里看到：

- 当前工作流实例：例如 `为 Payments API 增加 /health 端点`
- 六阶段流程：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收
- 本地仓库：当前 Electron 连接的本机项目路径
- 测试命令：例如 `corepack pnpm test`
- 节点检查面板：选中节点后的门禁、知识、Agent、产物、事件信息

推荐操作：

1. 点击左侧 `工作台`。
2. 点击工作流实例列表中的当前工作流实例。
3. 点击画布中的任意节点，例如 `方案评审 Gate` 或 `本地实现`。
4. 看右侧节点检查面板是否更新为对应节点。

<a id="2-搜索快速过滤-run--artifact--knowledge"></a>

## 2. 搜索：快速过滤工作流实例、产物与知识

![搜索过滤](./screenshots/02-search-filter.png)

顶部搜索框支持按关键词过滤当前视图。可以输入：

- `api`
- `health`
- `test`
- `gate`

搜索只影响界面过滤，不会写入数据库。

<a id="3-gate-enforcement查看为什么-gate-被拦"></a>

## 3. 门禁策略执行：查看为什么门禁被拦

![门禁策略执行与处理建议](./screenshots/14-electron-current-userdata-workbench.png)

选中门禁节点后，节点检查面板会显示门禁策略执行状态。常见状态包括：

- `pass`：可以审批
- `warn`：允许审批，但有风险提示
- `blocked`：策略要求先补证据或审查
- `hard_blocked`：组织策略禁止覆盖审批，必须按处理建议修复
- `overridden`：负责人已带理由覆盖
- `blocked_policy_unavailable`：团队项目没有可用策略快照，不能降级到本地默认

v0.8 新增的 `Remediation Plan` 会把阻断原因转成可执行建议，例如：

- 运行知识审查 Agent
- 补测试证据
- 修复失败测试
- 修复 API 契约
- 同步团队策略

如果候选项适合编码 Agent，会出现 `Retry Coding` 操作。该动作仍然需要人点击批准，不会自动修改主仓库。

## 4. 本地测试证据

![测试证据页](./screenshots/05-tests-evidence.png)

测试能力来自 Electron 主进程，不是浏览器直接执行命令行。

推荐流程：

1. 在工作台左侧确认本地仓库路径。
2. 查看或编辑测试命令，例如 `corepack pnpm test`。
3. 点击 `保存测试命令`。
4. 在测试节点或节点检查面板中点击 `执行测试`。
5. 打开左侧 `测试` 页面查看最新证据。

测试证据会保存：

- 状态
- 退出码
- 耗时
- 标准输出/错误摘要
- 脱敏状态
- 关联工作流实例、节点与产物

<a id="5-knowledge-governance"></a>

## 5. 知识治理

![知识页面](./screenshots/12-electron-knowledge.png)

知识页面用于查看 DevFlow 内置知识文档、标签、引用和治理检查。

你可以用它确认：

- 当前工作流实例引用了哪些标准
- 门禁/节点应该参考哪些知识
- 哪些证据缺口仍然存在
- 检索命中只是推荐引用，不会自动变成治理证据

v0.4.x 后，知识层已经为未来 RAG 做好边界：检索命中不等于治理证据。

<a id="6-knowledge-review-agent-与-agents-页面"></a>

## 6. 知识审查 Agent 与 Agents 页面

![Agent 工作台](./screenshots/04-agent-workbench.png)

在节点检查面板中点击 `Agent Review` 后，知识审查 Agent 会读取：

- 当前工作流实例与门禁
- 当前门禁关联的完整产物内容（审查对象）
- 知识与策略引用（审查依据，不是证据）
- 当前阶段适用的测试证据；不适用或可选且为空时不会制造缺失项

它会生成：

- Agent 审查产物
- 执行轨迹
- Token 与费用
- 门禁建议
- v0.7+ Agent 策略发现项

打开左侧 `Agents` 可以查看审查历史、执行轨迹、费用，以及 v0.8 的重试记录。

门禁节点检查面板中，`引用来源` 展示知识文档、分块、相对路径、标题、哈希和明确的
词法/语义相关性；`Evidence` 只展示产物修订版本与内容摘要、审查与策略发现项、测试证据等可审计结果。同一条知识引用不会同时冒充证据。

<a id="7-coding-agent-与-v08-retry"></a>

## 7. 编码 Agent 与 v0.8 重试

![编码节点](./screenshots/09-coding-node.png)

选中 `本地实现` / 开发任务节点后，可以启动编码 Agent。当前设计原则是：

- DevFlow 不重做一个完整 OpenCode。
- DevFlow 托管编码引擎，负责上下文组装、工作树、权限、证据、门禁。
- 编码运行在托管工作树，不直接修改主仓库。
- 渲染器不传提示词；任务说明由主进程与共享层从工作流实例、节点、产物、知识、策略、处理建议中组装。

v0.8 的重试流程：

1. 门禁策略执行产生阻断或警告原因。
2. `buildRemediationPlan` 转成处理建议候选项。
3. 人在节点检查面板里点击 `Retry Coding`。
4. Electron 主进程创建 `RetryAttempt`。
5. 编码任务说明自动带上修复上下文。
6. 编码结果、代码差异、测试证据、事件持久化。

这是一条经人工批准的重试闭环，不是自动修复，也不会绕过门禁。

<a id="8-team-overview-与管理者视角"></a>

## 8. 团队概览与管理者视角

![团队概览](./screenshots/11-electron-team-overview.png)

团队概览用于管理者看项目、成员、成本、风险和交付摘要。

v0.8 后，团队侧可以看到策略驱动的交付摘要，包括：

- 警告数量
- 阻断数量
- 覆盖审批数量
- 处理建议计划数量
- 重试次数
- 剩余证据缺口

这些摘要只上传脱敏摘要，不上传本地工作目录、原始标准输出/错误、原始提示词、补丁或模型服务商密钥。

<a id="9-skills-与-mcp"></a>

## 9. 技能与 MCP

![技能](./screenshots/06-skills-management.png)

![MCP](./screenshots/07-mcp-management.png)

技能 / MCP 当前是团队开发平台的管理壳：

- 展示技能能力、状态、适用场景
- 展示 MCP 服务定义与开关
- MCP 开关本地持久化

当前不启动真实 MCP 进程，不做真实 MCP 策略执行；这些属于后续运行时扩展。

<a id="10-web-team-console"></a>

## 10. Web 团队控制台

![团队概览浏览器视图](./screenshots/08-team-overview.png)

Web 控制台用于团队/管理者侧查看同步摘要和策略配置。v0.7 后策略真源在 API/Postgres，桌面端读取和缓存策略。

团队策略包含：

- 仅警告默认策略
- 推荐的强制策略预设
- 策略下限
- 项目覆盖约束
- 负责人覆盖审批审计
- 过期策略版本拒绝

## 验收记录

本轮已通过的自动验证（2026-06-20 刷新）：

```bash
corepack pnpm verify
corepack pnpm build
corepack pnpm release:status
corepack pnpm opencode:status
DEVFLOW_DATABASE_URL=postgresql://erich@127.0.0.1:55437/devflow_v081_signoff corepack pnpm test:postgres-smoke
```

其中：

- `verify` 包含类型检查、238 个单元测试、跨平台检查、3 个浏览器端到端测试、Electron 冒烟测试。
- `build` 覆盖 API、worker、桌面渲染器、Electron 主进程与预加载脚本、web。
- `release:status` 检查包版本、发布文档、git 工作树、标签和人工演练状态；在正式创建标签前可用 `DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict` 做硬门禁。
- `opencode:status` 不接触模型服务商，只检查本机 OpenCode 可执行文件、默认模拟引擎模式、真实冒烟门禁和模型服务商配置状态。
- `postgres-smoke` 使用一次性本地 Postgres，覆盖迁移、种子数据、策略评估、覆盖审批、过期版本拒绝、概览审计，并验证 API 开发服务能在冒烟测试结束后可靠退出。

当时计划在 `v0.8.1` 标签前完成人工演练。具体发布时间安排以 [v0.8.1 正式验收计划](../plans/v0.8.1-release-signoff.md) 为准；下列待核对项不能视为已通过：

- 工作台加载
- 门禁策略执行状态、策略来源、阻断原因、处理建议计划
- Agent 审查执行轨迹、Token 与费用、审查建议
- 重试编码：处理建议操作按钮 -> 权限转发 -> 代码差异 -> 测试证据
- 开发/编码节点选择
- 测试页面证据
- Web 团队控制台的脱敏的策略、处理建议和重试摘要

<a id="人工-walkthrough-具体核对表"></a>

### 人工演练具体核对表

人工演练的目标不是重复自动化测试，而是确认真实用户能按界面理解整条
v0.8 策略驱动交付路径。建议边操作边截图或录屏，最后再运行一次
`DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict`。

| 步骤 | 入口 | 操作 | 通过标准 |
|---|---|---|---|
| 1 | Electron App | 运行 `corepack pnpm dev:electron`，确认窗口标题和左侧导航 | 看到 `AI DevFlow Studio`，且不是 Electron 默认应用 |
| 2 | 工作台 | 选中当前工作流实例，再点击 `方案评审 Gate` | 节点检查面板显示门禁策略执行、策略来源、阻断原因 |
| 3 | 节点检查面板 | 查看处理建议计划 | 至少能看到补证据 / Agent 审查 / 重试编码相关建议 |
| 4 | 节点检查面板 | 点击 `Agent Review` | Agents 页面能看到审查产物、执行轨迹、Token 与费用、审查建议 |
| 5 | 工作台开发节点 | 选中 `本地实现`，触发 `Retry Coding` 或编码 Agent 路径 | 能看到权限转发、代码差异、测试证据或对应模拟引擎证据 |
| 6 | 测试页面 | 打开 `测试` 页面 | 最新证据显示命令、退出码、耗时、脱敏状态 |
| 7 | 团队概览 | 打开团队概览 / Web 控制台 | 管理者视图显示脱敏的策略、处理建议和重试摘要，不暴露工作目录、原始日志、提示词、补丁、密钥 |
| 8 | 发布门禁 | 运行 `corepack pnpm release:status` | 只剩包版本升级、标签、人工演练等预期发布待完成项 |

真实 OpenCode 修复能力不属于 v0.8.1 验收范围；它是 v0.9 “真实 OpenCode 运行时、可观测性与演示准备” 的主线。
当前可先用 `corepack pnpm opencode:status` 复查 v0.9.1 的本机运行时契约：`opencode --version`、默认模拟引擎验证模式、真实冒烟门禁，以及模型服务商配置档是否已显式配置。
v0.9 的 5 分钟演示线见 [`devflow-studio-v0.9-demo-script.md`](./devflow-studio-v0.9-demo-script.md)。

## 当前边界

这些不是缺陷，而是当前路线图边界：

- 不做自动无审批修复。
- 不自动绕过门禁。
- 不把原始提示词、原始执行轨迹、补丁、工作目录、密钥上传到团队后端。
- MCP 真执行与 MCP 策略执行后续再做。
- RAG/向量检索后续再做；当前是为后续 RAG 预留的检索边界。
- Electron 打包、签名、自动更新还未进入正式发布阶段。
- Windows 冒烟测试已作为架构约束，但当前主要验证仍在 macOS。

## 推荐演示脚本

1. 打开 Electron：`corepack pnpm dev:electron`
2. 在工作台选中 `方案评审 Gate`，展示门禁策略执行和处理建议计划。
3. 切到知识，说明治理标准和证据缺口。
4. 回工作台点击 `Agent Review`，说明审查产物、执行轨迹、Token 费用。
5. 选中 `本地实现`，说明编码 Agent 的托管工作树和携带策略的任务说明。
6. 打开测试，展示本地测试证据。
7. 打开团队概览，说明管理者看项目、成本、策略驱动的交付摘要。
8. 打开技能/MCP，说明未来运行时扩展位置。

一句话介绍：

> DevFlow Studio 是一个团队开发者平台：开发者在 Electron 里完成本地执行、测试、知识治理和 Agent 协作；管理者在团队视角看到项目进展、策略风险、证据和成本。v0.8 开始，系统不仅能拦住门禁，还能解释为什么、建议怎么修，并让人批准后进入编码重试。
