# A 工作包：真实 Electron 与结算故障验证（2026-10-23）

本轮实际完成真实 DeepSeek 的分批调查、继续、最终答复及普通无工具回复；另用独立 Electron 对结算故障运行 31 个确定性场景。两类证据分别说明，不能将本地模拟响应算作真实模型成功，也不能据此宣称 #201 / #202 的历史根因已经消除。

## 真实环境与操作

使用专属 PostgreSQL 16（schema v32）、API 15310、Web 15311、Electron CDP 19522 和预算网关 8892。UI 完成本地身份登录、合成团队项目创建、桌面配对、Provider 保存、任务与聊天创建。正常 `safeStorage` 生效，没有替换应用 `fetch` 或模型响应。

- 团队项目：`p-issues-a-live-todo`；本地项目：`local-c07c5305615e`。
- 独立合成 Todo 仓库：`output/playwright/issues-a-live/todo`，没有使用用户项目数据。
- Profile：`.tmp/issues-a-live-validation/desktop-profile`。
- 收费操作的 Electron：PID 5195，2026-10-23 16:29:15 UTC 启动，使用当时已成功构建的本轮 main。之后主任务继续构建，不能将磁盘上后续构建时间倒推为该进程的构建版本。
- 会话：`31c22a66-02f5-4103-86bc-1640b4c0d348`，`direct-provider`。

原生目录选择器无法用当前自动化直接操作，唯一准备例外是在 Electron 停止时通过产品的目录检查、`upsertProject` 注册合成仓库。前后审计确认只有 `local_projects` 变化，未预写模型、配对、聊天、流程或工具结果。依据见 `repository-registration-evidence.json`。

## 分批调查与普通回复

从真实界面将下一批设为 2 步 / 180 秒，发送按顺序读取 `README.md`、`package.json`、`src/store.js`、`test/store.test.js` 的只读问题。

| 操作 | 真实结果 | 累计请求 | 新增工具查询 |
| --- | --- | ---: | ---: |
| 首批 2 步 | 读取 README / package；生成已核实、尚缺、下一步的阶段总结，显示暂停及继续按钮 | 3 | 2 |
| 点击继续 | 接着读 store / store.test；再次到边界并总结，保留原用户消息及累计用量 | 6 | 2 |
| 下一批设为 6 步后继续 | 基于已保存材料给出最终答复，无重复查询 | 7 | 0 |
| 新问题要求仅回复固定短句 | 正常返回“好的，本轮只读调查已结束。”，不调用工具、不携带旧来源 | 8 | 0 |

SQLite 只读审计：2 条用户消息、4 条唯一工具消息、4 条助手消息（2 阶段总结、1 最终调查答复、1 普通回复）。首个问题保持同一 turn，7 请求、0 自动恢复、4 查询、2 总结。第二个新问题按预期开始新的累计计数，1 请求、0 查询；这不等于“继续”重置了旧问题的计数。

界面截图和完整可访问性快照留在 `output/playwright/issues-a-live/` 与 `.playwright-cli/`。关键文件：`01-real-direct-paused.png`、`02-real-direct-continued.png`、`03-real-direct-completed.png`、`04-real-diagnostics.png`、`direct-ui-persistence-audit.json`。

## 诊断与证据边界

点击“查看诊断”和“复制诊断”成功，导出的 `direct-all-diagnostics.json` 含 8 次调用。逐次保留 turn / step / cycle / recovery、模型和请求配置摘要、时间、200 状态、响应 ID、内容摘要、`finish_reason=stop`、tokens 及缓存 tokens；所有真实调用成功，0 自动恢复。导出没有聊天正文、代码、模型思考正文或凭据；明确标记未保留原始响应，不能重放历史失败。

读取、复制及下载诊断没有增加网关调用数。Electron CDP 的默认下载事件等待超时；只用 `Browser.setDownloadBehavior` 指定路径也未落盘。随后通过页面 CDP 的 `Page.setDownloadBehavior` 指定本轮下载目录，再点击原有“下载诊断文件”，成功生成 `downloads/devflow-diagnostics-31c22a66-02f5-4103-86bc-1640b4c0d348.json`，与 UI 复制内容一致。此设置仅替自动化选择保存路径，没有改写应用导出内容。

真实请求经过现有独立预算网关：固定 `deepseek-flash`、关闭 thinking、`stream=false`、输出上限 8,192 tokens。应用将本地代理视为自定义提供方，其诊断中的 `provider_default` 是应用请求策略，不代表上游实际开启了思考。本轮**不声称**真实 SSE、思考输出、自动长度扩容、官方地址能力探测、内置自定义代理价格或 Hindsight 新写入已验证。这些需与主任务的协议夹具、单元/集成测试分开看待。

## 结算故障：31 个确定性场景

对齐主干 PR #235 语义后运行：

```sh
DEVFLOW_H6_STRESS=1 DEVFLOW_H6_REPORT=output/playwright/issues-a-live/h6-settlement-current.json corepack pnpm exec tsx scripts/hardening-settlement-electron.mts
```

结果：**31/31 通过，33 次本地合成模型请求，0 次收费请求**。场景为正常 1、HTTP 503 8、连接中断 8、提交后回执丢失 8、延迟 503 2、读体中断 2、取消结算 2。

非取消情况下，有效设计仍保存并推进至待审，结算失败保留 `upload_failed` / `canRetry`。故障未恢复时再次上传结算不会重调用模型；恢复后按同一结算 ID 上传，输入 120 / 输出 80 的合成用量恰好入账一次，不重复产物。取消时仍禁止保存产物，并保留最终账目；用户重新发起工作流才允许新模型请求。

实验中没有自发窗口关闭或渲染器崩溃。正对照明确产生 `render-process-gone`、`window-close`、`webcontents-destroyed`、`window-closed`，证明生命周期记录有效。它们属于测试主动清理/对照，不能当作 #202 历史事故复现。

该脚本用真实 Electron / IPC / SQLite 和本地合成 HTTP 模型，并有脚本自身的 fetch / safeStorage 夹具；不混称真实 Postgres / DeepSeek / UI 点击验收。此轮 33 次少于旧报告的 61 次，是因为新语义只恢复结算，不再为已成功产物重新生成。

## 费用

本轮 8 次真实请求的已知峰时缓存价估算为 **¥0.055622**，按未缓存输入保守计入预算为 **¥0.086728**，未知请求 **0**。这是 tokens 与公开费率估算，不是服务方账单。新账本上限 ¥5，A 包授权上限 ¥8，两包累计授权上限 ¥20。所有收费场景完成后立即执行网关的 `--close`，`budget-closed.json` 证明 `closed=true`，后续只读验收不能再次收费。

三份旧账本仍按 ¥2.639110 占用，其中历史未知预留 ¥0.146008 不退回。加本轮保守占用后为 ¥2.725838；B 包另计，不能把该数字当成两个工作包的最终合计。每阶段 `/budget` 快照分别保存，结束需关闭新账本并核验旧账本 SHA-256。

## 历史 issue 判定

#201 原始两次坏响应正文缺失；历史 25 次 DeepSeek 复查（24 有效、1 连接故障）和本轮 8 次成功均不能证明原始格式失败已根治。#202 旧 31 场景和本轮 31 场景没有复现窗口关闭，结算修复证据只覆盖保留有效产物及账目恢复。两个历史问题不因本轮通过而自动关闭。详细原始证据与预算哈希见 [准备及审计计划](issues-a-live-validation-plan-20261023.md)。

## 最终构建重启与清理

最终构建于 2026-10-23 16:49:31 UTC 使用同一 profile 重启（新 PID 90057）。启动前记录 7 份构建文件的 SHA-256，启动后复核未改变，见 `final-build-before-restart.json`。真实 UI 恢复原会话和 8 条诊断记录；再次复制与下载成功，导出增加应用信息 `DevFlow Studio / 2.3.0 / structured-v1`。

重启前后 8 条调用记录逐项相等，用户/助手/工具消息数、工具消息 ID、调查进展和最后答复均保持。会话版本在重新打开期间由 83 变为 84，未把“版本不变化”作为内容持久化条件；核验对象是实际消息与调用内容。最终复制和下载 JSON 一致，SHA-256 为 `51756588f7c33282579722bc3e1c36348d3691e326d5db38ff5b3ed92e614c25`，证据为 `final-restart-audit.json`、`final-restarted-diagnostics.json`、`07-final-build-restart-diagnostics.png`。关闭账本前后的调用数与费用完全相等，没有新增收费。

完成后通过独立 manifest 检查容器标签、PID 起始时间和命令，只清理本轮 Electron / API / Web / gateway / PostgreSQL 与对应临时数据库卷。5 个 A 端口全部释放，所属容器列表为空，脱敏证据和关闭账本保留。`cleanup-report.json` 与 `postcleanup-ledger-audit.json` 证明三份旧账本哈希、closed 状态和历史未知预留均未变化；没有接管或清理 B 包、既有 4311 服务或 Hindsight 待机服务。
