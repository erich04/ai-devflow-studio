# DevFlow Studio v0.9 演示脚本

> 历史版本说明：本文记录 2026-06-20 的版本、界面和验收范围；当时的限制与待完成项均保留，不代表当前候选版的状态。当前节点工作区布局以 #174、#177 及现行使用说明为准。历史英文按钮名以行内代码保留，便于与截图对应。

更新时间：2026-06-20

这份脚本是 v0.9 “真实 OpenCode 运行时、可观测性与演示准备” 的演示验收草案。它不是
新的产品功能说明，而是把 v0.8.1 已完成的策略驱动交付路径和 v0.9 的真实 OpenCode
运行时目标串成一条 5 分钟可讲清楚的故事线。

当前状态：

- v0.8.1 的默认演示路径使用确定性的模拟编码引擎，适合发布演练。
- v0.9 的真实 `real opencode` 演示必须先通过 `corepack pnpm opencode:status`，再显式运行
  `corepack pnpm test:opencode-smoke`。
- 默认 `corepack pnpm verify` 仍保持模拟引擎、无模型调用成本、可重复。

## 演示前检查

在项目根目录运行：

```bash
corepack pnpm release:status
corepack pnpm opencode:status
corepack pnpm verify
```

如果要演示真实 OpenCode 运行时，再显式配置模型服务商并运行：

```bash
DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN \
ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>" \
corepack pnpm test:opencode-smoke
```

不要把模型服务商密钥写进文档、截图、执行轨迹、代码差异、PR 描述或团队同步摘要。

## 5 分钟演示线

### 0:00 - 0:30 打开真实 Electron

命令：

```bash
corepack pnpm dev:electron
```

讲法：

- 这是开发者本地工作台，不是浏览器模拟页面。
- Electron 主进程负责本地仓库、测试命令、SQLite、受控 IPC。
- 渲染器不直接访问 `fs` 或命令行。

展示：

- 左侧导航：工作台、团队概览、知识、Agents、技能、MCP、测试。
- 当前工作流实例和六阶段工作流。

<a id="030---110-gate-enforcement"></a>

### 0:30 - 1:10 门禁策略执行

操作：

1. 进入 `工作台`。
2. 选中 `方案评审 Gate` 或任意受保护门禁。
3. 展示节点检查面板里的门禁策略执行状态。

讲法：

- 门禁策略执行不是 Agent 自己判定能不能过，而是共享策略评估器的结果。
- 默认策略是仅警告；推荐预设或团队策略才会启用阻断。
- `blocked_policy_unavailable` 不会降级成宽松本地默认。

关键词：

- `Gate Enforcement`
- 策略来源、版本与同步时间（syncedAt）
- 阻断原因
- 负责人覆盖审批审计

<a id="110---145-remediation-plan"></a>

### 1:10 - 1:45 处理建议计划

操作：

1. 在门禁策略执行面板里展示处理建议候选项。
2. 指出哪些建议可由人处理，哪些可进入编码 Agent。

讲法：

- `Remediation Plan` 把阻断或警告原因转成可执行建议。
- 它不会自动修改仓库，也不会绕过门禁。
- v0.8 的核心变化是：系统不仅能拦，还能解释为什么、建议下一步。

<a id="145---230-knowledge-review-agent"></a>

### 1:45 - 2:30 知识审查 Agent

操作：

1. 点击 `Agent Review`。
2. 打开 `Agents` 页面。
3. 展示审查产物、执行轨迹、Token 与费用、审查建议。

讲法：

- 知识审查 Agent 读取工作流实例、节点、知识引用、治理检查和测试证据摘要。
- Agent 发现项默认是警告，不是强制阻断。
- 团队同步只上传脱敏摘要，不上传原始提示词、原始执行轨迹、工作目录、标准输出/错误或密钥。

<a id="230---320-retry-coding"></a>

### 2:30 - 3:20 重试编码

操作：

1. 回到被阻断/警告的门禁。
2. 点击 `Retry Coding`。
3. 审核即将执行的修复上下文。
4. 批准权限转发。

讲法：

- `Retry Coding` 是经人工批准的重试流程。
- 渲染器只传 ID 和用户补充说明，不传完整提示词。
- 编码任务说明由 Electron 与共享层从工作流实例、门禁、产物、知识、策略、处理建议中组装。
- 托管工作树隔离主仓库；差异与测试证据会被归档。

默认演示：

- 使用模拟引擎，保证可重复、无模型调用成本。

真实 OpenCode 演示：

- 只有在 `opencode:status` 和 `test:opencode-smoke` 都通过后才展示。
- 重点展示真实 OpenCode 权限转发、差异采集、工作树内测试、终止状态、清理。

<a id="320---410-runtime-observability"></a>

### 3:20 - 4:10 运行时可观测性

操作：

1. 打开 `Agents`。
2. 找到编码 Agent 运行与重试记录。
3. 展示运行时标签、终止状态、权限时间线、代码差异、测试证据、清理状态、
   Token 与费用来源。

讲法：

- v0.9 的目标是让评审者能分辨模拟引擎和真实 OpenCode 的证据来源。
- 真实运行时必须可观察：工具调用、权限、取消/超时、代码差异、测试证据都要能解释。
- `cancelled` 表示用户主动取消，`timed_out` 表示权限或运行超时，`cleanup` 事件说明
  进程与工作树清理是否完成。
- Agents 视图只展示相对仓库根目录的变更路径，不展示原始工作树与源仓库的绝对路径。
- 可观测性不是装饰 UI，而是信任边界。

<a id="410---445-tests-与-team-overview"></a>

### 4:10 - 4:45 测试与团队概览

操作：

1. 打开 `测试` 页面。
2. 展示命令、退出码、耗时、脱敏状态。
3. 打开 `Team Overview`。
4. 展示策略驱动的交付摘要。

讲法：

- 本地测试证据留在 Electron/SQLite。
- 团队侧只看脱敏摘要。
- 管理者关注阻断、警告、覆盖审批、处理建议与重试统计，而不是开发者本机原始日志。

### 4:45 - 5:00 收束

一句话：

> DevFlow Studio 把 AI 编码从“一个外部提示词框”变成团队可治理的交付流程：策略能拦、知识能解释、Agent 能审查、人能批准重试、测试能留证、管理者能看到风险和成本。

## 不要宣称

当前不要宣称这些已经完成：

- 不要宣称真实 OpenCode 是默认验证路径。
- 不要宣称系统会自动修复并自动通过门禁。
- 不要宣称 MCP 真执行或 MCP 策略执行已完成。
- 不要宣称 RAG/向量检索已经接入。
- 不要宣称 Electron 打包、签名、自动更新已经完成。
- 不要宣称 Windows Electron 冒烟测试已作为发布门禁。

## 演示通过标准

v0.8.1 发布演练：

- `corepack pnpm release:status` 只剩包版本升级、标签、人工演练待完成。
- `corepack pnpm verify` 通过。
- 人工能完成工作台、门禁策略执行、处理建议计划、Agent 审查、重试编码、测试、团队概览。

v0.9 真实运行时演练：

- `corepack pnpm opencode:status` 通过。
- `corepack pnpm test:opencode-smoke` 在显式真实调用环境下通过。
- 演示者能讲清模拟引擎证据与真实 OpenCode 证据的区别。
- Agents 页面能解释权限转发、代码差异、测试证据、终止状态和脱敏。
- Agents 页面或冒烟输出能解释清理状态；成功路径应显示托管工作树已清理。
