# 工作区改造前的界面截图（2026-09-28，历史）

> **这批截图已被替代。** 它们拍摄于[工作区改造](../../../plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md)之前，展示的 Agents、测试、Skills、MCP 等一级页面和四个页签的任务页已不存在。当前界面见 [`workspace-redesign-20260928`](../workspace-redesign-20260928/README.md)。这里保留原图，供版本化的历史指南引用；目录名中的 “current” 是当时的命名。

这批截图原先供根 README 与使用指南展示当时的界面。来自 `main` 源码提交 `bf18e4aa2347f34d3816239e6bd03ff3c0ad9fd6`（包版本 2.3.0），不是已发布安装包的截图。图片原始字节、尺寸、SHA-256 和引用更新数量见 [manifest.json](./manifest.json)。

## 采集环境

- macOS，Node.js 24，pnpm 9.15.0，Electron 42.11.6。
- 通过 `corepack pnpm --filter @ai-devflow/desktop build` 构建当前桌面源码；Web 使用当前 Next.js 开发服务。
- 使用独立临时 Git 示例仓库、Electron 用户数据目录和内存演示 Team API。API / Web 分别使用本机 43910 / 43911 端口，不复用个人工作数据或生产数据库。
- 通过 Computer Use 操作实际界面并原样保存截图。Electron 全窗口为 3840 × 1608，Web 完整视口为 1280 × 720；长页面滚动至对应区域后拍摄，未拼图、裁剪或生成模拟界面。
- 截图采集过程未对示例项目执行远端推送或 PR 发布。

## 数据与验证边界

Payments API 示例包含四条本地 Run，分别处于 PR 准备、方案 Gate、开发实现和方案设计阶段。流程历史、审查、对话、用量估算及 PR 预览是预置演示记录，不是真实模型运行结果。

Health API 示例仓库的 14 项 Node 测试实际执行并通过，分为 6 项单元、4 项契约和 4 项集成测试，结果作为三条证据展示。实现和测试文件来自隔离示例仓库；设计中的 300 ms 超时要求尚未实现。这些结果不代表 DevFlow 全仓验证或生产验收。

Web 的示例摘要经正常 API 端点写入。API 保留已同步过的节点，因此方案 Gate 的图展示四个节点、三个完成（75%），不代表本地完整八节点的完成率；`Synced … node` 是当前服务生成的标题。Web 的五条 Run 包括内置演示 Run 与本次四条示例。两条工作请求、每月 $200 / 预警 $150 的预算、一条 $5 预算批准，以及 Recommended 策略 v2 在隔离环境保存；第三条请求、项目创建表单和策略 v3 预览均未提交。未调用付费模型，未推送 GitHub 或创建 PR。

桌面配对在凭据保存环节未完成，因此截图保留“未配对”状态。Skills 页面当前仍为占位提示；MCP 未配置连接器。不能将这些页面描述为已有真实团队技能、MCP 执行或已同步团队数据。

## 更新范围与未完成项

根 README 与 V0.8、V1.0、V1.2、V1.3、全量基础功能指南的旧图引用已替换。V2.2 新手手册已更新可独立重拍的页面；以下场景依赖已配对桌面、实际编码权限与精确交付来源，本次尚未复现，保留明确标注的历史图。历史验收数字与结论未改写为本次结果。

本次更新 **71 处图片引用**，新采集 **26 张图片**；另有 **11 张历史图待重拍**。

| 待重拍场景 | 原图 |
| --- | --- |
| 桌面端收到工作请求 | [08-desktop-work-request-inbox.jpg](../v2.2-beginner-manual/08-desktop-work-request-inbox.jpg) |
| 本地 Run 已创建 | [09-local-run-created.jpg](../v2.2-beginner-manual/09-local-run-created.jpg) |
| 需求门禁的门禁审查 | [11-knowledge-review.jpg](../v2.2-beginner-manual/11-knowledge-review.jpg) |
| 需求门禁可以审批 | [12-clarification-gate-ready.jpg](../v2.2-beginner-manual/12-clarification-gate-ready.jpg) |
| Coding Agent 准备启动 | [15-coding-agent-ready.jpg](../v2.2-beginner-manual/15-coding-agent-ready.jpg) |
| 依赖安装权限 | [16-bootstrap-permission.jpg](../v2.2-beginner-manual/16-bootstrap-permission.jpg) |
| 受控文件修改权限 | [17-edit-permission.jpg](../v2.2-beginner-manual/17-edit-permission.jpg) |
| Coding Agent 完成 | [18-coding-agent-completed.jpg](../v2.2-beginner-manual/18-coding-agent-completed.jpg) |
| PR 交付包已生成 | [20-pr-delivery-package.jpg](../v2.2-beginner-manual/20-pr-delivery-package.jpg) |
| 桌面端等待 Web 审批 | [21-delivery-awaiting-web-approval.jpg](../v2.2-beginner-manual/21-delivery-awaiting-web-approval.jpg) |
| Web 显示审批请求 | [22-web-delivery-approval-required.jpg](../v2.2-beginner-manual/22-web-delivery-approval-required.jpg) |

## 当前截图图集

点击图片可查看原始分辨率。以下各图均来自本次实际界面；同一张图可被多份指南引用。

### desktop-agents

![Electron 当前界面](./desktop-agents.jpg)

### desktop-clarification

![Electron 当前界面](./desktop-clarification.jpg)

### desktop-design

![Electron 当前界面](./desktop-design.jpg)

### desktop-gate-policy

![Electron 当前界面](./desktop-gate-policy.jpg)

### desktop-gate-review

![Electron 当前界面](./desktop-gate-review.jpg)

### desktop-implementation

![Electron 当前界面](./desktop-implementation.jpg)

### desktop-knowledge

![Electron 当前界面](./desktop-knowledge.jpg)

### desktop-mcp

![Electron 当前界面](./desktop-mcp.jpg)

### desktop-new-run

![Electron 当前界面](./desktop-new-run.jpg)

### desktop-pr-preparation

![Electron 当前界面](./desktop-pr-preparation.jpg)

### desktop-project-runs

![Electron 当前界面](./desktop-project-runs.jpg)

### desktop-review-content

![Electron 当前界面](./desktop-review-content.jpg)

### desktop-search

![Electron 当前界面](./desktop-search.jpg)

### desktop-skills

![Electron 当前界面](./desktop-skills.jpg)

### desktop-team-overview

![Electron 当前界面](./desktop-team-overview.jpg)

### desktop-tests

![Electron 当前界面](./desktop-tests.jpg)

### desktop-workbench

![Electron 当前界面](./desktop-workbench.jpg)

### desktop-workflow-overview

![Electron 当前界面](./desktop-workflow-overview.jpg)

### web-budget-governance

![Web 当前界面](./web-budget-governance.jpg)

### web-create-project

![Web 当前界面](./web-create-project.jpg)

### web-evidence-review

![Web 当前界面](./web-evidence-review.jpg)

### web-policy-preview

![Web 当前界面](./web-policy-preview.jpg)

### web-policy-rules

![Web 当前界面](./web-policy-rules.jpg)

### web-team-overview

![Web 当前界面](./web-team-overview.jpg)

### web-team-policy

![Web 当前界面](./web-team-policy.jpg)

### web-work-requests

![Web 当前界面](./web-work-requests.jpg)
