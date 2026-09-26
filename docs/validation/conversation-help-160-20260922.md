<a id="conversation-help-and-creation-flow--issue-160"></a>

# 会话帮助与创建流程 — Issue #160

<a id="behavior"></a>

## 行为

- 会话信息旁的问号按钮可打开支持键盘访问、可关闭的帮助，说明共享项目来源、独立聊天/草稿、明确保存的节点提案、可用查询工具，以及 Direct Provider/OpenCode 权限。
- 不再显示纳入/省略的会话消息数量。既有上下文限制、持久化消息、模型调用设置和真实容量/失败提示保持不变。
- 加号、项目提问和节点讨论先打开创建弹窗。用户选择执行器后明确创建会话。取消不创建会话、不调用模型；预填问题保留为未发送草稿。既有会话显示已保存的执行器。
- 本次只修改渲染层，没有数据库结构、凭据、服务商选择、会话契约或工作流状态迁移。

<a id="verification"></a>

## 验证

以下为 2026-09-22 对应变更的验证记录，不代表后续版本自动通过相同检查。

- `corepack pnpm verify`：类型检查通过；300 个文件 / 4,085 项测试通过，本地跳过 15 项需显式启用的 Postgres 测试；静态跨平台检查通过。
- `corepack pnpm --filter @ai-devflow/desktop build`：通过。
- `node scripts/build-desktop-pilot.mjs`：成功构建本地未签名 macOS 包。
- `node scripts/workbench-conversation-electron-smoke.mjs`：在隔离 Electron、SQLite 和本地模拟 SSE 服务商上通过，没有使用付费模型或系统钥匙串凭据。覆盖明确创建/取消、取消后活动页签不变、帮助关闭/Escape/焦点循环、480×600 下帮助正文滚动、只读执行器标签、真实进程重启后的 Direct Provider/OpenCode 并存、未发送草稿与历史、节点查询/提案路径、有界格式错误恢复、取消，以及既有深浅主题/窗口宽度检查。
- 界面组件回归另覆盖项目切换、创建失败后保留所选执行器和预填内容再重试、归档备注、容量提示及既有节点详情。

本地截图和结构化报告位于 `out/workbench-conversation-qa/`。

<a id="rollout-boundary"></a>

## 本机更新边界

不把用户业务 Run 作为测试样例。本机更新前生成新的 SQLite 和 Postgres 备份，保留既有桌面数据目录/应用身份及运行中的 API/Web 数据库，并在重启后比对持久化记录。替换渲染层前，打包 Electron 可执行文件、Info.plist、主进程与 preload 必须与现有安装一致。各次安装的备份与数据保留结果存放在本地，并记录到更新报告。
