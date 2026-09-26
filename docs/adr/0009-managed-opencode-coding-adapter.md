<a id="adr-0009-managed-opencode-coding-adapter"></a>

# ADR 0009：受管 opencode 编码适配器

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

DevFlow v0.5 引入知识审查 Agent，但有意不实现编码 Agent。下一步需要提供编码辅助，又不重建 opencode，也不强迫用户离开 DevFlow 使用外部 TUI。

集成必须保留 DevFlow 的产品职责：

- DevFlow 管理工作流上下文、Gate、权限转发、证据、测试和团队摘要。
- opencode 负责代码执行。
- 必须使用工作树隔离，但工作树不是安全沙箱。

<a id="decision"></a>

## 决策

通过编码 Agent 适配器，将 opencode 作为外部编码引擎承载在 DevFlow 中。

v0.6 首先实现：

- 经过技术预研验证的 HTTP 传输决策。
- 用于默认测试和演示的确定性模拟编码环境。
- 每个 Coding Agent Run 一个受管工作树。
- 针对 edit/bash/write/patch/install 类动作的权限转发。
- 测试前可见的依赖初始化步骤。
- 脱敏编码差异产物及团队摘要。

选定的真实传输方式为 `opencode serve` HTTP。直接使用 ACP 暂缓，因为 ACP 增加 stdin/stdout 协议层，取消操作仍交由底层 HTTP 会话终止路径处理。

ADR 0008 对 v0.5 仍成立：DevFlow 不自行构建编码 Agent。本决策明确，自 v0.6 起可以承载外部编码 Agent，同时保留 DevFlow 自己的工作流语义。

<a id="consequences"></a>

## 影响

- 渲染进程绝不能直接访问文件系统或 shell。
- `runCodingAgent(input)` 接受 ID 和用户指令，不接受预先构造的提示。
- 主进程/共享层根据 Run、节点、产物、知识、Gate、测试及工作树约束组装编码简报。
- MVP 中每个本地项目同时只允许一个活动 Coding Agent Run。
- 工作树依赖安装必须明确处理，不能假设 Git 工作树内已有 `node_modules`。
- 受管 OpenCode 工具批准过期时暂停运行，并保留活动会话与工作树。续期会重新检查原工作流版本、待决执行器权限、Git 边界和工作树差异，然后创建绑定原执行器请求的新本地审批 ID。过期决定保留在历史中；续期本身不批准执行，也不启动服务商调用。转发续期批准前还会再次验证。会话丢失（包括桌面重启）后不能自动恢复；现有恢复流程保留工作树，并要求明确发起新尝试。
- 真实引擎活动时，取消会将 Run 标为 `cancelled`，并终止底层会话。
- 执行授权、变更接受和依赖安装审批保留原有过期行为。真实执行超时标记为 `timed_out`，与用户取消、工具失败和意外中断区分。受管 OpenCode 的有效执行截止时间不计入等待工具审批的时间，但仍执行工具轮次和策略纠正上限。
- 获得执行授权后，可自动批准精确识别的本地检查：`pwd`、支持的普通 `git status` 形式和 `git branch --show-current`。其他受支持 shell 操作仍需批准。不支持的请求先收到策略反馈，再决定是否显示人工审批；同一会话最多提供三次纠正机会。
- 默认仍限定每个工作流 Run/节点/项目最多三次 OpenCode 尝试。用户可以明确授权紧接着的下一次额外尝试；授权记录可信操作者和当前尝试次数，并在持久化预留 Run 时再次核对。已消费授权重放会失败；先前尝试、预算控制和执行限额继续有效。
- 从 v0.9 开始，可用时将受管 `opencode serve` 进程放入 POSIX 进程组启动，先使用 `SIGTERM` 终止，再以 `SIGKILL` 兜底。工作树/进程清理记录为脱敏 Coding Agent 事件。
- 远端团队同步仅接收 `RemoteCodingAgentSummary`，不接收原始补丁、日志、提示、cwd、服务商密钥或仓库外路径。

<a id="deferred"></a>

## 暂缓事项

以下为本 ADR 对应阶段的范围边界，不代表之后的版本没有单独决策：

- 将完整 opencode HTTP 运行时作为日常验证的默认引擎。
- 单项目多 Run 并发。
- 工作树隔离之外的强沙箱。
- 缺少锁文件时，无人工批准自动安装依赖。
- 编码自动修复循环、多 Agent 交接和真实 MCP 工具执行。
