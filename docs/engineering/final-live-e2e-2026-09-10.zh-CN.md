# 2026-09-10—11 真实 Provider 全流程验证（已完成）

本轮从新版 Studio 新建 Project 和一句话 Work Request 开始。Web/API/Postgres 是本机 Docker QA 控制面，真实外部服务为 GitHub 和模型 Provider；不把本机 QA 称为公网生产部署。交付目标为 Draft PR 与业务验收，不包含自动合并或部署生产站点。

## 最终结果

修复后的正式请求“首页文案完整回归 20260911”于 `2026-09-11T09:31:55.131Z` 完成，Run `run-work-request-d380ec0ecede2befc8c0834f6432d636` 在本地和控制面均为 `completed / v11`，八个节点（六个阶段）全部成功。

真实链路为：Web 一句话请求 → Desktop Inbox 接球 → OpenCode/DeepSeek 只读澄清 → Direct DeepSeek 方案与门禁审查 → Web 设计审批 / Desktop 复核 → OpenCode/DeepSeek 修改 → 正式测试 → 精确提交测试 → 产品创建 [Draft PR #2](https://github.com/erich04/devflow-mini-agent-e2e-20260910/pull/2) → Direct DeepSeek 验收审查 → Web 签收 / Desktop applied 回执。最终提交为 `042c806ad9eb2c1514c88f48fec285f4a62448c4`。

Project 创建、仓库绑定和 pairing 已在本轮首条请求前实际完成；修复后的请求复用该项目和配对，未再次创建它们。首条请求的失败审批与缺失历史预算不补造，PR #1 和旧 Run 保留作审计记录。准备 mini Agent 仓库的步骤使用已有项目代码，不表示产品具备“一句话自动生成 GitHub 仓库和脚手架”的能力；验证控制面是本机 Docker QA，外部 GitHub / Provider 为真实服务，交付终点是 Draft PR 和业务验收。

最终代码本地 `corepack pnpm verify` 通过（273 文件 / 3816 tests、全仓类型检查、Web 构建、跨平台检查），Desktop build 通过。SQLite 验收事务覆盖完整交付通过、交付缺失或被替换拒绝。提交 `f05e4aa` 的五项云端 CI 全通过（Actions `34582772661`）；最后 #102 及本文的提交检查见 [PR #90 checks](https://github.com/erich04/ai-devflow-studio/pull/90/checks)。

## 输入与环境

- 原始需求仅一句：“请把 Mini Agent 首页标题下的介绍文案改成‘让每一个小需求，都能从想法走到可验证的交付。’，保持其余功能和布局不变。” 未提前代写澄清、方案或验收清单。
- 新独立 GitHub 仓库：`erich04/devflow-mini-agent-e2e-20260910`（private，Repository ID `1364494960`）。由验证准备步骤复用 mini Agent 已有代码初始化，产品未从一句话生成仓库脚手架。
- 初始 commit：`8491ff3f20918cd4f26390fa34373b7d224aecf4`，`main`，工作树干净。
- 本地检出：`out/final-live-20260910/mini-agent`，注册为 `local-7f86cef4efdf`。
- 新 Team Project：`p-mini-agent-isolated-final-20260910`，名称 `Mini Agent Isolated Final 20260910`。
- 新 Work Request：`work-request-6ee589a7-3236-4cd6-8182-034de1a2faa2`，标题“更新 Mini Agent 首页介绍”，已领取并物化本地 Run，`v3`。
- 新 Run：`run-work-request-71376282001af0918881d23d0fea4f25`；项目预算 `$0.20 / 月`、预警 `$0.10`。
- Web 使用本轮分支的 Studio（端口 4313）；QA API（4310）已应用 schema v27，原数据和配置保留。更新前 API bundle 备份位于 `out/open-issues-20260910/qa-api-before-81`。
- Desktop 使用隔离工作分支 production build 和现有 `local-development` profile；真实 Key 只经正常 Main 安全存储使用，未读出或重新保存 Key。

## 首条请求的过程与保留记录

| 步骤 | 证据 / 状态 |
| --- | --- |
| Studio 创建项目并自动选中 | 已通过真实 Web / API / Postgres，URL 自动选择新 Project ID |
| 一句话需求入库 | 已通过，Work Request ID 如上，内容未扩写 |
| 独立仓库准备 / 本地项目登记 | 已通过真实 GitHub 与 Desktop 文件选择框；初始代码未修改 |
| pairing | 已从 Web 生成一次性码并通过 Desktop 绑定；重启后关联和 Inbox 保留；同步时间 `2026-09-10T16:17:37.527Z` |
| Inbox 接球 / 本地 Run | 已从新请求创建新 Run，无手工注入阶段产物 |
| 真实澄清 | OpenCode `1.18.15`，`deepseek/deepseek-v4-flash`；只读扫描源码，生成 Repository Findings 和 Clarification v1；`2026-09-10T16:21:12.422Z` 完成，Run v2 停在需求 Gate |
| 需求门禁审查 | Direct DeepSeek `deepseek-v4-flash`，`2026-09-10T16:31:10.293Z`；已归档 Review / Trace / 消费，warn，置信度 0.82，未擅自批准 Gate |
| 需求 Gate | 通过真实 Desktop 批准，Run v2 → v3；原同步冲突经正常版本推进恢复 |
| 真实设计 | Direct DeepSeek，2026-09-11T01:52:52.552Z 完成，Run v4 |
| 设计门禁审查 | Direct DeepSeek，2026-09-11T01:54:19.909Z，Review / Trace / 消费已归档 |
| Web 审批 → Desktop | 命令 gate-command-1fc21a6f-e2b5-49b4-b011-ff2931393549 携带服务端指纹，Desktop 完整复核并回执 applied，Run v5 / building |
| GitHub App 仓库绑定 | 用户授权新仓库后，真实 Web / API 完成绑定，ACTIVE / v1 |
| 开发 / 测试 / Draft PR | 第四次明确追加尝试完成真实 OpenCode 修改、正式测试和精确提交交付，见下文 |
| 最终验收 | 首个验收 Review 暴露 #94 的 Acceptance 类型遗漏，修正并复验；Web 指纹通过后，Desktop 因 #97 丢失预算证据拒绝签收，保留此失败记录 |

澄清真实遥测：输入 `32,103`（其中 cache read `25,088`），输出 `2,469`，合计 `34,572`；按本次保存的官方峰值价格快照估算 `$0.005217828`。`source=provider_reported` 表示 tokens 来自 Provider，`costStatus=estimated` 表示金额为估算。界面显示“预计 $0.005”，未把估算当作账单实扣。

新 GitHub 仓库已由用户加入 App 安装 `153168718` 的 Selected repositories；通过真实 Web 验证绑定为 ACTIVE / v1。之前的 CLI HTTP 403 按要求交给用户处理，未绕过 GitHub 授权。

门禁审查 ID 为 `agent-review-review-request-ab4b6353-a9b5-462b-840a-e56b7bdf190d-electron`。输入 `5,793`（cache read `128`），输出 `738`，预计 `$0.002585868`；两次调用合计 `41,103` tokens、预计 `$0.007803696`。澄清与 Review 的用户均为实际 pairing 用户。该 Review 暴露 #93，费用尚待修复后的正常同步补传；不能宣称此时本地与云端已完全一致。

此前 Mac 控制阻断已解除，以上步骤通过真实原生 AX / Web 控件完成。没有脚本注入阶段产物或改写业务数据库。

截至设计审批，四次 Stage/Review 调用共 `54003` tokens、预计 `$0.014340948`。后两次分别是设计 `2382 input / 2542 output / $0.003765`、设计 Review `6969 input / 1007 output / $0.002772252`。云端四条记账及总额与本地一致。#81 outbox adapter 修复后，既有 Review 消费经正常后续同步自动补传；没有历史重定价。

OpenCode Coding 的费用目前为 opaque / unknown，不能把上述四次 Stage/Review 的小计视为全流程总价。

## 本轮发现的问题

- [#91](https://github.com/erich04/ai-devflow-studio/issues/91)：API 的 `binding_conflict / 409` 现在完整传递到 Web。真实重放旧仓库冲突后，页面明确显示“此仓库已绑定其他项目，请使用独立仓库。”；没有解除旧绑定或放宽唯一性。相关 71 项回归通过。
- 因上述冲突而未继续的首个 QA Project 为 `p-mini-agent-final-e2e-20260910`，其请求 `work-request-e5a15c0e-f948-49e2-90d7-b4658f5d7420` 保留为排查证据；没有生成或推进本地 Run。
- 原生控制未恢复前的输入尝试不计为产品 pairing 失败。重启并重新选择真实窗口后，AX 输入与配对持久化均已验证。
- #81 的 Electron 回归复现了 Gate Review 使用 Renderer 的 `requestedBy` 记账，导致与配对用户不一致，后续预算同步被 API 拒绝。Main 改为从已持久化 Run 和 pairing 推导用户；Smoke 显式伪造 Renderer 用户并断言本地 usage 采用配对身份。修复前本地复现失败，修复后整条 Electron Smoke 通过；没有放宽 API 的身份校验。
- [#93](https://github.com/erich04/ai-devflow-studio/issues/93)：真实 Review 上传将 Postgres 当前 Gate 从 running 改为 blocked，破坏同版本 Run 重传。保留现有节点的权威状态，只更新证据说明；测试证据上传也采用同一边界。新增真实 PostgreSQL 回归在修复前稳定 409，修复后全量通过，同时确认修改同版本状态仍 409、同 ID 改账仍 409。当前真实 Run 将通过正常 Gate 推进和同步恢复，不直接改写业务数据库。
- [#94](https://github.com/erich04/ai-devflow-studio/issues/94)：云端占位 request / 空 Artifact 投影曾误判正常 Review stale。用户已批准摘要与指纹边界；Main 独立生成指纹，云端比对后提交命令，Desktop 完整复核并回执。真实设计审批已通过，见上表；完整 Postgres 回归覆盖缺失/变化指纹拒绝与命令绑定。
- [#95](https://github.com/erich04/ai-devflow-studio/issues/95)：真实 OpenCode 工具请求以 Provider 调用前的时间开始审批倒计时。可控时钟模拟 45 秒模型延迟，证明只剩 15 秒审批；修复前失败，修复后首次与后续权限均有完整 60 秒响应窗口，Run 原始开始时间不改。45 项 adapter 回归通过，完整 3793 项测试通过；真实复验继续。
- #95 真实复验：`coding-run-80d919f3-053e-4514-8e44-5ed80c99f729` 的首次工具权限在 `2026-09-11T03:23:05.110Z` 被发现，`03:24:05.110Z` 到期，`03:23:28.235Z` 已提交批准；Provider 等待不再扣减响应窗口。该 Run 后续失败原因是 #96，不是权限到期。
- [#96](https://github.com/erich04/ai-devflow-studio/issues/96)：OpenCode 请求 `pwd && git status && git branch --show-current && git log --oneline -5`，触发既有限制后终止。模型收到的通用简报未说明执行器只支持逐条白名单命令，且上游设计含不可直接执行的 shell 示例。修复在实际发送简报中补充执行约束、原生文件工具使用和测试交由 DevFlow 受控执行的说明；保留原始业务简报，归档实际发送文本，不扩展命令权限。传输边界用例先失败后通过，adapter 与既有权限拒绝测试共 144 项通过；真实复验继续。

侧边方案接入前，三次 Coding 失败记录保留，第 4 次曾被既有三次上限拒绝。用户随后批准侧边任务的审批恢复与追加尝试方案，并要求主任务接入真实验证，后续按明确追加授权继续，没有重置历史计数。

## 2026-09-11：侧边修改接入与真实恢复

接入 `ebf31fa`，672 项相关回归和 Desktop 构建通过；该提交的五项云端检查全部通过（Actions `34577092303`）。本次通过真实 Desktop 的“授权追加一次尝试”创建 `coding-run-06fb5158-58a6-4d9c-9f7e-fbd44949e6dd`，授权保存 `afterAttemptCount=3`、实际配对用户和 `2026-09-11T08:00:34.233Z`，前三次记录保留。

- Execution Authorization 在 `08:00:54.744Z` 通过，真实 OpenCode / DeepSeek 会话为 `ses_f70841f4dffe3Tqg8Gnu5MZBBe`。
- `git diff --stat` 审批于 `08:01:03.825Z` 被发现，完整有效期到 `08:02:03.825Z`。刻意等待过期后，Run 仍为 `waiting_permission`，原会话和工作区保留。
- 在 `08:02:44.494Z` 通过“重新核验并请求审批”生成新本地审批，原审批 `per_08f7bfe130017m36I7oVJ4lRTu` 保留 expired；新请求 `coding-permission-43bcc1b2-fa7b-42c4-a337-67c40e54a6a3` 仍绑定同一个 executor request，于 `08:02:50.578Z` 批准后继续，未新建 Coding Run。
- 实际差异只有 `src/web/App.tsx`，将 h1 后的介绍段落替换成原需求文案；原始 checkout 仍干净。依赖准备 `corepack pnpm install --frozen-lockfile` 通过，受管工作树的 `corepack pnpm verify` 通过（6 个测试及类型检查、构建，5360ms）。
- 浏览器检查实际构建页面：文案只出现一次、位于 h1 后，原有控件和布局保留，console error 为 0；源码检查旧文案已移除。`08:04:49.294Z` 通过 Change Acceptance，Run 进入正式测试。
- 正式测试证据 `evidence-b2e590c6-8b2c-437c-aad2-c9eb22141fd9` 通过（2656ms）。Prepare GitHub Delivery 再次执行绑定提交的测试，证据 `github-delivery-test-d5b06cd4-e8f8-4010-bcd2-e02f13f24b83` 通过（2645ms）。
- Web 显式审批交付请求 `github-delivery-f8b77675-7ca0-43e3-b802-765e00bdd24d` 后，产品发布提交 `aabd6493c925fb7dd17e16c5c07471920881dcd7` 并创建 [Draft PR #1](https://github.com/erich04/devflow-mini-agent-e2e-20260910/pull/1)。GitHub 独立查询确认 Draft、main 基线、精确 SHA 和仅一处文件差异。没有通过 CLI 代替产品创建 PR。

上述真实运行覆盖追加尝试、工具审批过期后同会话恢复、实际实现、测试与 PR。普通只读命令自动放行和不支持命令反馈分支在这一次 Coding Run 中未被模型触发，仍以受控 adapter 回归作为对应分支证据，不冒充真实命中。

### 验收阶段发现的两个边界

1. #94 补充：实际 Acceptance Artifact 的 kind 为 `acceptance`，指纹解析器误用了节点 stage `accept`。新增从完整验收产物构造指纹并经过 remote summary 的回归，修复前失败，修复后通过，同时继续拒绝错误 kind。补上 `ArtifactKind` 编译期约束，103 项相关回归及全量 3809 项测试通过。真实重审后，原 Run v10 的指纹正常补传，不上传本地产物正文。
2. [#97](https://github.com/erich04/ai-devflow-studio/issues/97)：Web 验收命令 `gate-command-23b1502d-9ba2-44e1-b96c-b07617e3f5b3` 绑定正确指纹，但 Desktop 返回 `evidence_blocked`。对完整持久化证据只读执行同一 transition 校验，唯一 blocker 为 `budget_decision_missing`。定位到 Execution Authorization 后 OpenCode 返回新的 Run 对象，丢失 Main 在预留时生成的预算判定。使用真实 adapter 的受控 HTTP 生命周期用例加入 Execution Authorization 后稳定失败；Main 现在跨 start/continuation 保留其原预算判定，不接受执行器替换，不放宽验收约束。

首条请求的预算历史不会补造，已发布 PR 和拒绝回执保留。修复后另起正式 Work Request 做完整复验，再决定关闭 Issue。

验收 Review 使用真实 Direct DeepSeek，先后 ID 为 `agent-review-review-request-547c6bcf-fbc1-4bd7-b14e-dabb1580f67a-electron` 和 `agent-review-review-request-e707bdf2-c6cd-475b-af89-98048c6bcb2a-electron`。前者 `5839 input / 724 output / $0.002582868`，后者 `5839 input / 652 output / $0.000878292`。六条 Stage/Review 记账合计 `67057` tokens、预计 `$0.017802108`；OpenCode Coding 费用仍为 unknown，不计作零或全流程总价。

原生 CUA 再次出现 `noWindowsAvailable` 后，改用 Playwright CLI 连接本机测试 Electron 的回环调试端口，通过真实按钮/键盘交互继续。仍由真实 Main、SQLite、QA API 和保存的 Provider 配置执行；未注入阶段产物或改写业务数据库。该后台路径不依赖窗口持续置前；原生窗口滚动/系统对话框的可操作性属于另一层验证。

## 验收规则

真实 Provider 阶段必须逐项记录 Run/节点、Provider/Model、产物、调用用量和失败重试。核对本地与云端记账一致、计数入口对应当前节点、真实工作树 Diff、归档测试及 GitHub PR。未完成的步骤、受控 Provider 自动化和历史 Run 均不能代替本轮完整验收。

## 修复后新请求回归（2026-09-11，已完成）

复用上述已经配对并授权的项目，Web 新建一句话请求“首页文案完整回归 20260911”，原始需求文本不变。请求 ID `work-request-840eac76-86e9-4d87-b990-c2f4e4b1e07c`，通过 Inbox 创建 Run `run-work-request-d380ec0ecede2befc8c0834f6432d636`，不补造首条请求的预算历史。

- 首次只读澄清于 `08:45:18.874Z` 返回 `evidence_invalid`。实际 OpenCode 会话 `ses_f705bb41bffeJFQE3PI207JExi` 完成 9 次只读调用，但最终 JSON 没有 repositoryFindings；工作流仍为 clarifying，失败费用正常记录（26481 input / 2204 output，预计 $0.004869036）。
- [#98](https://github.com/erich04/ai-devflow-studio/issues/98) 记录输出契约不一致：仓库指令要求引用，但后面的最终字段清单漏掉 repositoryFindings。修复使本地执行器的字段清单明确包含它，并将具体仓库字段说明置于通用格式说明之后。仅修正提示，保留引用和文件摘要校验，无自动重试或 Provider 回退。
- 传输契约回归修复前失败、修复后通过；68 项定向检查、全量 3810 项测试、类型检查、跨平台检查和 Desktop 构建通过。
- 同一请求经真实 UI 重新执行 OpenCode，于 `08:49:26.900Z` 成功，7 条事实 / 7 处引用通过实际文件摘要核验；只读仓库摘要保持一致，Run 正常进入需求 Gate。
- `70230b6` 的云端 Postgres job 在 apt-get update 安装测试环境阶段超时（退出 124），数据库集成与交付规则测试已通过，后续 Linux 打包交付 Smoke 未执行；其余四项通过。后续以最新修复提交的完整 CI 为准。
- [#99](https://github.com/erich04/ai-devflow-studio/issues/99)：同一 Renderer 连续从 OpenCode 澄清进入设计时，残留的澄清执行器选项被错误传给设计，Main 在调用前以“Read-only local Agent is authorized only for requirement clarification”拒绝。该失败未调用 Provider。修复将该选项仅用于澄清，设计明确使用已配置 Direct Provider；Main 权限规则不变。
- #99 回归先确认 IPC 误传 local-agent 且缺 providerId，修复后 Desktop App 140 项和全量 3811 项测试通过，Desktop 构建通过。真实 UI 再次在已完成澄清卡片选择 OpenCode、返回同一 Run 的设计节点后发起设计，继续核验实际 Direct Provider 结果。
- #99 真实复验于 `08:55:57.125Z` 成功生成方案，executorProvenance.kind 为 direct-provider；随后真实方案 Review `agent-review-review-request-d91e5349-fbaf-4de5-b228-e7651c92a91b-electron` 完成。核对实际目标、测试环境和未修改基线（冻结安装后 verify 6 tests + typecheck + build 通过）后，通过 Web 提交说明；命令 `gate-command-d2514892-4207-4a7f-9bef-0b7470c66b3a` 返回 applied，Run v5 进入 building。
- [#100](https://github.com/erich04/ai-devflow-studio/issues/100)：首次直接点 Inspector“启动 Coding Agent”，React 点击事件被可选追加次数参数接收，IPC 在 Main 前报 An object could not be cloned；没有创建 Coding Run 或调用 Provider。改为无参包装调用 Inspector 领域动作；既有 CTA 回归新增“首次启动无追加次数”断言，修复前失败、修复后通过。相关 163 项测试和 Desktop 构建通过，继续同一请求实际启动验证。
- #100 已通过真实 Inspector 启动，Run `coding-run-ad3d9a8c-2066-4ab1-8ffa-90852ee42ae9` 正常进入 Execution Authorization。此尝试真实触发不支持命令 `corepack pnpm verify` 的纠正反馈，后续改为允许的 `git diff --stat` 并继续；正式验证仍由 DevFlow 按保存的命令执行。
- 首次与第二次 OpenCode 结果均修改 `src/web/App.tsx` 和 `tests/app.test.tsx`，新增测试未清理 DOM，现有用例因重复“生成计划”按钮失败。证据分别为 `evidence-1ab21b52-e944-497f-9770-a94b2a57b018`（3627ms）与 `evidence-e66836a4-e094-42f7-9952-c36ef4d32fa4`（3593ms）；第二次 Coding Run 为 `coding-run-c9dee21b-99d9-48fe-bc36-eb6bd463d17c`。两次均被产品阻止接收，工作区与失败历史保留；预算判定在两个终态均保留。
- [#101](https://github.com/erich04/ai-devflow-studio/issues/101)：第二次实际简报只带通用退出码摘要，没有重复按钮的具体诊断，连续重复同一失败。修复仅在同 Run / project / 测试命令的最新证据失败时，带入 stdout、stderr 各最多 2000 字符的再次脱敏摘录，并标记为不可信历史诊断；成功覆盖旧失败后不再带入。不修改日志存储或云端协议，不自动启动重试。
- #101 传输回归先失败后通过，覆盖具体诊断、秘密/路径脱敏、大小上限、成功覆盖和跨 Run/项目/命令隔离；136 项相关回归、全量 3812 项测试、类型检查、跨平台检查和 Desktop 构建通过。第三次由正常显式重试入口继续真实 Provider 验证。

- 第三次 Coding Run `coding-run-a0725a14-dbf8-4a57-b2ad-62cd58931e9c` 实际简报包含最新测试失败的脱敏诊断；真实 OpenCode 补充 DOM cleanup，新增文案断言并保持其余页面内容。执行授权、两次 Git diff 审批和最终接收均经真实 UI。受管测试 `evidence-961fab7a-8c0d-44ea-ae14-99de51831707` 通过（7 tests / typecheck / build，5264ms），`09:12:00.121Z` 接受修改后 Run v6 进入测试。
- 正式测试 `evidence-8f3daee0-ae9f-4476-b0df-4bde5b43331e` 于 `09:12:52.515Z` 通过（2605ms）。产品准备交付后，再对提交 `042c806ad9eb2c1514c88f48fec285f4a62448c4` 运行 `corepack pnpm verify`，证据 `github-delivery-test-3d5324c3-6cad-4619-91bf-879c79008511` 于 `09:13:53.554Z` 通过（2698ms）。
- 经 Web 实际审批，交付 `github-delivery-7c1c48ea-6b7b-493f-991f-2cb3da4137a5` 于 `09:14:48.914Z` 完成，产品创建 [Draft PR #2](https://github.com/erich04/devflow-mini-agent-e2e-20260910/pull/2)。独立 GitHub 查询确认 head SHA 与精确提交测试一致，差异仅 `src/web/App.tsx`、`tests/app.test.tsx`。未由验证脚本代写目标代码或代替产品创建 PR。
- 实际构建页面检查：新介绍在 h1 后恰好出现一次，旧介绍已移除，其余文案、控件、布局保留，浏览器 console errors 为 0。原 checkout 保持基线 `8491ff3` 和干净状态。
- 验收包于 `09:15:54.098Z` 生成，真实 Direct DeepSeek Review `agent-review-review-request-d40f71f5-6c1e-424a-a063-6ea64acf605a-electron` 于 `09:16:19.326Z` 完成，missingEvidence 为空，advisory 为 warn / blocksApproval=false。历史失败测试保留，最终通过证据明确引用；验收包里的 Policy blocked 是生成时的快照，不代表生成 Review 后的结论。
- [#102](https://github.com/erich04/ai-devflow-studio/issues/102)：Web 验收命令 `gate-command-82e556ab-79bc-4ace-aa69-6bf4e1044e22` 于 `09:22:17.662Z` 回执 evidence_blocked。只读重放发现唯一 blocker 为 github_delivery_incomplete；补入实际已持久化的 completed intent 后纯校验通过。Main 评估、processor 证据绑定和 LocalStore 事务重放漏传 GitHubDeliveryIntent。修复补齐三处，完整 SQLite 验收事务及缺失/被替换证据拒绝回归先失败后通过；307 项相关回归通过。继续同一 Run 审批，不新建 PR 或重新调用模型。
- 六条 Stage/Review 用量（含首次澄清失败）共 `95,656` tokens、预计 `$0.022420512`；除本地 projectId 正常映射为 Team Project ID 外，逐条字段与控制面完全一致。OpenCode Coding 费用仍为 opaque / unknown，不能据此给出全流程总价。

- #102 修复后，未改变验收包和 Review，也未新增模型调用或 PR。重新从 Web 提交命令 `gate-command-4f56bb6c-5831-465c-a1f4-903aa736c668`，Desktop 于 `09:31:55.131Z` 回执 `applied`，Run v10 → v11 / completed，全部节点 success。Web 同步显示最终节点 done，Postgres 权威 Run 也为 completed / v11。
- 最终验收 Review 审查的 kind 为 `acceptance`，内容 digest `70a9789fec1960a9caa5b8c074d4605431fc8d72513d881f377f6bc9d71d5d1d`。沿用该指纹完成 Web 签收，证明 #94、#97 和 #102 在实际交付终点共同通过。既有失败回执仍可查询。

- [#103](https://github.com/erich04/ai-devflow-studio/issues/103)：最终提交 e608d28 的 CI `34584867242` 在 Ubuntu 镜像访问阶段再次退出 124；Postgres smoke、交付规则和 Desktop 打包已经通过，打包交付 Smoke 因依赖安装失败被跳过。日志显示工作流强制将 runner 镜像改到 `https://archive.ubuntu.com/ubuntu` 后持续超时。Verify / Release 恢复 runner 原镜像配置，保留安装超时和重试参数；既有工作流契约先失败后通过。该 CI 环境修复不修改应用代码、真实请求或已交付 SHA，最终云端检查以 PR #90 为准。
