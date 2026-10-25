我先读顾问技能和提案原文，再对照当前代码判断哪些结论有依据、哪些只能标成待验证。提案里的代码事实需要逐条对照实现。我先核对召回、晋升、持久化和 ADR 边界，再判断阶段 A 是否真能交付收益。官方文档的在线复核被拒绝，我按已读到的本地实现来下结论。阶段 A 的治理方向可以成立，但按字面实施会在过期清理、跨运行可见性和热路径召回上出错。

# DevFlow 直接接入 Hindsight：顾问评审

日期：2026-10-20。评审对象是只读方案，不是实施授权。结论只代表顾问意见。

#

# 结论

阶段 A 适合作为第一批，因为它复用已经晋升的正式记忆，不把未审经历写进编码简报。它目前证明不了 Hindsight 对丰富经历的价值。自动晋升语料几乎只有一句测试命令；`change_map` 和 `repair_pattern` 默认停在待审候选。

方案里的宿主 HTTP 客户端、独立投影、禁止执行器直写 MCP、以及“本地不召回不等于远端已删除”，和当前代码的权限边界一致。按方案第 1、6、9 条和费用条款直接实施，有三处会让闭环在真实调用点上失败：过期不入清理队列、按完整 `sessionId` 比对范围会丢掉跨运行的 `user_project` 记忆、Hindsight 失败或召回费用会落在三条热路径上。这三处应先改方案，再写代码。

本次没有重抓官方文档。文中所有 Hindsight 行为都标为待验证。

## 代码核对结果

下列方案陈述与当前代码一致。

| 方案陈述 | 代码证据 |
| --- | --- |
| 编码简报、阶段 Agent、讨论栏共用 `recallScopedMemory` | `coding-context.ts` 的 `recallScopedMemory`；`coding-runtime.ts` 约 2821 行；`main.ts` 约 2934 行；`workbench-conversation-service.ts` 约 486 行 |
| 先解析范围，再取记忆、BM25、预算，并核对 head | `recallScopedMemory` 在返回前对每条调用 `getAgentMemoryHead`，修订或状态不一致即抛错 |
| 学习只吸收已完成、评估通过、非 fake、有测试和 diff 的 Coding Run | `learnFromCompletedCodingRun` 开头的资格判断 |
| `statementKind` 为 `test_command` / `change_map` / `repair_pattern`，策略只晋升测试命令 | `CODING_RUN_MEMORY_POLICY_KINDS` 只有 `test_command`；语句模板在 `deriveCodingRunMemoryStatements` |
| provenance 只有 `agent_observation` 与 `coding_run` | `AgentMemoryCandidateProvenance` |
| 晋升、修订、删除、检索走 durable；`runDurableMutation` 先导出 SQL.js 快照，失败则恢复 | `LOCAL_STORE_METHOD_EXECUTION`；`runDurableMutation` 与队列化的 `persist()` |
| Team 投影不是私有正文 | `RemoteAgentMemorySummary` 有 `redacted: true`，字段里没有 `statement`；`enqueueCanonicalAgentMemoryProjection` 在 `scope.kind === 'local'` 或来源为 `coding_run` 时直接返回 |
| 讨论栏每步重读记忆，失败可降级；压缩会先丢掉记忆 | `recallBackgroundMemory` 的 `catch`；`packConversationContext` 在超限时删除 `backgroundMemory` |
| 扫描上限 2048，返回最多 256，按 `created_at` 升序 | `AGENT_MEMORY_ACTIVE_REVISIONS_MAX = 2048`，`AGENT_MEMORY_RETRIEVAL_LIMIT_MAX = 256`；SQL `order by r.created_at asc` 后只把前 `limit` 条放进结果。超过 2048 会抛错，不是静默截断 |
| `getAgentMemoryHead` 不能代替范围过滤 | 该函数只按 `memoryId` 读 head，没有可见性或配对谓词 |

召回预算也与方案一致，而且编码简报把已选记忆标成压缩时不可丢弃：

- 编码：8 条、4000 字节
- 阶段 Agent：6 条、3000 字节
- 讨论栏：4 条、2000 字节
- 单条语句上限 3800 字节，另有 200 字节标签预留；超限整条跳过，不截断

`rankMemoryByRelevance` 默认至少要有一个共同非停用词。零词元重叠的语义命中必须在进入该函数之前单独放行，方案这一条是对的。

本地 `sessionId` 不能当 bank 身份，这一点同样成立。未配对项目的执行范围把 `sessionId` 设成 `coding-session-` 加当前 `runtimeId` 的哈希。`user_project` 的 SQL 只比较 `user_id`，不比较会话。ADR 0024 写明本地范围忽略会话，否则跨 Coding Run 无法召回。策略晋升的测试命令正是 `user_project`、`private`、30 天过期。

Workbench MCP 工具带 `readOnlyHint: true`。阶段 Agent 使用只读执行器。晋升权威在 Electron 主进程。给 Native 或 OpenCode 各装一套可写 Hindsight MCP，会把 retain 和删除放到执行器侧，和 ADR 0018 冲突。主进程持有客户端是符合代码的选择。

`remote_sync_outbox` 不适合承载这份投影。同一幂等键会把已有操作合并回 `pending` 并抬高 generation，发送前再从主进程推导团队元数据。Coding Run 来源被排除。Hindsight 需要的是不可变正文版本和私有语句，应使用新的投影表。`agent_memory_index_entries` 只在本地 purge 时删除，主路径没有写入向量；它也不是远端操作队列。

## 设计与代码不一致的地方

**过期不经过删除。** `retrieveAgentMemoryRevisions` 在发现 `expiresAt` 已到时，把 head 改为 `expired`，版本加一，写 `memory_expired` 审计，调用 `enqueueCanonicalAgentMemoryProjection`，再 `persist()`。这是一次 durable 变更，不经过 `commitAgentMemoryDeletion`。方案第 1 条只把出箱写进晋升、修订和删除。已经变成 `ready` 的远端文档，不会因为这次过期进入清理队列。本地过滤可以停止注入；它不会删除远端事实。

**“检查 scope”如果做成整份 scope 相等，跨运行召回会消失。** `assertCodingContextCurrent` 用 `JSON.stringify` 比较的是回执里的执行范围和当前执行范围，用来发现配对变化。记忆行自己的 `scope.sessionId` 仍是当初那次运行的会话。`user_project` 召回故意不要求会话相等。hydration 若照搬回执比较，下一轮 Coding Run 会丢掉上一轮已经晋升的测试命令和人工晋升记忆。bank 映射排除 `sessionId` 解决不了读路径上的过严比较。

**三条调用方的失败语义不同。** 讨论栏和阶段 Agent 用外层 `catch` 吃掉整个 `recallScopedMemory`。函数一旦抛错，本步连 BM25 结果也没有。编码启动在 `reserveCodingAgentRun` 之前调用 `recallCodingMemory`，这里没有 catch；Hindsight 超时会阻止开始编码，而不会留下半成品 run。方案要求“断开时保持本地召回”。这个隔离必须放在 `recallScopedMemory` 内部，并且发生在本地结果已经算完之后。

**费用开关只约束写入。** 讨论栏每个宿主步骤都召回，一轮最多 12 步。阶段生成和编码启动各召回一次。编码查询还包含请求、指令、节点、已批准澄清或设计的标题与摘要，以及最多 24 条路径。这些查询文本是另一路出境，和同步正式记忆原文不同。方案把 retain、embedding、rerank、Reflect 都算进费用，但“超预算只暂停同步，不影响主任务”只覆盖写入。

**可见性变化不会变成非 active。** `reviseAgentMemoryRevision` 新修订的 `status` 固定为 `active`，但 `visibility` 可以改成 `runtime` 或 `project_shared`。之后 SQL 不再把它当作当前调用方的 `user_project` 记忆。worker 只看 head 是否 `active` 时，旧文档会继续留在项目 bank 里。修订出箱必须比较可见性，并清理旧 `document_id`。

**`omittedMemoryCount` 现在是检索窗口长度减去最终选中数。** 窗口里词法不相关的条目也算省略。语义命中若来自窗口之外，这个差可能变小甚至变负。它不能直接当成“Hindsight 多找回了多少条”的指标。

**本地 purge 与远端清理是两套状态。** `purgeAgentMemoryDerivedState` 删的是本地索引行，并把 head 标为 `deleted`。方案把这两套状态分开，这是对的。实现时不要在 `purge_completed` 上报告 Hindsight 已清除。

## 阶段 A 是否值得先做

值得先做阶段 A 的治理切片，不值得把它当成 Hindsight 价值已经成立。

正式记忆的实际形状：

- 自动进入正式记忆的只有 `Verified test command for this project: …`。同一语句会去重，30 天后过期。它和当前任务几乎没有可迁移的修复经验，BM25 已经能对命令词元命中。
- `change_map` 和 `repair_pattern` 各是一句英文模板，含标题、路径和失败摘要。它们跨中英文措辞时，语义召回可能胜过 BM25，但默认 `human_review_required`，不进入第一版语料，除非用户已经晋升。
- 失败测试、被拒绝的尝试、最终测试和 diff 仍留在 Coding Run 证据里，不在正式语句里。Hindsight 的 experience 类型要到阶段 B 的 `ExperienceRecord` 才有原料。

阶段 A 仍有一个和经历无关的具体收益：当前检索在范围内按创建时间从旧到新只返回 256 条。语料超过这个窗口时，较新的正式记忆根本进不了 BM25。精确来源 hydration 让 Hindsight 可以带回窗口外、且本地仍然有效的记忆。语料不超过 256 条时，这个收益不存在，短模板的语义增益要靠固定案例，不能靠协议测试推断。

阶段 B 应保持独立。`ExperienceRecord` 需要新的 provenance 类型和迁移，不能塞进 `coding_run.statementKind`。编码简报继续只收正式记忆。讨论栏里的低信任“相似经历”是合适的第一个消费方，但那个入口现在还不存在。Reflect、observation 和 mental model 会带来截断出处和额外模型费用，官方材料自己也把 observation 的 `source_facts` 截断标成风险。在阶段 A 的幂等、删除和读路径还没锁住之前做这些，范围会盖过收益。

建议的停止条件：用一组固定、脱敏、事先标好预期记忆 id 的案例比较“仅 BM25”和“BM25 加 Hindsight”。分开记录窗口内换词命中、窗口外命中、无关召回、延迟和估算费用。没有增量相关命中时，停止 backfill，也不要启动阶段 B。协议测试通过只能说明接线可用。

## 阻塞问题

1. **过期和可见性收紧没有进入同一个清理闭环。** 过期写在 `retrieveAgentMemoryRevisions` 的过期分支。可见性变窄写在修订里，head 仍是 `active`。只在晋升、修订、删除三个函数里入队，会漏掉过期；修订处理若只看 `active`，会漏掉旧文档。本地不再注入之后，远端事实仍然可被召回。
2. **读路径范围谓词还没写成现有 SQL。** 第一版真正会跨运行复用的是 `user_project`。它按本地项目、范围种类、用户和可见性匹配，不要求 `sessionId` 或 `runtimeId` 相等。`runtime` 才同时要求会话和 `c.runtime_id`。`getAgentMemoryHead` 没有这些谓词。hydration 与 `assertCodingContextCurrent` 必须共用同一套谓词，并继续做过期 CAS 和审计。
3. **可选召回还没有落到真实热路径。** 内部隔离失败后，应返回已经算好的本地结果。召回要有独立超时、次数和费用上限；超限则跳过 Hindsight，编码、阶段生成和讨论继续。写入预算暂停不能代替这个上限。查询文本按出境处理。

## 风险

- 未超过 256 条时，阶段 A 的用户可见增益可能很小，而 retain 仍会对短句调用提取和 embedding。可能性高，影响中。
- 锁定版本前，删除闭包、幂等重放、取消后的迟到写入、未标记事实的默认命中、bank 是否硬隔离、自动 consolidation 开关是否真关模型，都可能和方案摘录不同。可能性高，影响高。
- 在 `runDurableMutation` 或 durable 方法里等待 HTTP，会占住整个 SQL.js 写入队列。快照恢复只覆盖进程内数据库；`persist()` 用临时文件加 `rename`。网络必须放在领取和结算两次短 durable 操作之外。可能性中，影响高。
- worker 若用 direct 读看到尚未 `persist()` 的出箱行并先提交远端，随后本地回滚，会留下孤儿事实。领取应排在产生该行的 durable 调用返回之后。可能性中，影响高。
- 同一逻辑来源上，后完成的旧 retain 可能在删除或新修订之后把事实写回去。方案里的串行、完成回写前再查生命周期、以及结算后再清理，是必要顺序。服务端是否把同一 `operation_id` 的成功缓存到取消之后，仍待验证。可能性中，影响高。
- 编码简报里被预算选中的记忆在 `compactExecutionContext` 中是 `required: true`。融合只能发生在 `selectMemoryWithinBudget` 之前，注入正文必须是脱敏后的本地语句。可能性中，影响中。
- OpenCode 编码引擎按 ADR 0025 保留 HOME。用户自己配置的 Hindsight MCP 不在这次宿主客户端的控制范围内。可能性中，影响中。
- 排名融合规则还没冻结。两路原始分数不能相加；在评估改阈值之前，需要一条确定性的临时规则，测试才能锁定。可能性中，影响中。

## 外部协议：待验证

本次请求读取 `https://hindsight.vectorize.io/developer/api/retain`、`recall`、`operations` 和 `https://hindsight.vectorize.io/developer/observations` 时，工具调用被用户拒绝。没有重试，也没有改用可写模式。下面各项都不要当成已证实的服务行为。方案里的文档摘录只能当作假设。

锁版本后需要回传的证据是：服务版本号、请求与响应原文里和下列字段对应的片段，以及失败时的状态码。

- retain：`document_id` 的 replace 与 append 是否改变已有 fact；`operation_id` 在相同载荷、不同载荷、取消之后重放时各返回什么；异步结果保留多久。
- recall：`world`、`experience`、`observation` 的过滤是否真能排除 observation；`document_id` 和自定义 metadata 是否原样返回；默认标签是否会命中未标记事实；按内容合并事实时是否会换成另一份 `document_id`。
- documents 与 memories：删除文档是否级联 fact、observation、mental model 和未完成操作；单条 invalidate 与删除文档的差别。
- observations：`HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION=false` 在所选版本是进程设置还是 bank 设置；关闭后 retain、embedding、rerank 是否仍调用模型。
- operations：`cancelled` 之后是否仍可能出现成功写入；用什么查询能证明某个 `operation_id` 已经不会再写。

不能证明“取消即停写”或“删除覆盖全部衍生物”时，保持方案中的 `cleanup_pending`，隔离该投影，并避免报告清除完成。不能证明自动 consolidation 已关闭时，不要开启 retain。

## 最小交付与应推迟的部分

第一批只包含这些模块和测试：

- 主进程内的小型客户端、按项目默认关闭的配置、配置 generation、bank 映射和凭据。凭据走现有宿主加密存储。bank 键包含本地项目、范围种类和用户；第一版只同步 local 范围、`visibility = user_project`、head 与修订均为 `active` 且未过期的记忆。不包含 `runtime` 和 `project_shared`。
- 新的投影出箱，写在晋升、修订、删除和检索过期分支里，并且写在同一次 mutation 的 `persist()` 之前。状态使用方案中的 `queued`、`submitted`、`ready`、`retryable_failed`、`unknown`、`cancelled`，另加未完成清理。`operation_id` 一次逻辑写入固定一份载荷。
- worker：短领取、进程外 HTTP、短结算。提交前和回写前检查 head、可见性、修订、摘要、TTL 和配置 generation。删除、过期、可见性变窄都生成清理，不把本地 `purge_completed` 当作远端完成。
- `recallScopedMemory` 内合并本地 BM25 和远端命中，按 `memoryId` 去重；远端失败只跳过远端。精确 hydration 与恢复校验共用，有上限，并保留过期副作用。注入本地语句。预算仍用三个现有常量。
- 召回超时和召回费用上限。写入超预算只暂停同步。
- 测试：持久化失败同时回滚本地记忆和出箱；重启后队列还在；相同操作不重复入队；响应丢失、未知操作、新旧修订乱序；删除或过期与在途 retain 竞争；`user_project` 在不同 `sessionId` 下仍可召回；`runtime` 记忆不进入第一版 bank；无 metadata 或范围冲突则丢弃；零共同词元的合法命中可进入候选，过期版本不能进入简报；Hindsight 抛错时编码仍能启动，阶段和讨论栏仍保留 BM25；召回超预算时主任务继续。

协议契约测试和固定案例比较放在开启 backfill 之前。backfill 有界、可取消，并且不是打开开关就自动跑完全库。

推迟到阶段 A 的停止条件满足之后：`ExperienceRecord`、provenance 迁移、讨论栏相似经历入口、Reflect、observation、mental model、团队或 `project_shared` bank、执行器 MCP、自动 consolidation，以及把远端 fact 文本晋升为正式记忆。多 Agent 协调器不在这次范围内。

## 请 Codex 补回的证据

请在只读条件下重新获取方案中列出的 retain、recall、documents、memories、observations、operations 页面，以及实际部署版本的对应说明。把版本号和上述字段的原文片段附回方案。不要据此把待验证项改成已保证。同时用当前测试或源码引用确认：过期分支会 `persist`，`user_project` 的 SQL 不比较 `sessionId`，编码召回位于 `reserveCodingAgentRun` 之前且没有 catch。这三项本评审已在工作树源码中看到；若后续修订移动了这些调用，用新的文件和行号替换。

## Machine Verdict

```json
{"verdict":"fail","blocking_issues":[{"id":"expiry-visibility-cleanup","summary":"第三方清理出箱若只挂在晋升、修订和删除上，会漏掉 retrieveAgentMemoryRevisions 内部的过期写入；修订把可见性从 user_project 收窄时 head 仍为 active。本地停止注入不会自动产生远端清理任务。","fix_hint":"在过期分支于 persist 前写入与删除同类的清理出箱。修订同步新文档时同时清理旧 document_id，并按可见性而不只按 active 判断是否仍可召回。本地 purge_completed 与远端清理状态分开，未完成前不报告清除完成。"},{"id":"hydration-visibility-predicate","summary":"跨运行正式记忆是 user_project，检索不比较 sessionId 或 runtimeId。getAgentMemoryHead 没有范围谓词。hydration 若要求整份 scope 相等，或只用 head 校验，会丢掉跨运行记忆或绕过范围。","fix_hint":"让召回和 assertCodingContextCurrent 共用有界的精确来源 hydration，谓词与 retrieveAgentMemoryRevisions 的可见性 SQL 一致：user_project 只要求同一本地项目、范围种类和用户；runtime 才比较会话与 runtime id。继续执行过期 CAS、审计和 head、revision、contentDigest、TTL 校验。第一版不同步 runtime 与 project_shared。"},{"id":"recall-hot-path-isolation-budget","summary":"讨论栏每步、阶段生成和编码启动都调用 recallScopedMemory。外层 catch 会丢掉全部记忆；编码路径在 reserveCodingAgentRun 之前没有 catch。费用条款只暂停写入，召回次数、超时和查询文本出境没有独立上限。","fix_hint":"在 recallScopedMemory 内部于本地结果计算完成之后隔离 Hindsight 错误，失败时返回 BM25 结果。为召回单独设置超时、次数和费用上限，超限跳过远端且不阻止主任务。查询文本按独立出境计入同意范围和预算。注入内容保持为预算内的本地正式语句。"}],"risks":[{"summary":"正式记忆大多是短模板。语料不超过最旧 256 条窗口时，语义召回相对 BM25 可能没有可见增量，但 retain 仍会产生提取和 embedding 费用。","likelihood":"high","impact":"medium"},{"summary":"服务版本未锁定。文档删除闭包、operation_id 重放、取消后的迟到写入、未标记事实命中、bank 硬隔离和关闭自动 consolidation 后是否仍调用模型，都还没有实测证据。","likelihood":"high","impact":"high"},{"summary":"在 SQL.js durable 队列中等待 HTTP，或在 persist 完成前用 direct 读领取出箱，会堵住全部本地写入或在回滚后留下远端孤儿事实。","likelihood":"medium","impact":"high"},{"summary":"同一来源的旧 retain 在删除或新修订之后完成时，若完成回写只根据远端成功把投影标为 ready，已删除内容会重新变得可召回。","likelihood":"medium","impact":"high"},{"summary":"OpenCode 编码引擎保留用户 HOME，用户自行安装的 Hindsight MCP 可以绕过主进程记忆边界。","likelihood":"medium","impact":"medium"},{"summary":"两路融合规则尚未冻结，评估前排序和门槛无法被测试锁定。","likelihood":"medium","impact":"medium"}],"recommended_revisions":["把阶段 A 定为治理闭环：默认关闭、无自动全量 backfill、只同步 local 且 user_project 的 active 正式记忆，并用固定脱敏案例作为继续 backfill 或进入阶段 B 的停止条件。","新增独立投影出箱，不要复用 remote_sync_outbox 的合并语义，也不要把操作状态写入 agent_memory_index_entries。","worker 采用短 durable 领取、队列外 HTTP、短 durable 结算；每个逻辑来源串行，完成回写前重新检查生命周期和配置 generation。","冻结一条临时的名次融合规则和独立相关性门槛，原始分数不要相加；omittedMemoryCount 改为本次治理候选中未注入的数量。","协议实测未通过前，不要宣称幂等、删除闭包、取消屏障或自动 consolidation 已关闭。"],"next_iteration_prompt":"请只修订 Hindsight 接入方案，不要改项目代码。补上三处闭环：retrieveAgentMemoryRevisions 过期分支也要在同一次 durable mutation 里写入远端清理出箱，修订造成的可见性变窄要清理旧 document_id；精确 hydration 与 assertCodingContextCurrent 共用 retrieve 的可见性 SQL，user_project 不按 sessionId 相等过滤；Hindsight 错误隔离在 recallScopedMemory 内部，并为讨论栏每步、阶段生成和编码启动设置独立召回超时与费用上限。保持阶段 A 为默认关闭的正式记忆投影，写明固定案例没有增量命中时停止 backfill、不进入 ExperienceRecord。把官方协议中未实测的幂等、删除闭包、取消迟到写入、标签默认命中和 consolidation 开关继续标为待验证。"}
```