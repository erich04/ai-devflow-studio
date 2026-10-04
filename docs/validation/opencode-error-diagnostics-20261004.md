# OpenCode 错误分类与诊断传递：第一批本地验证

日期：2026-10-04。工作分支：`codex/opencode-error-reporting`；创建基线：`8c6a50172beff3198f4ae4a7a98f2a24a2f97dae`。这是本地实现和确定性验证记录，不代表真实模型、生产发布或签名安装包验收。

## 实现范围

- 保留 `StageAgentTerminalReason`，增加可选、版本化的 `StageAgentFailureDetails`：白名单分类、来源、固定安全提示、合法 HTTP 状态、非敏感中继调用标识及有界清理失败列表。旧 Trace 不必迁移；读取时忽略未知版本和未知字段，重新生成安全提示。
- 仅运行时启动失败使用 `cli_unavailable`。预算拒绝、服务商鉴权、限流、服务不可用、网络、上下文、格式、输出长度和内容过滤有独立诊断；本机 OpenCode HTTP 403 不代表服务商密钥无效。中继也会分类响应 JSON、用量格式及接收容量错误，不修复模型输出。
- 中继使用每实例随机标识及递增调用序号，在错误响应头 `x-devflow-relay-request` 中返回关联标识。适配器仅从 APIError 的 `data.responseHeaders` 提取这一白名单字段。当前执行游标之后、且仍是最新调用的错误才可细化通用 APIError；缺少匹配证据时保留通用分类，不猜测预算原因。
- 阶段执行器、主进程包装和共享阶段逻辑保留诊断、已发生用量及预算调用引用。失败审计写入 SQLite Trace；IPC 传可读摘要；节点“执行记录”读取持久化诊断，重开页面仍能显示。失败不生成正式产物、不推进 Run。
- Gate Review 复用分类器并保存失败 Trace。Coding/Chat 继续使用原来的 `usageSince` 接口及结算口径；新的阶段/Gate 路径使用执行游标。预算拒绝和诊断分类不改变既有费用结算。
- 会话中止、进程停止、profile 清理及中继关闭失败成为次要诊断，不覆盖已有错误。原执行成功而清理失败时仍拒绝提交产物。中继关闭幂等并等待在途结算，最长 5 秒；受管阶段取消最多等待 10 秒，超时仍保存本执行的已知用量，并保留未结算轮次的不确定性。共享输入校验尚未进入执行器时，主进程也会关闭中继。

## 确定性证据

`apps/desktop/electron/opencode-failure-chain.test.ts` 使用隔离 Git 仓库、真实本地 HTTP 中继、OpenCode 协议替身、真实阶段包装链及 SQLite 重新打开，检查：预算拒绝的上游请求数为零；先成功再拒绝仍保留费用和调用 ID；401/403/429/503 的来源；清理失败优先级；取消；失败无产物、无流程推进；错误正文、提示、凭据和绝对路径哨兵不进入审计或 IPC。

其他回归覆盖成功重试后的旧错误、不同中继实例、迟到并发失败、未完成调用的取消快照、Gate 审查、Direct Provider、Coding HTTP 引擎、Workbench Chat 及界面失败后加载/重开。用例先复现旧的 `cli_unavailable` 误分类和中继格式误分类，再验证修复。

## 实际验证

工具链：Node.js `v24.18.0`、Corepack pnpm `9.15.0`；执行了 `corepack pnpm install --frozen-lockfile`，依赖清单和锁文件未修改。

| 命令 | 本轮结果 |
| --- | --- |
| 第一组针对性测试（阶段、Gate、审计、共享逻辑、Coding/Chat，10 个文件） | 187 项通过 |
| 最终中继/阶段/Gate/Coding/Chat 回归（5 个文件） | 104 项通过，包含后来新增的格式与取消用例 |
| `corepack pnpm verify` | 通过：类型检查通过；348 个测试文件通过、1 个跳过，4,697 项通过、15 项跳过；跨平台检查通过 |
| `corepack pnpm --filter @ai-devflow/desktop typecheck` | 最后一次测试夹具和中继调整后补跑，通过 |
| `corepack pnpm build` | 通过；Vite 保留已有的大 chunk 提示 |
| `corepack pnpm test:e2e` | 41 项通过、1 项跳过（需显式启用的文档截图用例） |
| `corepack pnpm test:electron-smoke` | 首轮及最终代码重跑均通过；包含最终桌面端重新构建 |
| `git diff --check` | 通过 |

浏览器/Electron 脚本使用隔离端口、演示 API、临时 Git 仓库和独立 Electron 用户数据目录。启动时显式移除继承的数据库连接配置；没有复用其他任务的数据库或应用数据，没有调用收费模型。未改 API/Postgres 策略或同步协议，本批未运行独立 Postgres 冒烟。

全量测试的 15 项跳过来自需专用环境的组织 Postgres 用例。组件测试仍输出既有的 React `act(...)` 提示；本轮没有据此放宽超时或跳过新增测试。

## 后续边界

第二、三批费用来源列表、用量重传和人工核对未实施。未重做 #207–#209，未处理 H5 响应修复、H6 Web 结算竞态或真实模型全流程验收。真实 OpenCode/服务商是否在所有错误变体中保留关联响应头，本轮没有收费模型证据；缺失响应头时按上述保守规则分类。没有自动重跑模型、推送或合并。

## 收尾评审补充

2026-10-04 对第一批固定 diff 做规范与需求两方面只读评审。规范方面未发现实质问题；需求方面发现用户取消后、清理跨过原执行期限时可能被改报超时。已先增加假时钟回归复现，再固定首次中止原因；`corepack pnpm exec vitest run packages/shared/src/workflow-agent.test.ts` 实际 33 项通过。后续第二、三批由用户在同一分支另行授权，保留本报告对第一批验证范围的描述。
