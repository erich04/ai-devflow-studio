# AI DevFlow Studio 项目简介

## 一句话介绍

AI DevFlow Studio 是一个面向小型研发团队的自托管 AI 交付工作台。它以 workflow 为主线，把需求澄清、方案设计、编码、测试、PR 交付和验收串起来，让 Agent 的工作可查看、可追溯、可审批。

## 最值得关注的能力

项目不只是一个流程编排器。它在一条交付流程中组织了一组职责明确的 Agent，让它们围绕同一个 Run 协作：

- 阶段 Agent 负责需求澄清和方案设计。
- 门禁审查 Agent 执行基于知识的门禁审查（Knowledge-Grounded Gate Review）：以团队知识、规则和已有证据为依据，审查当前 Gate、门禁条件及阶段产物，找出风险与缺口。
- Coding Agent 通过 OpenCode CRI 接入外部编码能力，完成代码修改、测试和结果回传。

这是一种简单的单组 Agent 模式。Agent 不需要自由对话，而是按 workflow 的阶段各自完成任务，并把结果放回同一条证据链。团队可以清楚地看到每一步做了什么、依据是什么、是否可以进入下一阶段。

## 技术特点

### 1. Workflow 是主干

项目用统一的 Run、Node 和 Gate 表达交付过程。需求、设计、实现、测试和验收不是分散的操作，而是一条有顺序、有状态、有检查点的流程。

### 2. Agent 产出直接进入交付链

Agent 生成的澄清结果、设计文档、评审意见、代码 diff 和测试结果都会成为正式证据。Gate 根据这些证据和团队规则决定流程能否继续，关键节点仍由人确认。

### 3. OpenCode 只负责执行，DevFlow 负责管理

项目不会重新实现一套 Coding Agent。通过 OpenCode CRI 接入外部运行时后，OpenCode 负责写代码，DevFlow 负责上下文组装、权限确认、worktree 隔离、diff 捕获、测试、运行记录和结果脱敏。

### 4. 本地优先，团队可见

代码、命令、原始日志和密钥保留在 Electron 桌面端。本地状态存入 SQLite；经过批准和脱敏的摘要再同步到 API、Postgres 和 Web 团队视图。

### 5. 运行时可以替换，也便于验证

Agent Provider 和 Coding Runtime 都通过明确的接口接入。项目保留可重复测试的 fake runtime，也支持显式启用真实 OpenCode，方便在开发、演示和正式验证之间切换。

## 为什么值得采用

如果团队已经在使用 AI 或 Coding Agent，但还缺少统一的需求、评审、测试和审批流程，DevFlow Studio 可以补上中间这一层。它保留现有模型和编码工具，同时让 Agent 从个人工具变成团队可以理解和管理的交付能力。

## 30 秒介绍

> AI DevFlow Studio 用一条 workflow 管理 AI 研发交付，并在流程中组织需求、门禁审查和编码 Agent。它通过 OpenCode CRI 接入真实编码能力，把权限、代码 diff、测试和运行记录统一沉淀为证据，再由 Gate 和人工审批控制交付风险。代码留在本地，团队只同步经过脱敏的结果。
