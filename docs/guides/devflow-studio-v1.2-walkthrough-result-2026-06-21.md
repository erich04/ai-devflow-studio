<a id="devflow-studio-v12-walkthrough-result---2026-06-21"></a>

# DevFlow Studio v1.2 演练结果 — 2026-06-21

<a id="summary"></a>

## 摘要

本报告记录针对 V1.2 指南的人工演练，以及首轮后实施的修复。它是历史验证记录，不代表当前候选版已完成验收。

- 指南：`docs/guides/devflow-studio-v1.2-walkthrough.md`
- 日期：2026-06-21
- 模式：本地开发；桌面使用默认模拟服务商，API/Web 使用种子数据。
- 首轮结果：部分通过。
- 后续结果：关键阻断问题已修复，并经针对性自动化验证。

主要产品界面可见且可用，包括桌面导航、门禁策略执行、知识治理、模拟知识审查、模拟编码 Agent 权限转发、编码轨迹、测试证据、Web 团队控制台和运行时预算管理界面。

首轮不能视为全部通过的正式发布演练，原因是：

- 新增指南与文档导致 Git 工作区有未提交变更，`release:status` 正确返回失败。
- 模拟编码 Agent 生成了差异与轨迹，但托管工作树没有 `node_modules`，测试证据失败。
- 已验证预算界面存在，但本轮未能确定通过浏览器界面成功提交了策略保存或批准创建。

修复后的验证：

- 模拟编码 Agent 改用零依赖标记验证命令后，`corepack pnpm test:electron-smoke` 通过。
- `corepack pnpm test -- apps/desktop/electron/coding-runtime.test.ts apps/web/app/page.test.tsx apps/web/app/lib/devflow-api.test.ts scripts/user-guide-doc.test.ts` 通过，共 38 项。
- `corepack pnpm test -- apps/api/src/routes/team-routes.test.ts` 通过，共 35 项。

<a id="commands-run"></a>

## 已运行命令

```bash
corepack pnpm test -- scripts/user-guide-doc.test.ts
corepack pnpm release:status
corepack pnpm dev:electron
corepack pnpm dev:api
corepack pnpm dev:web
```

观察结果：

- `scripts/user-guide-doc.test.ts`：9 项通过。
- `release:status`：包元数据、标签和发布文档正常；工作区有未提交变更，人工演练仍待完成。
- 明确指定应用路径后，Electron 启动了真实应用：`/Users/erich/File/claude/10-showcase/ai-devflow-studio/apps/desktop`。
- API 运行于 `http://127.0.0.1:4310`。
- Web 运行于 `http://127.0.0.1:4311`。

<a id="desktop-walkthrough"></a>

## 桌面演练

<a id="app-launch"></a>

### 应用启动

已验证：

- 窗口标题正确：`AI DevFlow Studio`。
- 在 `127.0.0.1:5173` 加载正确的应用内容。
- 侧栏可见：工作台、团队概览、知识、Agents、技能、MCP、测试。
- 项目上下文可见：Payments API、本地项目路径、测试命令。

说明：电脑控制最初选中了另一个旧工作树中的 Electron 默认应用窗口。改为指定当前完整 Electron 应用路径后恢复正常。

<a id="gate-enforcement"></a>

### 门禁策略执行

在初始门禁节点验证：

- 状态为 `blocked_policy_unavailable`。
- 审批被阻止。
- 策略来源不可用，版本为 `v0`。
- 阻断原因：团队强制策略不可用。
- 处理建议：同步团队强制策略。

这符合 V1.x 离线策略：团队项目没有缓存的权威策略时，不可静默回退到仅警告模式。

<a id="knowledge-governance"></a>

### 知识治理

已验证知识页面包含：

- Git Markdown 索引。
- API 健康端点标准。
- 本地测试证据标准。
- PR 审查就绪清单。
- Electron 演示就绪清单。
- Postgres 冒烟就绪清单。
- OpenCode 运行时验收清单。
- v0.9 演示就绪清单。
- 门禁治理 ADR。
- 技能与 MCP 使用规则。
- 可见的 Run 引用与证据链接。

<a id="knowledge-review-agent"></a>

### 知识审查 Agent

操作：从 Agents 页面运行模拟知识审查。

已验证：

- 审查已归档。
- 审查历史已更新。
- 审查了 23 条知识引用。
- 服务商显示为确定性的模拟服务商。
- 门禁建议为 `warn`，仅作警告，不阻止审批。
- 轨迹包含上下文组装、检索、模型调用和产物创建。

<a id="coding-agent"></a>

### 编码 Agent

操作：

- 选择开发任务节点 `本地实现`。
- 启动模拟编码 Agent。
- 批准权限请求。

已验证：

- 编码 Agent 操作仅在开发任务路径可见。
- 权限转发显示待批准的编辑权限。
- 批准后运行完成，记录模拟运行时、差异产物、跳过依赖准备、不计费模拟运行停用预算检查、清理状态仍为活动，以及任务说明/权限/差异/依赖准备/测试的轨迹。
- 差异产物已脱敏，可供人工阅读。
- 变更路径为 `devflow-fake-change.txt`。

发现的问题：编码工作树的测试证据失败。原始输出保留如下，含义是缺少依赖目录：

`Local package.json exists, but node_modules missing, did you mean to install?`

解释：产品正确呈现了失败。严格演示应明确说明该路径预期，或改用零依赖测试命令、执行依赖准备、在测试前准备好托管工作树。

<a id="tests-page"></a>

### 测试页面

已验证：

- 测试证据列表可见。
- 显示历史通过和失败证据。
- 新的编码工作树失败包含命令、退出码、耗时和输出。
- 摘要卡显示本地证据数、单元测试通过数、冒烟通过数和覆盖率。

<a id="web-team-console-walkthrough"></a>

## Web 团队控制台演练

<a id="launch"></a>

### 启动

已验证：

- Web 在 `http://127.0.0.1:4311` 加载。
- 页面标题为 AI DevFlow Studio。
- GitHub 登录链接可见。
- 活动 Run、待处理 PR、成员、费用、Agent 审查等看板卡可见。

<a id="team-overview"></a>

### 团队概览

已验证：

- 项目列表显示 Payments API 和 Internal Admin Console。
- 创建桌面配对码按钮可见。
- 成员与费用摘要可见。
- 运行时预算区域可见。
- 门禁策略和后端知识审查 Agent 区域可见。

<a id="runtime-budget-ui"></a>

### 运行时预算界面

已验证预算面板与以下控件存在：

- 策略：启用复选框、月度限额、预警阈值和保存按钮。
- 批准表单：请求者（`requestedBy`）、服务商（`provider`）、额外费用上限（`maxAdditionalCostUsd`）、到期时间（`expiresAt`）、原因（`reason`）及创建按钮。

尚未明确验证：通过界面保存策略，以及通过界面创建预算批准。

原因：本轮电脑控制向浏览器数字输入框填写内容不可靠。界面存在，但写操作仍需人工浏览器验证或 API/Postgres 冒烟证明。

<a id="not-covered-in-this-pass"></a>

## 本轮未覆盖

- 真实 OpenCode + 豆包/Volcengine 模型服务商冒烟。
- Docker Compose 自托管栈。
- GitHub OAuth 回调。
- 桌面配对令牌交换。
- 通过浏览器界面保存预算策略或创建批准。
- 发布演练完成标记。

<a id="findings"></a>

## 发现与处理

<a id="p1---coding-worktree-test-evidence-fails-without-dependencies---fixed"></a>

### P1 — 编码工作树缺少依赖导致测试证据失败 — 已修复

模拟编码 Agent 完成运行并归档差异，但托管工作树没有安装依赖，导致测试证据失败。

修复：

- 模拟编码 Agent 的测试证据改用零依赖标记验证命令，在托管工作树中核验 `devflow-fake-change.txt`，不运行项目包的测试命令。
- 真实 OpenCode 类引擎仍使用项目测试命令和依赖准备路径。
- `scripts/electron-smoke.mjs` 为编码 Agent 路径断言模拟标记证据，同时仍在显式项目测试路径中独立核验项目 `npm test` 证据。

验证：

- `corepack pnpm test -- apps/desktop/electron/coding-runtime.test.ts` 通过。
- `corepack pnpm test:electron-smoke` 通过。

<a id="p2---computer-use-needs-explicit-electron-app-target"></a>

### P2 — 电脑控制需要明确指定 Electron 应用

使用 `app: "Electron"` 可能选中其他工作树的旧默认应用。为可靠操作，当时指定了完整路径：

`/Users/erich/File/claude/10-showcase/ai-devflow-studio/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/Electron.app`

<a id="p2---runtime-budget-mutations-need-manualapi-verification---automated-evidence-added"></a>

### P2 — 预算写操作需要人工/API 验证 — 已补自动化证据

预算管理界面已存在，但本轮因浏览器输入自动化不可靠，未明确验证保存/创建写操作。发布验收前应通过人工或既有 API/Postgres 冒烟核验。

后续证据：

- Web 页面渲染测试确认预算面板和批准列表可渲染。
- Web API 客户端测试确认 `saveRuntimeBudgetPolicy` 调用 `PUT /api/runtime/budget-policy`。
- Web API 客户端测试确认 `createRuntimeBudgetApproval` 调用 `POST /api/runtime/budget-approvals`。
- API 路由测试确认策略保存、负责人批准创建及携带批准的预算评估流程。

命令：

```bash
corepack pnpm test -- apps/web/app/page.test.tsx apps/web/app/lib/devflow-api.test.ts
corepack pnpm test -- apps/api/src/routes/team-routes.test.ts
```

<a id="p3---release-status-is-correctly-strict"></a>

### P3 — 发布状态检查保持严格是正确行为

`release:status` 因指南/报告有未提交变更而失败，符合预期。必须先提交或撤销文档变更，才能把发布状态视为通过。

<a id="conclusion"></a>

## 结论

V1.2 演练确认桌面与 Web 主界面可见，核心模拟服务商流程可以完成审查、权限转发、差异生成、轨迹及测试证据展示。

后续修复通过自动化 Electron 冒烟解决了编码 Agent 测试证据问题。预算保存/创建已在 Web API 客户端和 API 路由层验证；若需要界面层确认，仍可补做纯浏览器的人工表单提交。

剩余发布整理事项：

- 提交或撤销指南/报告变更后，再期待 `release:status` 通过。
- 本轮没有重跑真实 OpenCode + 豆包服务商冒烟。
