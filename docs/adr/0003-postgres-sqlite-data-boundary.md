<a id="adr-0003-postgres-and-sqlite-data-boundary"></a>

# ADR 0003：Postgres 与 SQLite 的数据边界

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

团队协作数据与开发者本地状态具有不同的生命周期。

<a id="decision"></a>

## 决策

使用 Postgres 作为团队数据的权威来源，在 Electron 中使用 SQLite 保存本地仓库配置、MCP 设置、草稿状态、主题偏好和离线缓存。

<a id="consequences"></a>

## 影响

- 团队仪表板中的数据保持一致且可查询。
- 敏感的本地路径和工具设置无需全局保存。
- 同步边界必须明确。
