<a id="adr-0001-team-platform-with-electron-developer-client"></a>

# ADR 0001：团队平台与 Electron 开发者客户端

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

产品需要访问本地仓库、配置 MCP 服务、执行终端命令和测试，同时向管理者提供跨成员、跨项目的视图。

<a id="decision"></a>

## 决策

将 AI DevFlow Studio 建设为带有 Electron 开发者客户端的团队平台。本地执行发生在开发者机器上；团队状态、审计、费用和概览数据同步到后端。

<a id="consequences"></a>

## 影响

- 桌面应用可以在明确边界内操作本地仓库和工具。
- 管理者从后端查看团队状态，而非访问仅存于个人机器的私有数据。
- 本地证据需要同步，因此产品必须明确上传和脱敏策略。
