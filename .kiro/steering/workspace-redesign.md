---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*", "packages/**/*", "scripts/**/*"]
---

# 工作区改造：执行约束

适用于按 `docs/plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md`（第 4 版，已确认）推进的各批次（S0–S6）。每个批次在 `.kiro/specs/` 下有独立的 spec。动手前先读方案中与当前批次相关的章节；spec 与方案冲突时以方案为准，并把差异记回 spec。与改造无关的改动不受本文件的批次边界限制。

## 不变的约束（方案第 3 节）

- 只改呈现层与导航，复用现有写入路径。IPC 写入、同步队列的入队／重排／范围规则、交付撤销逻辑和数据库结构都不改，除非当前批次明确列出（如 S4 的方案评审审批契约）。
- Run、Node、Artifact、Event 在界面上叫开发任务、步骤、材料、执行记录；存储值与标识不变。
- 结论文字与按钮来自同一份状态投影。仅警告的策略不显示为阻断，强制阻断不显示为可以通过。
- 浏览阶段、材料或历史版本只改变查看位置，不改变实际进度和审批对象。
- 停止、取消和重要的拒绝操作始终可见，不收进「⋯」；影响当前决定的版本、角色、阻碍、未知费用和数据时效留在首层。这两条优先于控件数量等数字目标。

## 批次边界

- 只做当前批次在方案第 7 节列出的内容；范围外的问题记进方案或 spec，不顺手修。
- 每批独立、可回退。开发开关只影响界面，新旧界面不能同时发起同一动作。
- 状态投影保持不依赖 React 和 Electron。是否下沉到 `packages/shared` 按实际复用情况决定，最迟在 S5 开始前定下。

## 验证与记录

- 按 AGENTS.md 运行 `corepack pnpm verify`。界面文案变化时，同步更新 `apps/desktop/src/App.test.tsx` 与 `scripts/electron-smoke.mjs` 的文案断言，再运行 `test:electron-smoke` 与 `test:workbench-conversation-electron-smoke`。
- 走查、测量和冒烟测试使用隔离的用户数据目录与专用数据库，不重用已有用户数据。
- 如实记录运行结果，分开写明哪些使用模拟模型，哪些是真实模型或远端发布。
