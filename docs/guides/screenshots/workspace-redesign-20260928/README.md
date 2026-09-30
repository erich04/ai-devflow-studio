# 工作区改造后的界面截图（2026-09-28）

这批截图展示[工作区改造](../../../plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md) S0–S6 之后的界面，供根 README 与当前文档引用。截图来自 `feat/workspace-redesign-s6` 分支的源码，不是已发布安装包的截图。

- 桌面端截图的源码提交为 `e20bf85`。
- Web 截图的源码提交为 `006f7b1`，它在前者基础上只修了一处 Web 侧栏样式。

改造前的截图在 [`current-20260928`](../current-20260928/README.md)，保留给历史指南引用。

## 采集方法

两部分都在隔离环境中拍摄，不使用个人数据，也没有调用真实模型。

**桌面端（`desktop/`）**
- 使用[首屏基线工具](../../../../scripts/workspace-baseline.mts)在真实 Electron 窗口中拍摄，内容区 1440 × 900，浅色主题，100% 缩放。
- 环境是隔离的用户数据目录、临时示例仓库和本机内存演示 Team API。
- 需求、方案、门禁审查、编码与对话都来自 Deterministic Fake Provider 或本机受控的模拟服务。部分步骤通过桌面 IPC 快进。
- 命令：

  ```sh
  corepack pnpm --filter @ai-devflow/desktop build
  corepack pnpm exec tsx scripts/workspace-baseline.mts \
    --samples doc-tour,clarify-gate-warn,design-gate,build-permission,test-stage,pr-ready,acceptance,discussion-messages,team-paired \
    --sizes 1440x900 --out docs/guides/screenshots/workspace-redesign-20260928/desktop
  ```

  `doc-tour` 是只用于文档截图的样例，不属于默认的 32 个基线样例。每个样例的准备方式与限制写在 [`desktop/manifest.json`](./desktop/manifest.json) 中。

**Web（`web/`）**
- 使用默认跳过的采集脚本 [`tests/e2e/doc-screenshots.spec.ts`](../../../../tests/e2e/doc-screenshots.spec.ts)，在 e2e 的隔离环境中拍摄：内存 API 加演示数据、临时会话密钥、Next.js 开发服务。
- 截图左下角的 “N” 是 Next.js 开发模式的标记，不属于产品界面。
- 命令：

  ```sh
  DEVFLOW_CAPTURE_DOC_SCREENSHOTS=1 corepack pnpm test:e2e tests/e2e/doc-screenshots.spec.ts
  ```

  脚本通过正常的同步接口上传一个停在方案评审的任务（带材料快照）和一条脱敏测试摘要。另一条停在方案评审、没有材料快照的任务来自演示种子数据。
- 文件尺寸和 SHA-256 见 [`web/manifest.json`](./web/manifest.json)。

## 数据边界

- 示例正文（如 “Template design”“Fake coding run completed …”）是模拟运行时的固定模板，不代表真实模型的输出质量或耗时。
- 截图中的测试结果来自示例仓库里实际执行的检查命令。它只验证模拟编码留下的标记文件，不代表 DevFlow 全仓验证。
- Web 上的步骤名（如 “Synced design node”）和请求说明（“Synced from DevFlow Electron.”）由当前同步投影生成，不是界面文案。
- 截图中没有 GitHub 交付请求：离线环境没有仓库绑定。交付审批卡的界面见 [S5 实施报告](../../../validation/workspace-redesign-s5-20260928.md) 与组件测试。
- 没有推送代码、创建 PR 或调用付费模型。

## 桌面端

| 文件 | 内容 |
| --- | --- |
| `desktop/shots/clarify-gate-warn-1440x900.jpg` | 需求确认 Gate：策略仅警告、尚未运行门禁审查，同屏有「运行门禁审查」与「确认需求 v1」 |
| `desktop/shots/design-gate-1440x900.jpg` | 方案评审 Gate：状态行写明所审方案与记录时间 |
| `desktop/shots/build-permission-1440x900.jpg` | 开发实现：待处理的权限请求，批准与拒绝在状态行 |
| `desktop/shots/test-stage-1440x900.jpg` | 测试证据步骤 |
| `desktop/shots/pr-ready-1440x900.jpg` | PR 交付：可以准备交付 |
| `desktop/shots/acceptance-1440x900.jpg` | 业务验收步骤（离线无法走到，由本地库改写得到，只用于布局） |
| `desktop/shots/discussion-messages-1440x900.jpg` | 展开的讨论栏与一次受控对话 |
| `desktop/shots/team-paired-1440x900.jpg` | 已连接团队的任务页 |
| `desktop/shots/doc-tour-task-current-work-1440x900.jpg` 等 | PR 交付步骤的「当前工作」「材料与版本」「执行记录」三个页签 |
| `desktop/shots/doc-tour-task-history-clarify-1440x900.jpg`、`…-history-build-…` | 浏览已完成的步骤时，“正在查看历史步骤”与实际进度同时显示 |
| `desktop/shots/doc-tour-knowledge-1440x900.jpg` | 知识页：仓库 Markdown 索引与按文档分组的引用 |
| `desktop/shots/doc-tour-team-1440x900.jpg` | 团队页 |
| `desktop/shots/doc-tour-settings-{project,models,extensions,team}-1440x900.jpg` | 设置：本地项目、模型与执行方式、扩展能力、团队连接 |

## Web

| 文件 | 内容 |
| --- | --- |
| `web/web-todo.png`、`web/web-todo-390.png` | 我的待办（1440 与 390 宽） |
| `web/web-task-detail.png`、`-full.png`、`-dark.png` | 任务详情：审批区写明所审材料、审批角色与你的角色 |
| `web/web-project-tasks.png` | 项目任务：团队请求与开发任务 |
| `web/web-team.png` | 团队 |
| `web/web-settings-{budget,policy,desktop,github}.png` | 设置：预算、策略、桌面连接、GitHub 仓库 |
