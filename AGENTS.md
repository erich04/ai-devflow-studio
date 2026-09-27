# 仓库开发说明

通用开发入口为 [README](README.md)、[CONTRIBUTING](CONTRIBUTING.md)、[领域术语](CONTEXT.md)和根目录 `package.json`。当前主干的环境说明优先于历史 PR 中的机器快照。

## 工具链与验证

- 使用 Node.js 24 与 `corepack pnpm`；pnpm 版本由 `packageManager` 固定为 9.15.0，CI 配置见 [Verify](.github/workflows/verify.yml)。
- 更新依赖使用 `corepack pnpm install --frozen-lockfile`。
- `corepack pnpm verify` 执行类型检查、单元/组件测试与跨平台检查。其他验证入口和适用范围见 [README 的验证说明](README.md#verification)。
- 根据改动选择验证范围并记录实际结果。文档修改不能据此宣称真实模型、生产发布或签名安装包已经验证。

## 本地团队与 Electron

- API/Web 的默认端口为 4310/4311；数据库、认证和迁移步骤使用 [README 的本地团队流程](README.md#start-a-local-team-without-github-login)。验证使用专用数据库，不默认重用已有用户数据。
- 本地浏览器身份由 `DEVFLOW_LOCAL_AUTH_ENABLED` 显式启用，要求真实 Postgres。`DEV_AUTH_ENABLED` 的演示请求头路径不等于浏览器登录；正式部署配置见[自行部署指南](docs/guides/devflow-studio-self-hosted-pilot.md)。
- `corepack pnpm dev:desktop` 只有渲染预览。目录选择、本地命令、可信流程写入和编码需要 `corepack pnpm dev:electron`。
- 确定性演练使用 [README 的演示运行时配置](README.md#try-the-desktop-with-deterministic-demo-runtimes)。真实模型调用必须使用已获授权的项目、提供方与预算。

## Cursor Cloud 的环境差异

以下仅用于 Cursor Cloud 的 Linux VM，不适用于本机 macOS、Windows 或发布环境：

- 先检查 `node --version` 和 `command -v node`。历史镜像中的 `/exec-daemon/node` 曾优先于 `nvm`；应按当前镜像支持的方式选择 Node.js 24，不能假定 `nvm use` 已改变实际执行文件。
- PostgreSQL 服务、数据库、角色、迁移和虚拟显示是否已配置，取决于当前 VM。旧 PR 的 `devflow` 数据库、演示用户、密码及 `DISPLAY=:1` 只是当时环境记录，不是通用预置条件。
- 只有确认 VM 使用 Debian 的 PostgreSQL 16 cluster 时，才适用 `sudo pg_ctlcluster 16 main start`。没有 Docker 时可使用已配置的本地 Postgres 与 API/Web 开发服务。
- OverlayFS 可能拖慢 Git/文件系统集成测试。先记录具体失败；必要时针对受影响测试使用有界超时重跑，不能用全局放宽超时掩盖未调查的失败。
- 无显示环境需先配置并确认虚拟显示。旧 VM 的 Electron 曾需要 `--no-sandbox`；只在隔离开发 VM 确实无法提供 Chromium sandbox 时作为临时适配，不能把它加入桌面默认配置或发布包。
- 运行结果以本次实际验证为准。历史的测试数量、演示流程进度和 VM 噪声日志说明不能替代当前启动及功能检查。
