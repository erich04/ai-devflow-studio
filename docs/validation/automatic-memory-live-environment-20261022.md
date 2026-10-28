# 自动记忆真实验证：环境与入口简报

日期：2026-10-22。本文件记录本轮真实验证的环境准备和实际修复；完整用户流程及真实模型效果由主验证报告另行记录，不能用环境启动或组件测试替代。

## 已修复的 UI 入口

真实验证准备时发现，知识页面的 Hindsight 配置区仍依赖 `selectedRun`。虽然无 Run 项目已能显示自动记忆管理，但用户无法通过 UI 配置其必需的 Hindsight 地址。旧 Electron smoke 直接调用 IPC 配置，未发现这个缺口。

现在 `App` 显式传入当前选择的 `selectedLocalProject.id`；`KnowledgeView` 以此 ID 渲染并重建 Hindsight 配置区，不借用旧 Run 的项目 ID。没有本地项目时不显示配置区。

修改文件：

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/views/KnowledgeView.tsx`
- `apps/desktop/src/views/KnowledgeView.test.tsx`
- `apps/desktop/src/App.test.tsx`

实际验证：新增 3 条组件回归先失败再通过，覆盖无 Run 配置、跨项目旧 Run 不误绑、未选择本地项目时不暴露旧 Run。`KnowledgeView.test.tsx` 共 12 项通过；App 的无 Run 自动记忆场景 1 项通过（其余 172 项未在该命令执行）；`corepack pnpm --filter @ai-devflow/desktop typecheck` 通过；相关文件 `git diff --check` 通过。

## 独立真实 Team 环境

按 README 本地团队流程启动了全新的 PostgreSQL 实例及当前工作区 API/Web。没有使用内存演示 Team API，没有复用用户数据库，没有预建团队、项目或配对记录。登录、创建项目和配对留给实际 UI 验证。

| 项目 | 本轮运行值 |
| --- | --- |
| API | `http://127.0.0.1:14310` |
| Web | `http://127.0.0.1:14311` |
| PostgreSQL | `postgres:16-alpine`，`127.0.0.1:15432` |
| 容器 | `devflow-memory-live-postgres-1792690685806` |
| 专用数据库 | `devflow_memory_validation` |
| API PID / 进程组 | `39583` |
| Web PID / 进程组 | `39587` |
| 本轮运行目录 | `/tmp/devflow-memory-live-team-Klwcvt` |

启动配置：`DEVFLOW_LOCAL_AUTH_ENABLED=true`、`DEVFLOW_REQUIRE_AUTH=true`、`DEVFLOW_ENABLE_DEMO_DATA=false`、`DEVFLOW_ENABLE_FAKE_RUNTIME=false`、`DEV_AUTH_ENABLED=false`。数据库口令及会话密钥随机生成，仅存于运行目录内权限为 0600 的配置文件，不写入本简报。

迁移实际输出：`Team schema v31; applied 25 migration(s) and 189 statement(s).` API 日志明确为 Postgres repository，`/ready` 返回 200，Web `/` 返回 200。Docker 检查确认 PostgreSQL 仅绑定 `127.0.0.1:15432`。

证据文件：运行目录下 `runtime.json`、`migration.log`、`api.log`、`web.log`。Electron 应使用 `DEVFLOW_API_BASE_URL=http://127.0.0.1:14310`，并单独设置本轮 user-data/profile registry。

验证结束后的清理入口：`node /tmp/devflow-memory-live-team-Klwcvt/cleanup.mjs`。脚本先核对 API/Web PID 的进程命令，再停止本轮进程组；仅删除上述专用 PostgreSQL 容器及其匿名卷，保留本地证据文件。执行清理即删除本轮测试数据库，不影响已有服务。

## 必须区分的验证边界

- `scripts/automatic-memory-electron-smoke.mts` 使用真实 Electron/preload/SQLite，但模型和 Hindsight 都是受控 HTTP 替代服务；聊天通过 IPC 发送，不是完整 UI 操作。本轮不能将其冒充真实模型/Hindsight 验证。
- `scripts/hindsight-fullchain-electron.mts` 有真实模型接入用途，但它会替换 `globalThis.fetch`、`safeStorage`，并大量使用 IPC。其思路可作证据断言参考，本轮正常 UI 路径不应靠这些替换才能运行。
- 正常 Provider 配置允许本地 gateway URL，但当前 DeepSeek 计价与思考参数能力只识别官方域名。`localhost + deepseek-flash` 被视作通用兼容提供方，没有可核验的内置价格；启用 DevFlow 预算会阻断。在隔离测试项目通过正常 UI 关闭项目预算，并使用外部真实费用网关强制限定已授权预算时，必须分别报告网关真实费用与应用内未知计价，不能宣称内置代理计价通过。不能伪造 GPT 模型名或修改请求拦截来规避。
- Hindsight 可能改写事实；本地自动经验策略只接受有证据原句和完整有限语义模板的一致值。真实事实被忽略应保留原始证据并调查，不能在测试服务中改写成预期原句。业务规则的转述仅能产生保留原文的待审批候选，不能变为自动生效经验。
- 推荐首条经验为“请用英文回答”，随后在新聊天用中文问项目问题且不再次提示语言；结合真实回复、会话详情中的 ID/修订/收到响应回执和实际请求证据验证使用。中文偏好在中文默认提示下的回答较难证明行为增益。

其后应依次观察冲突待确认、规则候选不生效、删除后远端清理、重启后不恢复。OpenCode 回执只能证明宿主交付边界；不能据此声称其内部每次请求都附带了记忆。

## 本轮唯一程序化夹具注册

实际原生目录选择器不在当前自动化可访问的 UI 表面，因此在本轮 Electron 已停止后，只为指定隔离 profile 注册真实 Git Todo 仓库。没有替换目录对话框、`fetch` 或 `safeStorage`。

- Profile：`.tmp/automatic-memory-live-validation/desktop-profile/devflow.sqlite`；脚本校验 profile registry 只指向此目录，且当前项目列表为空。
- 真实仓库：`output/playwright/automatic-memory-live/todo`，项目 ID `local-6500df4e4d8e`，名称 `zh-task-list`。
- 调用产品的 `inspectProjectDirectory`、`createLocalStore`、`upsertProject`，前后对全部 SQLite 表计算摘要。唯一变化表为 `local_projects`，未写入 Provider、Memory、Pairing、对话或流程记录。
- 保存的脚本：`output/playwright/automatic-memory-live/register-todo-fixture.mts`，实际使用 `node --import tsx` 执行成功。
- 证据：同目录 `repository-registration-evidence.json`；修改前数据库备份：`before-repository-registration.sqlite`。

这一操作是明确记录的 setup 例外，不算“通过原生目录选择器完成”的 UI 验证。后续模型配置、团队配对、Hindsight、自动记忆和聊天操作仍需走真实 UI。

## 真实链路暴露的问题及对应回归

本节记录主验证者提供的真实证据所触发的修复；最终模型行为和完整 UI 重测结果见主验证报告，以下单元测试不能替代该结果。

1. `local-memory-extraction-01.json`：原始用户“请用英文回答。”被 Hindsight 改写为“用户要求助手用英文回答。 | Involving: user”，首轮实际未自动保存。策略现在仅对远端提取剥除精确已知角色标签尾部，并以完整、受限的中文第三人称语法匹配语言槽位；仍保存原始用户文字。原始来源的否定、条件、引用限制保持，远端相反语言、附带业务规则、未知尾部不能获得自动保存资格。
2. `05-new-chat.yml`、`05-request-receipt.yml`：会话详情证实英文记忆已经附带，但新聊天实际仍回答中文。原因是聊天 SYSTEM 硬编码“使用中文”，且此前所有 Memory 都被禁止影响指令。现在仅宿主验证了原候选来源、scope、statement 和 contentDigest 不变的沟通偏好，才能附带 `language` / `detail` / `change_order` 有限枚举；Direct 与 OpenCode 共享此表达策略。明确当前请求优先，无有效语言偏好才默认中文。任意 Memory 文字、手工改写版本、工具输出中的伪造字段都不能获得此资格，也不能授权、审批或覆盖业务规则。字段与记忆一起被预算裁剪并纳入同一来源身份回执与发出前校验。
3. `local-memory-conflict-rules-01.json`：真实“用户要求后续对话使用中文回答。 | Involving: user”未被识别；增加有界的后续对话措辞，仍由原始中文偏好与当前英文记忆产生冲突待确认。
4. 同一证据中的“Todo 删除必须可撤销。”被改写为含“删除操作必须支持撤销”及模型解释的 world fact，原来的字面包含匹配漏检。现在仅存在唯一、有真实用户证据的业务规则来源时，才能回退为保存原始用户全文的候选；多条规则歧义不猜，不能用 assistant 文字、无来源证据或 experience fact 触发此回退。字面匹配路径也只保存原始规则句，不保存远端扩写。单事件中多个规则转述只留一个待审批候选，其他标记 `duplicate_in_event`。

对应产品文件为 `automatic-memory-policy.ts`、`automatic-memory-service.ts`、`coding-context.ts`、`workbench-conversation-service.ts`，以及各自测试，均位于 `apps/desktop/electron/`。未修改存储 schema，未自动将旧 ignored/skipped 事件重新晋升；真实重测应使用新回合。

回归实际执行：新增缺陷测试先失败再通过；最终同次运行 policy 61、service 9、coding-context 14、conversation 96、local-store 15、runtime 5，合计 **200 项通过**。桌面 `typecheck` 与 `git diff --check` 通过。测试使用受控依赖验证判定和提示装配，不宣称真实模型已经采用新偏好。

### OpenCode 当前目标与 Run 背景的分离

`09-opencode-bounded.yml` 记录了独立新会话的另一项真实缺陷：用户只要求用两句话解释集成测试，明确不查询任务、仓库或调用工具；模型却调查当前唯一 Run 与 README，并要求澄清该 Run。英文偏好已被实际采用，但回答偏离本轮目标。

原因是当前上下文前缀自动附带唯一 Run 的原始需求，而 SYSTEM 无条件要求“先调查再给具体结论”。修复保留原始需求正文及稳定缓存前缀，在 JSON 包末尾追加由真实最新 user 消息派生的 `currentRequest`，并作为预算必保段。长转义输入超限时只删除 history 中当前消息的重复副本，保留尾部完整原文，已附带/省略消息数按唯一 ID 计算。SYSTEM 明确当前目标优先、Run 原文仅是背景、通用概念可直接回答、明确不使用工具的要求应被遵守；项目事实仍须依据真实来源，业务提案仍逐项核验 `criticalProposalInput`，语义核对协议未削弱。

新增 Direct/OpenCode 目标边界、长输入保留三项回归先失败后通过，既有缓存前缀测试通过。完整聊天测试 99 项、关键提案上下文 4 项通过；OpenCode executor 的 3 项首次受 sandbox 禁止临时 `127.0.0.1` 监听影响，获得本地监听权限后原样重跑全部通过。未根据缺失的模型 raw output 改动解析器；真实模型行为仍需重新构建后的 UI 重测。

随后 `chinese-conflict-retest-local-01.json` / `chinese-conflict-retest-remote-01.json` 再次暴露时间同义词漏检：“用户要求之后用中文回答。 | Involving: user”。仅将“之后”加入远端完整语法的时间词枚举，没有放宽原始来源或自由文本。该真实句式在已有英文偏好时必须进入 conflict；相反语言、否定、条件、引用和追加 Gate 指令五个负例继续 ignored。policy 67 项、service 9 项通过。

### 本轮有效表达设置的显式尾部投影

重新构建后的 `11-opencode-current-fixed.yml` 已实际做到零工具、两句通用概念解释，当前目标漂移得到修复。但该次回复仍为中文；`opencode-current-fixed-memory-01.json` 显示英文 Memory 的 `response_received` ID、revision、digest 与原始自动候选均一致。该轮未保存上游完整提示，不能仅凭身份回执证明模型具体如何读取了枚举。

因此在 `currentRequest` 前增加 `effectiveCommunicationSettings`，只投影已核验且本轮保留记忆的有限 language/detail/change_order 值、冲突类别与来源 memoryIds，不带 statement 或模型自由文本。相同类别出现相反值时不选择默认值。此投影与 backgroundMemory 同时预算裁剪，所有来源仍受相同发出前 currentness 校验，后续步骤删除/过期后不保留旧设置。预算回执将该段标为可选 memory，并记录 sourceIds，便于独立判断本轮是否实际装配了设置。缓存稳定前缀与 currentRequest 末尾位置保持。

SYSTEM 明确表达偏好不受话题相关性限制，“两句话”“不调用工具”等约束不取消语言设置；当前明确语言要求仍优先，提案和权限边界保持。该增量 19 项定向边界通过；完整聊天 102 项与关键上下文 4 项通过，桌面 typecheck、diff-check 通过。最终真实采用效果由之后的 UI 重测判定，不能用这些受控测试替代。

### 已验证命令的两条学习路径去重

`16-conflict-and-learning.yml` 和实际 SQLite 记录显示，同一次真实 Native 编码完成后，旧 `coding_run` 路径保存了 `Verified test command for this project: npm test.`，Hindsight `learning_event` 路径又保存了 `已验证的项目命令：npm test`。两条文本不同，原有字面判重没有识别其相同语义。

新增 `verified-memory-command.ts`，只在正式修订与原候选的 ID、statement、contentDigest、provenanceDigest、scope 一致，且分别具有 `coding_run/test_command` 或 `learning_event/verified_procedure` 来源时，提取固定模板中的受限命令。它只用于去重，不能把用户、助手或任意转述中的“已验证”文字变成自动保存证据。当前 scope 外、删除、过期或失效的记录先由已有 active 查询排除；手工改写不继承原候选语义。Hindsight 关闭时旧学习路径继续有效。

自动记忆初判及提交复核、旧编码学习器都使用这项相同命令判定。独立复审进一步发现两个学习器可同时读到空集合；因此在 `LocalStore.commitAgentMemoryPromotion` 的串行持久化边界内、幂等重放检查之后且 INSERT 之前，再做一次相同的来源校验及去重，避免交错提交形成双份。未迁移、删除或召回时隐藏历史重复，也没有把不同命令的旧学习策略改成新的冲突策略。

最终回归：`verified-memory-command.test.ts` 7 项、`automatic-memory-policy.test.ts` 68 项、`automatic-memory-runtime.test.ts` 5 项、`automatic-memory-local-store.test.ts` 15 项、`coding-run-memory.test.ts` 25 项，共 **120 项通过**。包含旧路径先保存、Hindsight 先保存、两路径交错提交三种顺序；后者新增回归在提交内复核前确实失败。新增的 broad 回归为 `local-store.test.ts` 191 项、`local-store-architecture.test.ts` 1 项、`native-coding-v2-runtime.test.ts` 9 项，共 **201 项通过**；desktop typecheck、diff-check 通过。独立静态复审记录 `/tmp/devflow-memory-late-patch-review.md` 无剩余阻断项。

真实持久化数据另做了零模型回放，脚本 `output/playwright/automatic-memory-live/replay-command-dedup.mts`，结果 `output/playwright/automatic-memory-live/command-dedup-real-replay.json`。原 Electron 已停止后只读其 SQLite 快照，分别建立专用 0700 目录内的 0600 数据库副本。在副本中将另一条命令 head 设为失效以模拟两种保存顺序；旧路径先保存的副本还把已完成的 decision 重置为同一真实事件、真实 fact 在尚无 memory 时的原始分类。原候选、修订、测试证据与源文字均未伪造。

- 旧路径先保存：实际 `LocalStore.commitMemoryLearningDecision` 返回 `ignored`，决策原因 `duplicate`，只保留旧命令 active。
- Hindsight 先保存：实际 `learnFromCompletedCodingRun` 读取真实已完成 Coding Run 与通过的测试证据，返回命令 `duplicate`，没有新增 promotion，只保留 Hindsight 命令 active。
- 两种回放均未更新原 active 修订或延长过期时间；原 profile SHA-256 前后完全一致，真实历史两条命令仍原样保留。此次回放没有模型或网络请求。

这是**真实源数据的隔离副本 API 回放**，不能描述为修复后又执行了一轮 Electron 编码 UI 或真实模型调用。首版回放脚本曾因 sql.js 接管并修改输入字节，导致第二副本继承第一副本的 head 变化；仅修正脚本为每次复制输入字节后完成重跑，未为测试修改产品行为。最终构建、删除后重启及真实 UI 结果见主验证报告。
