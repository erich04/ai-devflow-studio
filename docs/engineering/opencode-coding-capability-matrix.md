# OpenCode 编码执行器：工具能力矩阵

适用范围：OpenCode 编码执行器（`opencode-http`）。工作台对话、只读阶段 Agent、Native 和 PR 发布权限不适用本表。
核对基线：`main` `f8a97da`；本机 OpenCode `1.18.15`。升级 OpenCode 后需要重新核对工具 schema、环境开关和子会话权限继承。

每项能力受两层规则约束，两层都放行才可使用：

1. **OpenCode 会话规则**：[`createDefaultOpencodePermissionRules`](../../apps/desktop/electron/opencode-http-adapter.ts)。规则是“`*` 拒绝，再逐项 allow/ask”。
2. **DevFlow 宿主策略**：[`classifyOpenCodePermission`](../../apps/desktop/electron/opencode-permission-policy.ts)。OpenCode 发起 ask 后，由宿主按参数和作用域决定是否交给用户审批。

会话规则为 ask，只代表 OpenCode 会提出请求，不代表 DevFlow 支持该能力。例如 `install` 在会话规则中是 ask，但宿主策略始终拒绝。

## 当前矩阵

| 能力 | OpenCode 规则 | 宿主策略 | 结论 | 拒绝类别 |
| --- | --- | --- | --- | --- |
| 工作树内读取、glob、grep、list | allow | 不经宿主（OpenCode 直接执行） | 默认允许 | — |
| 工作树内编辑、写入、补丁 | allow | 目标须为仓库相对路径，不含 `..`、`.git` 或原始 checkout | 默认允许；越界拒绝 | 安全限制 |
| `pwd`、`git branch --show-current`、`git status` | ask | 自动放行（`isAutomaticOpenCodeRead`） | 默认允许 | — |
| `git diff` 只读参数、`rg` | ask | 白名单放行，交给用户审批 | 有界授权后允许 | — |
| 本地 `test`/`lint`/`typecheck`/`build`/`check`/`verify` 包脚本 | ask | 白名单放行，交给用户审批；可选择本会话复用 | 有界授权后允许；脚本或配置变化后复用授权失效 | — |
| 依赖安装、包下载 | ask（`install`）或 bash | 拒绝 | 必须拒绝 | 安全限制 |
| 网络命令、URL、`npx`/`bunx` 等未列入白名单的包管理器调用 | ask | 拒绝 | 必须拒绝 | 安全限制 |
| Git 写入、远端、提交、worktree 操作 | ask | 拒绝 | 必须拒绝 | 安全限制 |
| 发布、部署、容器、基础设施命令 | ask | 拒绝 | 必须拒绝 | 安全限制 |
| 嵌套 shell、`eval`、内联解释器、shell 控制符与展开 | ask | 拒绝 | 必须拒绝 | 安全限制 |
| 工作树外路径、用户目录、外部配置目录 | `external_directory` 走 `*` 拒绝 | 拒绝 | 必须拒绝 | 安全限制 |
| `task` 子任务 | deny | —（未接通） | 尚未接通 | 集成未完成 |
| `question` 向用户提问 | 编码进程开启并 allow；其他进程默认关闭 | 仅当前父会话的问题；主进程复核身份、问题版本和工作区 | 已接通；回答独立于工具授权与最终验收 | — |
| 受控查询公开文档 | 无对应工具 | — | 尚未接通 | 集成未完成 |

“安全限制”表示即使集成完成也不会自动开放，需要另走明确的范围和授权流程。“集成未完成”表示 #237 计划接通，但需要先补齐归属、权限、计量和生命周期。

## 本会话复用授权的输入绑定

用户对 `pnpm test` 等包脚本命令选择“本会话复用”时，授权按完全相同的命令文本匹配，并绑定该命令实际执行内容的摘要（[`coding-command-inputs.ts`](../../apps/desktop/electron/coding-command-inputs.ts)）：

- 摘要覆盖工作树中所有 `package.json`、`pnpm-workspace.yaml`、`.npmrc`、`.yarnrc(.yml)`、`bunfig.toml`、`tsconfig*.json` 和 `*.config.{js,cjs,mjs,ts,cts,mts,json}`。跳过 `node_modules`、`.git` 和常见构建输出目录，不跟随目录符号链接。
- 每次自动复用前、回复审批前以及列出授权时都会重新计算。摘要不同时，授权以 `invalidated` 审计并撤销，下一次请求回到人工审批。
- 无法完整枚举时（目录过深、条目过多或读取失败），不允许本会话复用；用户仍可单次批准。
- 普通源码和测试文件不在摘要内。测试本身就是会执行的代码，复用授权只保证“脚本和配置没有被替换”，不代表测试无副作用。DevFlow 最终仍会独立执行标准测试并验收变更。

## 问答闭环（#237 第 2 步）

编码进程与同项目的只读进程使用不同槽位，环境开关进入配置指纹。问题经 `GET /question` 发现后以 `waiting_input` 保存，桌面支持单选、多选、自定义答案和跳过；主进程通过 `/question/:id/reply` 或 `/reject` 续接原会话。回答不会产生权限批准，也不会推进最终变更验收。

问题最多等待 30 分钟，等待时间不消耗引擎的活动执行时限。发送前复核会话、问题内容、工作区和当前操作者；重复发送幂等，回执不明确时停止续接且不自动重发。窗口刷新保留问题，应用重启使旧问题失效。详细协议、异常处理和可复现验证见 [问答闭环说明](opencode-question-protocol.md)。

## 后续（#237 第 3、4 步）

1. 有界 `task`：修正子会话权限继承（上游只继承 deny 规则）；权限发现、复核和清理按子会话归属处理；子任务计量归入当前 Coding Run；子任务全部结束前不采集结果。
2. 受控公开文档查询：结构化只读网络能力，核验目标和重定向，不开放通用 `curl`/`wget`。
