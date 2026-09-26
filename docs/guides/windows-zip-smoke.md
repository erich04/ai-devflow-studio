<a id="windows-zip-smoke-guide"></a>

# Windows ZIP 冒烟测试指南

当 Windows 机器无法稳定从 GitHub 克隆仓库时，可以按本指南从源码 ZIP 进行验证。范围包括源码启动、ZIP 缺少 Git 元数据时的限制，以及选择另一个本地 Git 仓库进行验证。

<a id="recommended-environment"></a>

## 建议环境

- Windows 11；Windows 10 尽力兼容。
- Node.js 24 与 Corepack。
- PowerShell。
- 验证依赖 Git 的本地项目功能时，需要 Git for Windows。

<a id="run-from-a-github-zip"></a>

## 从 GitHub ZIP 启动

下载 `main` 分支的 ZIP，解压到较短的路径，例如 `C:\dev\ai-devflow-studio`，然后在该目录打开 PowerShell。

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm dev:electron
```

`dev:electron` 会构建 Electron 主进程和 preload 产物，在 `http://127.0.0.1:5173` 启动 Vite，并打开真实桌面应用。

本地文件夹选择、受控 IPC、命令安全检查和 SQLite 持久化应当可用。

<a id="zip-git-boundary"></a>

## ZIP 的 Git 能力边界

GitHub ZIP 不包含 `.git` 目录。DevFlow 本身仍可启动，但把解压目录选为本地项目时，依赖 Git 的功能会受到限制。

预期受限的功能包括分支刷新、分支监听、受管编码工作树和 Git 差异采集。“分支”（Branch）字段应说明该文件夹不是 Git 仓库。

要进行更完整的验证，可以从解压目录运行 DevFlow，再在应用中选择另一个已提交代码、包含测试脚本的小型 Git 仓库。

检查以下行为：

- 本地项目卡显示所选仓库；
- 项目路径符合预期的 Windows 路径；
- “分支”显示所选仓库的当前分支；
- 在外部切换分支后，刷新能够反映变化；
- 新 Run 使用所选仓库，不使用演示样例数据；
- 本地测试使用检测到的项目包脚本。

<a id="optional-local-git-initialization"></a>

## 可选：初始化本地 Git

如果必须把解压后的 DevFlow 目录选为本地项目，请先初始化：

```powershell
git init
git checkout -b main
git add .
git commit -m "local windows smoke"
```

这只会创建本地 Git 状态，不会恢复原仓库历史，也不会配置远端。

<a id="current-support-boundary"></a>

## 当前支持范围

Windows 支持目前覆盖源码和开发验证。CI 在 Windows 上执行类型检查、单元测试和静态跨平台审计。

项目尚未宣称提供签名的 Windows 安装程序，也未完成 Windows Electron 全量冒烟验收。记录失败时，请包含精确命令、终端输出及源码取得方式：ZIP、克隆或打包产物。
