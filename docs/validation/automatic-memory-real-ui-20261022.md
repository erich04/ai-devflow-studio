# 自动记忆真实界面与模型验证

日期：2026-10-22。**最终记录：真实重启复测、命令去重隔离回放及工程回归完成；计费已关闭，专用环境已收尾。** 接续[自动记忆工程验证](automatic-memory-20261022.md)。本文单独记录真实 Electron、Hindsight 和付费模型的结果，不把此前替身测试算作本次真实验证，也不把未到达的工作流节点或失败的 OpenCode 结果计为通过。

已实际证明：界面一次启用后，聊天完成会自动提交真实 Hindsight 抽取；修复真实转述适配后，一般语言偏好能进入正式记忆；新的 Direct 聊天与最新一次 OpenCode 聊天能回忆并遵循该偏好；真实阶段评审和 Native 分析/生成阶段收到确切的正式记忆上下文；Native 批准修改后实际测试通过，并自动学到已验证命令；语言冲突需经界面确认才能替换旧偏好，随后可固定；业务规则保留为未生效候选；删除后本地完成失效与清理，远端来源文档已不存在，重启后新会话也未召回已删除或已替换的语言偏好；用户还能主动记住并固定助手消息。跨来源命令经验去重的真实验证范围及更多样本的稳定性仍须分别说明。

## 环境与操作边界

- 使用当前工作区构建的 Electron，独立 profile 为 `.tmp/automatic-memory-live-validation/desktop-profile/`，SQLite 为其下的 `devflow.sqlite`。未使用用户日常桌面数据库。
- 合成 Todo 工作副本为 `output/playwright/automatic-memory-live/todo/`，本地项目 `local-6500df4e4d8e`。只使用合成消息和随仓库提供的知识夹具。
- Electron 明确关闭 demo data 和 fake runtime，使用本地 Team API `http://127.0.0.1:14310`；通过 Playwright 连接真实 Electron 调试端口 `19322` 操作界面。Team 环境是独立真实 PostgreSQL 16-alpine、新数据库 `devflow_memory_validation` 和当前工作区 API/Web，使用显式 local auth 的真实登录与配对流程，不是内存 Team 替身。完整启动、迁移及清理信息见[环境与入口简报](automatic-memory-live-environment-20261022.md)，本轮不等于生产后端验收。
- Hindsight API 为 `http://127.0.0.1:8890`，管理界面为 `9990`。版本 1.0.0，提交 `39c65ffe2f140d0c84cee58566cad8900c5b9908`，镜像固定为 `sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c`。独立卷为 `devflow-hindsight_data`。
- 真实模型为 DeepSeek `deepseek-flash`。Hindsight 和宿主模型请求均通过本轮独立预算网关，桌面访问地址为 `http://127.0.0.1:8891/v1`。真实凭据只读挂载到网关，不复制进源码或证据文件。
- Hindsight 使用本地 embedding/reranker，关闭 observations 和自动 consolidation。启动前统计 11 个历史空 bank，文档、节点、关系和待处理操作均为 0；没有恢复历史抽取任务。
- 未操作另一个项目的 DSH Hindsight 服务、数据卷或账本。

唯一预置例外是**项目目录注册**：当前自动化表面不能操作原生目录选择器，因此在 Electron 关闭时，通过产品的 `inspectProjectDirectory`、`createLocalStore`、`upsertProject` 注册真实 Todo 目录。逐表比较 76 张表，只有 `local_projects` 变化；未预置或修改模型、配对、记忆、聊天、工作流数据。之后配对、保存模型配置、Hindsight 设置、自动记忆启用、发消息、读取记忆面板与流程操作均使用真实界面，没有替换 dialog、fetch、safeStorage 或模型响应。目录选择器本身未被本次验证。

环境与注册证据：`.tmp/automatic-memory-live-validation/environment-ready.json`，以及证据目录内 `start-electron.sh`、`repository-registration-evidence.json`、`register-todo-fixture.mts`。

本机 gateway 地址被产品识别为通用兼容提供方，内置计价显示未知。测试通过正常设置 UI 关闭隔离项目的内置金额预算，以外部真实网关强制执行原累计 ¥5 限额。不能将网关费用验证写成 DevFlow 内置代理计价通过，也没有伪造模型名绕过检查。

## 实际结果与失败保留

以下时间均为 UTC。所有界面截图、可访问树和 JSON 证据位于 `output/playwright/automatic-memory-live/`。

| 场景 | 真实观察、修复与复测 | 当前结论与证据 |
| --- | --- | --- |
| 无 Run 项目配置入口 | 准备时发现 Hindsight 面板依赖 selectedRun，无 Run 项目不能配置地址；此前 IPC smoke 绕过了该缺口。修复为当前本地项目 ID 后，再使用实际界面完成配置 | 入口问题已修复并经真实界面使用，详情及针对性回归见环境简报。`configuration-before.yml`、`01-automatic-enabled.png` |
| 一次启用自动记忆 | 界面完成 Hindsight 和自动记忆配置；新 bank 为 `df-experience-ef46992a-a729-4214-8fe2-b26cb8f1f9f4` | 已验证启用流程。`01-automatic-enabled.png`、`automatic-settings.yml` |
| 首次自动保存 | 17:50 用户发送“请用英文回答。”；真实 Hindsight 返回“用户要求助手用英文回答。 \| Involving: user”，但本地分类器不识别转述和后缀，3 个决策全部 `ignored / unsupported_evidence`，任务 `skipped` | 原始失败保留，不能描述为第一次就通过。`03-ignored-before-fix.png`、`hindsight-extraction-01.json`、`local-memory-extraction-01.json` |
| 修复后自动保存 | 更新转述适配、重建并重启 Electron；17:56 在原会话重新发送相同消息。新事件真实抽取 4 条事实，其中用户偏好保存为正式记忆，另外 3 条助手陈述仍被忽略 | `committed`、一次 retain；正式记忆 `active / revision 1`，私有、30 天保留。`04-auto-saved.png`、`hindsight-after-fix-01.json`、`local-memory-after-fix-01.json` |
| 新 Direct 聊天使用记忆 | 首次新会话已有记忆回执，但仍用中文回答。调整经过宿主核验的沟通偏好说明后，18:12 新会话问单元测试，实际回答以 “I'll answer in English per your saved preference.” 开始，全文英文 | 该次真实复测通过。`07-chat-preference-fixed.png`、`direct-recall-opencode-budget-01.json` |
| 中文偏好冲突 | 18:00 的“用户要求后续对话使用中文回答”和 18:18 的“用户要求之后用中文回答”均曾因转述未匹配而被忽略。修复后 18:35 新回合真实抽取“用户要求用中文回答”，产生 `conflict / needs_confirmation`，精确引用英文记忆 revision 1，没有自动覆盖 | 最新真实候选检测通过；后续确认与固定结果见下方。旧漏检保留。`chinese-conflict-retest-local-01.json`、`native-completion-conflict-final-01.json`、`hindsight-native-conflict-final-01.json` |
| 业务规则分流 | 首次“Todo 删除必须可撤销”被 Hindsight 转述为“Todo 的删除操作必须支持撤销”，原包含匹配失败。修复后真实界面显示原始规则为“业务规则候选 · 尚未生效”，没有进入正式一般经验 | 候选分流复测通过，不等于已批准业务规则。`10-rule-candidate.png`、`10-pending-check.yml` |
| 真实澄清评审 | 18:09 评审 `contextManifest.backgroundMemory` 明确记录正式记忆 ID、revision、headVersion、contentDigest，`omittedCount=0` | 评审收到记忆有确切回执。业务结论为 warn，不能写成业务审查通过。`clarification-review-memory-receipt-01.json` |
| OpenCode 首次真实尝试 | 18:13 一个宿主请求引发 12 次工具查询；执行器报告累计 91,480 tokens，最终没有有效答复。对应 7 次完成的上游请求与 1 次未知传输尝试，不是 12 次模型调用 | 保留失败；回执为 `delivery_unknown`。不能把模型用量或工具成功等同于答复成功。`08-opencode-first-failure.png`、`opencode-failure-01-diagnosis.json` |
| OpenCode 当前请求优先级修复 | 修复后 18:25 的通用集成测试解释请求，0 次工具、两句话、没有继续调查无关 Run；回执 `response_received` 包含原英文记忆。但实际回答仍为中文 | 该次目标保持正确；英文偏好遵循仍失败，尚不能宣称 OpenCode 记忆体验已通过。`11-opencode-current-fixed.png`、`opencode-current-fixed-memory-01.json` |
| OpenCode 有效沟通设置尾部修复 | 将宿主验证的有效设置作为带来源 ID 的有界上下文段；18:34 对相同中文问句，实际 0 工具、两句英文，正确解释集成测试。`effectiveCommunicationSettings` 为 48 tokens/160 bytes，来源 ID 是原英文记忆，未超限 | 最新单次真实复测通过，保留前两次失败，不外推多样本稳定性。`native-opencode-memory-delivery-summary.json` |
| 真实 Native 小任务 | 正确任务 `Memory live: README verification` 经需求/设计 Gate 后于 18:34 启动 Native，分析和初始生成两次模型请求均 HTTP 200。持久 coding brief 包含英文记忆，`contextReceipt` 与压缩清单记录完整 ID/修订。通过 UI 批准 README 单文件差异后，真实 `npm test` 为 17/17、exit 0，coding run `completed` | 该次真实 Native 修改、测试和记忆消费通过，不代表 PR 或最终业务验收。`native-opencode-memory-delivery-summary.json`、`native-completion-conflict-final-01.json` |
| Native 测试经验自动保存 | coding completion 事件绑定真实测试证据，内容为 `command: npm test\nexitCode: 0`；真实 Hindsight 返回通过命令的 experience fact，任务 `committed`，本地正式保存“已验证的项目命令：npm test” | 自动学习已验证命令通过。单独阶段测试摘要不具备该工具证据，保持 ignored，没有用模型概括替代真实测试结果。`native-completion-conflict-final-01.json`、`hindsight-native-conflict-final-01.json` |
| 确认冲突替换 | 18:38:56 通过真实 UI 确认中文偏好；原英文 head 变为 `expired / version 2`，冲突 decision 的 resolution 变为 saved，并创建新的中文 Memory，晋升 actor 为 human | 精确旧版本确认与替换通过，不能解释为无感自动覆盖。`17-conflict-confirmed.yml`、`conflict-confirm-pin-state-01.json` |
| 固定中文偏好 | 18:39:31 点击固定保留按钮；新中文 Memory 升为 revision 2/headVersion 2，`retentionClass=until_deleted`、`expiresAt=null` | 固定操作与持久状态通过。`17-pin-dialog.yml`、`17-pinned-memory.png`、`conflict-confirm-pin-state-01.json` |
| 删除与远端清理 | 18:41:44 通过 UI 删除中文偏好；head 为 `deleted / version 4`，tombstone 的 `purgeStatus=completed`。对应异步 job 最终 `cleaned / revoked`；18:44 按准确 document ID 请求 Hindsight 返回 404，按该文档查询 facts 为 0 | 当前进程删除和远端清理通过；重启后不复活另行验证。`18-deletion-confirmed.yml`、`deletion-manual-before-restart.json`、`deleted-language-remote-proof.json` |
| 手动记住并固定 | 18:43:35 用户在 OpenCode 的集成测试解释上点击“记住这条”并固定；事件为 `manual_remember / manual-local`，绑定具体助手消息，decision 为 `manual=true / explicit_manual_request`，没有远端 learning job | 正式 Memory 为 human 晋升、`active / until_deleted / expiresAt=null`。这是用户显式保存，不能算自动信任助手陈述。`18-manual-saved.yml`、`deletion-manual-before-restart.json` |
| 重启后不复活 | 真正退出并重启 Electron 后，18:49 新 OpenCode 会话要求只答 `2+2`，实际回答 `4`、0 工具、`response_received`；中文 head 仍 deleted，英文 head 仍 expired，回执不含二者，也没有 `effectiveCommunicationSettings` 段。删除来源文档再次为 404 | 删除和替换在重启后仍生效。实际回执仍有 1 条 `npm test` 命令记忆，不能写成“0 条记忆”。`19-after-restart-recall.yml`、`19-after-restart-recall.png`、`after-restart-memory-state.json`、`cleanup-api-inspection.json` |

自动保存的正式记忆 ID 为 `memory-556233271e879c560969363d21b7c15d71b1475ea68a979c8418b231fa874cca`。本地正式正文是用户来源“请用英文回答”，没有直接采用助手生成内容；其来源绑定真实 learning event、fact 和 source digest。Hindsight 的 `fact_type=world` 也可能来自助手对工作流的叙述，不能替代原始用户或工具证据判断。

Native 测试证据为 `coding-test-4c2af55c-0c71-46e4-ad3f-e046a6bcfaa3`，实际耗时 324 ms、17 项通过；编码运行 `coding-run-dc3576fd-7084-4ae4-89e9-abd1ebfcf31e` 已完成。由此保存的正式命令经验为 `memory-735d4997fde8e4efc7d3643949855c70a313d37098356ad5e062627b159b4e16`。这证明一条真实完成路径，不证明无关命令、失败恢复或多事件归纳已验证。

确认冲突后中文 Memory 的准确 ID 为 `memory-f2fcb6ccd1f49f8da69150d8ea79764c1d8ed46d54213b43a78eb14f610a68ef`，固定后当前 revision 为 2。旧英文修订作为不可变历史仍保留，当前 head 的 expired 状态决定其不再活跃；不能仅看到历史修订中的旧 status 字段就认定覆盖失败。

该中文 Memory 删除后，其来源事件 `fd70b868-91b8-4ea7-b15d-0d2d2545b7d2` 已撤销，远端文档 `df-event-fd70b868-91b8-4ea7-b15d-0d2d2545b7d2` 已通过 404 和 facts 数量 0 双重核对。手动保存另有独立事件 `b9f424a6-2a9b-479e-90aa-f14ceb15d857`，来源是会话 `3a09f5f0-0bdb-4235-adbd-5438fd761c3d` 的助手消息 `e1fabd55-26bf-4328-8056-3fcad602c408`，正式 Memory 为 `memory-49b2fe3fa9289e633ee24604da5fc159c2af04fbeb96d6dd52c2f33d2baeec0a`。虽然其决策复用 `disposition=auto_save`，仍须结合 `manual=true` 和 human 晋升身份理解，不能误称后台自动抽取保存。

同一次 Native 完成还暴露跨来源去重缺口：原 coding 学习路径保存了 `agent-memory-coding-d283984e720a8055d9b416ddfc2490ca`（“Verified test command for this project: npm test.”），Hindsight 路径又保存中文同义命令。两条历史记录仍 active，没有迁移或手工删除来掩盖问题；后续修复通过证据绑定的命令语义去重阻止再新增同义条目。

最后的新算术会话仅召回 `memory-735d4997fde8e4efc7d3643949855c70a313d37098356ad5e062627b159b4e16` 一条测试命令，另有 2 条记忆被省略；这为重启后的消费侧去重提供一个真实样本，但不等于再次跑完 Native 后验证写入去重。通用算术问题仍召回无关项目命令，反映当前召回相关性需要继续改善。该问题未影响本次数字答复，也未在本轮扩大修改范围。

18:56 对真实持久记录做了额外的**隔离 SQLite 副本 API 回放**：保留真实 Coding Run、测试证据、来源正文、candidate 和 revision，只在两个副本中分别把另一条命令 head 设为 inactive，以模拟两种写入先后；legacy-first 还把副本中的决策恢复为原始来源分类。先有旧路径命令时，调用真实 `LocalStore.commitMemoryLearningDecision` 得到 `ignored / duplicate`；先有 Hindsight 命令时，调用真实 `learnFromCompletedCodingRun` 得到 `duplicate`、零 promotion。两种顺序均未更改已有记忆的 revision 或到期时间。原 profile SHA-256 前后均为 `21624f1d0fb3e101d71f030558c30c23b99487ff229a58da4049663a423fef25`，模型请求与网络请求均为 0。证据为 `command-dedup-real-replay.json`，脚本为 `replay-command-dedup.mts`。这证明既有真实持久源在产品 API 上的去重行为，**不是新增 UI 或真实模型的端到端去重回合**。

第一条 README 测试任务错误写入了 `npm run dev` 与端口 `4175`，实际夹具是 `npm start` 与 `5173`。真实需求生成和评审正确指出该冲突。测试没有批准这份错误文档，另外建立正确任务继续验证。这是**测试请求错误被产品发现**，不计为产品缺陷，也不改写原 Run 或原审查结果。

## 回执能证明什么

Direct 的新会话和阶段评审已同时有具体记忆身份与真实模型结果。OpenCode 最新成功答复的回执能证明宿主准备并完成该请求，但它的 `boundary=host_request` 不是逐个内部模型请求的回执；语言输出仍需单独判断。

现有持久会话记录保存记忆身份和 prompt digest，没有保存完整上游 prompt 或 `communicationPreference` 字段。当前源码可从经过核验的原始正文导出 `{kind: 'language', value: 'english'}`，但这不能冒充从实际网络请求回读的证据。最新尾部修复增加了 `effectiveCommunicationSettings` 预算段及确切 `sourceIds`，并观察到正确英文输出；它仍不是上游完整请求录制。OpenCode 每轮临时 profile 按正常清理流程删除，因此本轮不能事后回读它的完整请求来弥补这一缺口。

阶段生成也有独立限制：`runWorkflowStageAgent` 返回的 `prompt` 与 `trace` 是并列字段；现有持久化提交的是 `generated.trace`，其中只有上下文摘要与 digest。已检查实际 SQLite，未找到完整 `RECALL_MEMORY_BACKGROUND` 或该记忆 ID 字符串。因此此次阶段生成成功暂不能独立证明实际传入的正式记忆条目；真实阶段**评审**已有 `backgroundMemory` 回执，二者不能混写。证据为 `local-stage-generation-01.json` 和 `local-stage-generation-trace-01.json`。

## 预算快照

用户授权是此前持续的人民币 5 元合成验证总额，没有重新授予每轮 5 元。两份旧账本继续关闭并保持原 SHA-256，总计 ¥1.603296；本轮使用新账本，上限严格为余下的 ¥3.396704。

截至 18:29:41 UTC，本轮网关 43 次请求，已结算费用及未知调用预留合计 **¥0.798046**；三份账本累计 **¥2.401342 / ¥5**，可用余额 **¥2.598658**。其中 call 22 在 18:14:02 出现 `URLError`，其 **¥0.146008** 全额预留仍计入累计，没有回收、重置或按零费用处理。

18:35:28 UTC 更新：本轮 **57 次**，保守费用及预留 **¥0.999392**，累计 **¥2.602688 / ¥5**，剩余 **¥2.397312**；唯一未知调用仍是 call 22。证据为 `budget-native-opencode-success.json`。

Native 完成及冲突事实回读时再次核对：本轮 **59 次**，保守费用及预留 **¥1.019084**，累计 **¥2.622380 / ¥5**；未知调用仍只有 call 22。对应证据为 `hindsight-native-conflict-final-01.json`。

最终 18:51 核对：最后会话的 Hindsight 任务已 `skipped` 终结，本轮 **61 次**，保守费用及未知预留 **¥1.035814**；加上两份旧账本累计 **¥2.639110 / ¥5**，未用额度 **¥2.360890**。唯一未知调用 call 22 的 **¥0.146008** 仍全额保留。新账本已设为 `closed=true`，关闭后 SHA-256 为 `6c693558997b624d959e6e5fa5ecb193ce0fa88bb652b02e962d072cac91eea4`；两份旧账本的摘要与原记录相同。证据为 `final-budget-before-close.json`、`final-budget-closed.json`。

采用[核对当日 DeepSeek 官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)的高峰未命中缓存价格保守记账：输入 ¥2/百万 tokens、输出 ¥8/百万 tokens。上述数字是网关保守费用与预留，不是提供方正式账单。网关先落盘预留再发请求；缺账本、额度不足或关闭授权时拒绝继续调用。

18:29 的自动学习远端尝试为 **16/20 次/日**；18:32:32 通过实际 UI 将日次数上限改为 **40**，生成新配置 `50032ae3-f391-4c0e-939e-63e47d402840`，旧配置停用。次数额度与人民币额度是两项独立限制，网关人民币上限仍为 ¥3.396704，没有增加总授权。原始账本位于 `.tmp/automatic-memory-live-validation/budget/ledger.json`；快照证据为 `budget-report-draft-snapshot.json`、`native-opencode-tail-initial.json`。

## 尚未完成与收尾

本稿不宣称三种 Agent 全部完成真实全链路验收，也不宣称任意经验均能可靠自动识别。跨来源命令去重有消费侧真实样本及持久源副本的双向 API 回放，没有新增付费 Native 回合；已观察到正常删除与清理终态及重启不复活，但没有人为注入迟到远端响应，因此不宣称本轮覆盖所有清理竞态。此前确定性测试覆盖不能代替本轮执行。远端语义排序与回答质量评测也没有被这一小组用例证明。

## 同期工程回归的独立边界

`/tmp/devflow-memory-live-verify-summary.md` 记录：完整 `corepack pnpm verify` 的类型检查通过，但首次 Vitest 因本机 sandbox 拒绝 HTTP/IPC 监听而退出 1。对原 14 个受影响文件授予本地监听权限后原样重跑，146 项通过；去重后的基线是 379 个可执行文件、5,106 个可执行测试有通过证据，另 1 文件/15 个 PostgreSQL 专项按缺少专用 URL 的条件跳过。不能将这些结果改写为“一次 pnpm verify 全部通过”。跨平台检查与 diff 检查通过。

有效沟通设置尾部是在该全量任务运行时加入的，不能把前述基线算作该后续补丁的完整覆盖；其独立针对性测试与类型检查由环境简报记录。工程回归与真实 UI/模型证据分别保留。

最终增量验证：命令语义去重相关 **120 项定向测试**通过，桌面 typecheck 通过；随后扩大到 LocalStore 191 项、架构 1 项、Native-v2 9 项，共 **201 项测试**通过。这些是不同范围的回归执行，不与前述基线相加冒充独立测试总数。最终桌面 renderer/main/preload 构建通过，日志为 `/tmp/devflow-memory-live-final-build.log`；`git diff --check` 通过。构建仍有现存的大 chunk 和静态/动态混合导入提示，未影响成功退出。两组 Playwright 会话已关闭或断开，没有为后续回放重新启动服务。

最终清理顺序为：最后抽取任务终结、记录费用与远端状态、关闭本轮账本、退出隔离 Electron，再清除两个本轮合成 experience bank、停止并移除 DevFlow 专用预算网关、恢复基础 Hindsight compose。清理前两个 bank 分别有 17/7 个文档、92/22 条事实，全部远端操作 completed、待处理操作为 0；清理后两个 bank 的文档入口均返回 404，列表恰好剩余原 11 个空 bank。没有删除旧 bank、DSH 服务、旧账本或本地验证数据库。

Hindsight 恢复 `devflow-unconfigured`、`http://127.0.0.1:9/v1` 和占位凭据，容器健康检查通过，主机 `/health` 最终返回 HTTP 200、database connected；观察归纳与自动 consolidation 仍关闭。预算网关容器不存在、8891 端口关闭。隔离 Electron、Team API/Web 和专用 Postgres 也已停止；19322、14310、14311、15432 均无监听。Hindsight 的 8890/9990 和独立数据卷保留为无计费待机。网关关闭后账本仍为 61 次，摘要不变，未知调用预留没有回收。清理证据为 `final-remote-before-cleanup.json`、`final-synthetic-bank-cleanup.json`、`final-standby-report.json`；Team 的独立进程清理详情见环境简报。

本地 profile、原始失败、合成 Todo 目录和验证证据保留用于复核；其中保留的本地设置属于已停止的隔离 profile，不应直接当作仍有远端测试 bank 的运行环境。

本机 `output/` 和 `.tmp/` 下的证据为本轮可复核材料，可能受 Git 忽略规则影响，不等同于长期 CI 归档。正文不复制原始大数据，也不包含任何真实密钥。
