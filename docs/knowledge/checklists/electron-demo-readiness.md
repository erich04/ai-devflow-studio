---
title: Electron 演示就绪检查清单
category: review_checklist
ownerId: u-erich
tags: electron, demo, smoke, local, github-delivery
summary: Electron 演示应证明 Desktop schema v26、生产权限边界、持久化运行时上下文与本地 MCP 审计恢复、受控 GitHub 交付以及凭据隔离。
---

<a id="electron-demo-readiness-checklist"></a>

# Electron 演示就绪检查清单

在使用桌面应用演示或验收前，先确认实际运行的是 Electron 链路。

- 使用 `corepack pnpm dev:electron` 启动应用。
- 确认窗口标题为 `AI DevFlow Studio` 或 `ai-devflow-studio`。
- 确认 Electron 启动了 `apps/desktop`，而非 `default_app.asar`。
- 确认目标桌面渲染进程监听 `127.0.0.1:5173`。
- 在信任演示结果前，清理 `5173` 上残留的 DevFlow 监听进程。
- 确认本地 SQLite 数据库报告 Desktop schema v26；运行时操作的纯元数据升级保留 v20 发件箱；迁移 v21 时不伪造检索索引行；拒绝未知的更新数据库结构版本。
- 运行打包试点版运行时探针，确认冷启动后已接受动作数仍精确为一，并保留各一条 started 和 succeeded 的本地 MCP 工具审计，绑定精确的安装修订版。
- 打开工作台并选择 Gate 节点，确认节点详情状态来自实时数据。
- 使用 `corepack pnpm test:electron-smoke` 自动验证 preload、主进程、SQLite 和本地执行行为。
- 对于 V1.5 GitHub 交付，从权威托管工作树和一个预期的已测试提交准备交付意图；绝不能信任渲染进程提交的来源、仓库、分支或提交数据。
- 确认独立的 Web Lead/Owner 通过签名会话批准精确的脱敏交付请求后，Electron 主进程才请求发布凭据。
- 确认 Electron 主进程不使用强制推送，且在业务验收前，权威 Run 已记录核实后的远端分支提交和一个匹配的草稿 PR。
- 验证修订（**Revise**）创建新的发布前修订版，并使原审批失效。
- 验证继续（**Resume**）延续同一次 `recovery_required` 尝试。
- 验证重试（**Retry**）仅在精确的前次尝试已被证明处于终态后才创建下一次尝试。
- 验证停止（**Stop**）停放精确的活动尝试，且不声称回滚了远端。
- 运行 `corepack pnpm test:v15-github-delivery-packaged-smoke`，覆盖打包应用的主进程/preload/渲染进程、本地模拟 API、本地裸仓库远端、崩溃/重启对账和凭据不落盘；不向外部 GitHub 写入。
- 确认 GitHub App 私钥留在 API，短期令牌只存在于 Electron 主进程内存中；不能进入渲染进程、SQLite、日志、证据或错误载荷。
- 确认 GitHub 交付和业务验收绝不能合并、强制推送、删除分支、发布标签，或以其他方式修改草稿 PR。
- 端口冲突或默认 Electron 欢迎页属于环境故障，必须在验收前解决。
- 本清单不授权付费模型冒烟测试；打包 GitHub 交付验证不发送模型提供方请求。
