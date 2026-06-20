# DevFlow Studio v0.9 演示脚本

更新时间：2026-06-20

这份脚本是 v0.9 `Real opencode Runtime + Observability + Demo Readiness` 的演示验收草案。它不是
新的产品功能说明，而是把 v0.8.1 已完成的 policy-aware delivery 路径和 v0.9 的 real opencode
runtime 目标串成一条 5 分钟可讲清楚的故事线。

当前状态：

- v0.8.1 的默认演示路径使用 deterministic fake coding engine，适合 release walkthrough。
- v0.9 的真实 `real opencode` 演示必须先通过 `corepack pnpm opencode:status`，再显式运行
  `corepack pnpm test:opencode-smoke`。
- 默认 `corepack pnpm verify` 仍保持 fake-engine、无 provider 成本、可重复。

## 演示前检查

在项目根目录运行：

```bash
corepack pnpm release:status
corepack pnpm opencode:status
corepack pnpm verify
```

如果要演示真实 opencode runtime，再显式配置 provider 并运行：

```bash
DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN \
ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>" \
corepack pnpm test:opencode-smoke
```

不要把 provider key 写进文档、截图、trace、diff、PR 描述或团队同步摘要。

## 5 分钟演示线

### 0:00 - 0:30 打开真实 Electron

命令：

```bash
corepack pnpm dev:electron
```

讲法：

- 这是开发者本地工作台，不是浏览器 mock。
- Electron main process 负责本地仓库、测试命令、SQLite、受控 IPC。
- renderer 不直接访问 `fs` 或 shell。

展示：

- 左侧导航：工作台、Team Overview、Knowledge、Agents、Skills、MCP、测试。
- 当前 Run 和六阶段 workflow。

### 0:30 - 1:10 Gate Enforcement

操作：

1. 进入 `工作台`。
2. 选中 `架构 Gate` 或任意 protected Gate。
3. 展示 Inspector 里的 Gate Enforcement 状态。

讲法：

- Gate Enforcement 不是 Agent 自己判定能不能过，而是共享 policy evaluator 的结果。
- 默认策略是 warn-only；Recommended Preset 或团队策略才会启用 blocking。
- `blocked_policy_unavailable` 不会降级成宽松本地默认。

关键词：

- `Gate Enforcement`
- policy source / version / syncedAt
- blocking reason
- lead override audit

### 1:10 - 1:45 Remediation Plan

操作：

1. 在 Gate Enforcement 面板里展示 remediation candidates。
2. 指出哪些建议可由人处理，哪些可进入 Coding Agent。

讲法：

- `Remediation Plan` 把 blocking/warning reason 转成可执行建议。
- 它不会自动修改仓库，也不会绕过 Gate。
- v0.8 的核心变化是：系统不仅能拦，还能解释为什么、建议下一步。

### 1:45 - 2:30 Knowledge Review Agent

操作：

1. 点击 `Agent Review`。
2. 打开 `Agents` 页面。
3. 展示 review artifact、trace、token/cost、advisory。

讲法：

- Knowledge Review Agent 读取 Run、Node、Knowledge References、Governance Checks 和 Test
  Evidence 摘要。
- Agent finding 默认是 warning，不是 hard-block。
- 团队同步只上传 redacted summary，不上传 raw prompt、raw trace、cwd、stdout/stderr 或 secret。

### 2:30 - 3:20 Retry Coding

操作：

1. 回到被 blocked/warned 的 Gate。
2. 点击 `Retry Coding`。
3. 审核即将执行的 remediation context。
4. 批准 permission relay。

讲法：

- `Retry Coding` 是 human-approved retry flow。
- renderer 只传 ID 和用户补充说明，不传完整 prompt。
- Coding brief 由 Electron/shared 从 Run、Gate、Artifact、Knowledge、Policy、Remediation 中组装。
- managed worktree 隔离主仓库；diff/test evidence 会被归档。

默认演示：

- 使用 fake engine，保证可重复、无 provider 成本。

真实 opencode 演示：

- 只有在 `opencode:status` 和 `test:opencode-smoke` 都通过后才展示。
- 重点展示 real opencode permission relay、diff capture、worktree tests、cleanup。

### 3:20 - 4:10 Runtime Observability

操作：

1. 打开 `Agents`。
2. 找到 Coding Agent run / retry attempt。
3. 展示事件、permission decision、diff、test evidence、token/cost source。

讲法：

- v0.9 的目标是让 reviewer 能分辨 fake engine 和 real opencode 的证据来源。
- 真实 runtime 必须可观察：工具调用、权限、取消/超时、diff、测试证据都要能解释。
- Observability 不是装饰 UI，而是信任边界。

### 4:10 - 4:45 Tests 与 Team Overview

操作：

1. 打开 `测试` 页面。
2. 展示 command、exit code、duration、redaction 状态。
3. 打开 `Team Overview`。
4. 展示 policy-aware delivery summary。

讲法：

- 本地测试证据留在 Electron/SQLite。
- 团队侧只看 redacted summary。
- 管理者关注 blocked/warn/override/remediation/retry 统计，而不是开发者本机 raw logs。

### 4:45 - 5:00 收束

一句话：

> DevFlow Studio 把 AI coding 从“一个外部 prompt 框”变成团队可治理的交付流程：策略能拦、知识能解释、Agent 能审查、人能批准 retry、测试能留证、管理者能看到风险和成本。

## 不要宣称

当前不要宣称这些已经完成：

- 不要宣称真实 opencode 是默认 verify 路径。
- 不要宣称系统会自动修复并自动通过 Gate。
- 不要宣称 MCP 真执行或 MCP policy enforcement 已完成。
- 不要宣称 RAG/向量检索已经接入。
- 不要宣称 Electron packaging、签名、自动更新已经完成。
- 不要宣称 Windows Electron smoke 已作为 release gate。

## 演示通过标准

v0.8.1 release walkthrough：

- `corepack pnpm release:status` 只剩 package bump、tag、manual walkthrough pending。
- `corepack pnpm verify` 通过。
- 人工能完成工作台、Gate Enforcement、Remediation Plan、Agent Review、Retry Coding、Tests、Team Overview。

v0.9 real runtime walkthrough：

- `corepack pnpm opencode:status` 通过。
- `corepack pnpm test:opencode-smoke` 在显式 live env 下通过。
- 演示者能讲清 fake-engine evidence 与 real opencode evidence 的区别。
- Agents 页面能解释 permission relay、diff、test evidence、terminal state 和 redaction。
