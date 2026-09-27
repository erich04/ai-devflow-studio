<a id="adr-0006-cross-platform-electron-compatibility"></a>

# ADR 0006：Electron 跨平台兼容性

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

AI DevFlow Studio 以 Electron 开发者客户端为核心，需要运行在团队开发者实际使用的机器上。当时本地执行切片主要在 macOS 上完成验证，但团队推广也需要支持 Windows。

<a id="decision"></a>

## 决策

将 macOS 和 Windows 都视为 DevFlow Studio 的主要桌面目标。Windows 11 是主要 Windows 目标，Windows 10 尽力兼容。

所有 Electron 本地执行、持久化和冒烟测试都必须避免仅适用于 macOS 的假设：

- 不硬编码 POSIX 路径、`/tmp`、正斜杠分隔符或特定 shell 的转义规则。
- 应用行为不能依赖 `bash`、`zsh` 或 Unix 工具。
- 使用 Node/Electron 跨平台 API，例如 `path`、`os.tmpdir()`、带明确 `cwd`/`env` 的 `spawn`，以及 Electron `app.getPath('userData')`。
- 命令安全检查必须识别 PowerShell、`cmd` 等 Windows 命令环境。
- Playwright/Electron 冒烟测试应能在 macOS 和 Windows 上运行。

Electron 打包、安装器、代码签名、公证和自动更新属于独立的发布分发事项，除非后续明确纳入，否则不属于 v0.3 范围。

<a id="consequences"></a>

## 影响

- v0.3 后端同步工作必须保持 API、Web、Electron 同步、本地执行、SQLite 存储、路径显示和自动化测试的 Windows 兼容性。
- 第一层检查为 `corepack pnpm test:cross-platform`，审查包脚本和 Node 冒烟运行器中的 POSIX 专用假设。此决策记录对应的 GitHub Actions 已运行 macOS 完整验证，以及包含类型检查、单元测试和跨平台审查的 Windows 兼容任务。
- 声称完整支持 Windows 桌面之前，应增加真实 Windows Electron 冒烟路径。
- 本地证据同步不能假设 macOS 文件路径或 shell 行为。
- 后续打包应分别处理 macOS 和 Windows 发布流程。
