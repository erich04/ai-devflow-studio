# H6：结算失败与 Electron 生命周期调查 — 2026-10-04

基线为 `origin/main` `8c6a501`，独立分支 `codex/hardening-h6`。本轮完成 [#202](https://github.com/erich04/ai-devflow-studio/issues/202) 的隔离复现调查；**复现了结算错误，没有复现伴随的页面关闭，Issue 仍应保持开放**。没有修改产品代码。

## 方法与结果

使用真实 Electron Main、preload、renderer、阶段执行器、持久化存储、结算客户端和内存版 Team API。每次创建临时 Git 示例仓库、独立 SQLite/档案注册表与随机端口；模型为本机 HTTP 假服务，外部请求被阻断，没有读取真实凭据或付费调用。澄清与门禁准备使用确定性假运行时，正式设计调用经过真实模型适配器和治理路径。

| 条件 | 次数 | 观察 |
| --- | ---: | --- |
| 正常模型响应、正常结算 | 1 | 保存设计，进入设计 Gate |
| 结算接口 HTTP 503 | 3 | `settlement_sync_failed`、`billing=confirmed`；不保存设计、不推进 Run |
| 结算请求连接中断 | 3 | 同上 |
| Team API 已接受结算，回执连接中断 | 3 | 同上；恢复后旧结算可重放 |
| 故障尚未恢复时主动再次执行 | 9 | 准入前补结算失败；没有新增模型请求 |
| 恢复结算服务后主动重试 | 9 | 旧结算完成，新增一次模型请求，设计保存成功 |

总计 19 次合成 HTTP 模型调用。9 次故障中每次等待 1 秒后均能通过 renderer IPC 重新加载状态，Electron 主进程仍存活；没有自动模型重试，没有窗口关闭、渲染进程退出或 WebContents 销毁事件。

按毫秒时间戳分别采集：模型响应、结算请求和响应、阶段拒绝、Playwright page close/crash、Electron window close/closed、render-process-gone、child-process-gone、WebContents destroyed/unresponsive、主进程退出。测试末尾单独强制渲染器崩溃并关闭窗口作为采集正对照，两类事件都被正确捕获；清理事件与故障实验分开标记。报告也保留有界的测试主进程 stderr，报告文件不提交。

## 复跑

```sh
corepack pnpm --filter @ai-devflow/desktop build
corepack pnpm exec tsx scripts/hardening-settlement-electron.mts
corepack pnpm exec tsc -p tsconfig.hardening-smoke.json
```

默认报告：`output/hardening/h6-settlement.json`；可用 `DEVFLOW_H6_REPORT` 指定路径。脚本退出时关闭 Electron、模型端点、代理和 Team API，并删除临时数据。

上述桌面构建、10 组实验及专用 TypeScript 检查均通过。实验脚本校准阶段修正了 Playwright 回调的转译辅助函数、假设计响应缺少必填字段、假用量没有报价三个测试夹具问题，未据此修改产品逻辑。专用类型检查同时为已有基线工具的 Electron 最小窗口尺寸补充二元组类型标注，不改变运行行为。

## 结论边界

这些条件证明结算失败可以独立出现，不能证明历史窗口关闭的原因，也不能排除更长时间、真实网络、特定主机状态或不同关闭时序导致的问题。因此没有依据为 #202 添加产品修复或关闭 Issue。后续若再次出现，需要同一轮请求、窗口事件和主进程日志的完整时间线。

H6 的假澄清/审查用量没有真实报价，测试项目显式关闭金额预算拦截；结算治理和本地补偿队列仍走真实路径。实际金额准入、用量去重和预算去重由 H7 的真实模型流程单独核对。本轮不覆盖 Postgres、签名安装包、Windows 或生产发布。
