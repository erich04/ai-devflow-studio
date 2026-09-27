<a id="adr-0005-v02-local-execution-first"></a>

# ADR 0005：v0.2 优先实现本地执行

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

AI DevFlow Studio 已有较完整的工作流界面，但当时的工作台仍依赖测试数据。下一步需要让桌面客户端完成真实开发动作，同时不扩展到完整团队后端、认证或 Agent 编排。

<a id="decision"></a>

## 决策

v0.2 先实现本地执行这一纵向切片：Electron 客户端选择本地仓库，检测并保存测试命令，通过受控的主进程 IPC 执行命令，并将测试证据归档到本地 SQLite。

<a id="consequences"></a>

## 影响

- 在团队同步尚未建立前，产品先获得真实的本地开发流程。
- 在该切片中，SQLite 是本地项目、测试命令、Run、产物、事件和测试证据的权威来源。
- 团队后端同步、认证、Postgres 持久化和管理者视角的真实数据属于 v0.3 的范围。
- 渲染进程不能直接访问文件系统或 shell API，必须使用 preload 暴露的命令。
