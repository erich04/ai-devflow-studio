# DevFlow 直接接入 Hindsight：咨询后方案

日期：2026-10-20（America/Chicago）。
状态：已完成一次 Cursor/Grok 4.7 Extra High 只读咨询，Codex 已逐项处置意见；尚未接入 Hindsight、调用其模型或修改项目代码。Cursor 咨询本身已按用户明确授权执行。
仓库：/Users/erich/.codex/worktrees/hardening-h5-h7/ai-devflow-studio。

## 用户目标与咨询范围

用户希望跳过 OpenViking，直接引入 Hindsight，并要求与 Cursor 讨论接入方式。请以只读顾问模式检查本方案与当前代码，给出具体、中文意见。不得编辑文件、安装依赖、执行迁移、启动服务或修改外部状态。已有大量设计修订相关工作树改动，不属于本任务。

本次需要解决：
1. 第一版应从“现有正式记忆的语义召回”入手，还是直接导入丰富的 Coding Run 经历？二者怎样分期才能既有收益又保留现有治理语义？
2. 宿主 HTTP 客户端与给每个执行器直接装 Hindsight MCP，哪种更适合当前代码？
3. 幂等、版本、删除、异步处理、费用和跨范围隔离的闭环是否完整？
4. 明确最小交付、代码接入点、验证要求，以及必须在锁定 Hindsight 版本后检查的能力。

## 当前代码事实（请自行核实）

- `apps/desktop/electron/coding-context.ts:50` 的 `recallScopedMemory` 由编码简报、阶段 Agent 和讨论栏共用；先解析可信 scope，再获取有效记忆，BM25 排序和按预算选择，最后校验 head 当前修订。返回原始正式记忆与版本回执。
- 同文件 `assertCodingContextCurrent` 对已生成编码简报做范围、提示摘要、headVersion、revision、contentDigest 校验；失效时要求新 run。
- `apps/desktop/electron/coding-run-memory-learning.ts:66` 只从已完成、通过评估、非 fake、具有测试及 diff 证据的 Coding Run 生成确定性候选。当前 statementKind 为 test_command/change_map/repair_pattern；仅 test_command 可受限策略晋升。
- `packages/shared/src/retrieval-memory.ts` 中 candidate provenance 是严格的 agent_observation/coding_run 联合；不能把外部归纳伪装成已有模板来源。记忆有 visibility、scope、TTL、revision、head、墓碑。
- `apps/desktop/electron/local-store.ts` 的 commitAgentMemoryPromotion/Revision/Deletion 是 durable 方法。`runDurableMutation` 导出 SQL.js 快照、失败恢复；`persist()` 将整库快照排队持久化。不是普通 Postgres 事务，禁止在该锁内做网络请求。生命周期目前有 Team projection enqueue，但其公开投影不等于第三方私有正文同步。
- `apps/desktop/electron/workbench-conversation-service.ts` 每个宿主步骤重读记忆；可选记忆失败可降级；压缩与 PromptSection 总预算由宿主负责。
- ADR 0018、0021、0024、0025、0026：原文/执行事实与摘要分开；背景记忆不能授权或覆盖当前需求；Git 是项目规范来源；常驻项目说明保留。ADR 0024 禁止自动保存每次观察；Coding Run 来源目前不进入 Team 摘要。不要扩张到当前没有模型消费方的多 Agent 协调器。

## 拟议架构与阶段

直接接 Hindsight，不依赖 OpenViking，不引入通用九后端平台。
由 Electron Main 持有 Hindsight 客户端、凭据、bank 映射、同步任务及限额。执行器通过 DevFlow 的统一记忆边界消费。
先接本机独立 Hindsight 服务，提供方的提取模型、embedding/reranker 也需要明确配置；本机 HTTP 不能被表述为所有数据天然不出机。服务可选，现有功能在关闭/不可用时继续工作。

### 阶段 A：可追溯的语义召回闭环（默认推荐的第一批）

1. 在正式记忆晋升/修订/删除，以及 `retrieveAgentMemoryRevisions` 的过期状态变更中，在同一次 durable mutation、同一次 persist 前写入新的第三方投影 outbox。新修订不再符合已启用可见性时，仍需给旧投影生成清理任务。后台 worker 另扫描已同步投影的到期时间，避免只能等下次召回才清理；应用离线时保留到期清理待办，不承诺远端即时清除。当前学习触发和人工晋升流程不变。
2. 只同步明确启用范围内的 active 记忆。首个试点限定 `scope.kind=local`、`visibility=user_project`、`sensitivity=private`，一个本地用户项目使用一个专用 bank。运行时记忆、团队范围和 project_shared 后续显式建模。不将 sessionId 当跨运行 bank 身份，也不合并本地/团队或不同组织范围。bankId 由宿主映射，不能由模型参数决定。bank 是隔离命名空间，不是认证授权替代物。
3. 写入项为一条正式记忆的本地原文及结构化来源信息，携带 memoryId/revision/contentDigest/来源摘要/发生时间与主体。Hindsight 会提取一到多条 fact，视为检索投影。第一版不把远端生成的 fact 文本直接作为正式记忆注入。
4. 拟用不可变版本 document_id（绑定 memoryId + revision + digest），另用持久化 UUID operation_id 标识一次逻辑异步 retain；重试复用 operation_id。原始版本和 payload 固定，不允许重试换内容。版本变更时同步新文档并清理旧文档；本地过滤即时生效。不要声称 document_id 就能避免所有重复模型计费。
5. worker 状态包括 queued/submitted/ready/retryable_failed/unknown/cancelled/cleanup_pending；记录远端 operationId，网络响应丢失时先查询或使用同幂等键恢复。采用短 durable 领取、队列外 HTTP、短 durable 结算；领取也必须排在产生 outbox 的持久化之后，不能 direct 读到未落盘状态就发送。每个逻辑 source 的操作串行；未知状态不盲目重提。每次提交与完成回写前检查当前生命周期、可见性和配置 generation。操作幂等记录过期后不能把同一 UUID 仍然去重视为保证，需保留本地终态与对账信息。
6. 读路径：本地 BM25 与 Hindsight recall 候选合并，按本地 memoryId 去重；Hindsight 只查询 world/experience 基础事实，不使用 observation/Reflect。通过 document_id + 宿主投影映射 + metadata 验证全部归属；缺失/冲突来源直接丢弃。回读当前本地原文，检查 scope/status/head/revision/digest/TTL 后注入。
7. Hindsight 召回无需命中原来的 BM25 词元门槛，否则语义检索没有增益。拟定初始融合为等权 RRF，常数 60，两路各按本地 memoryId 去重后排名，单个来源内同一记忆多条 fact 只取最佳名次；最终同分按日期与 id 确定排序。提供方门槛按锁定模型、reranker 和版本的评估配置单独校准，门槛未确定前仅运行影子评估。此规则是拟验证的初始算法，不是已证明最优。`omittedMemoryCount` 按本次考虑的有效唯一候选并集减去最终注入数计算，另记无来源、过期、无关、超预算等原因，不能以它冒充语义收益。适配结果不能创建正式记忆或改变 head。
8. 继续使用现有 consumer-specific 预算和 CodingContextReceipt。调用期间来源发生变化则重新验证；已保存简报的恢复继续使用 assertCodingContextCurrent。
9. 源删除/到期/改为不可见，立即停止本地注入并阻断待发送旧写入；远端删除和衍生物清理由异步清理任务跟踪，不能把“本地已不召回”声称为“远端已清除”。待处理 retain 可能在 delete 之后完成，worker 必须结算后清理；未知远端操作需 reconcile，未完成前不报告 purge 完成。
10. 外部同步状态独立于现有本地 tombstone purge 状态，避免已有本地 purge 完成被误解为第三方清理完成。
11. 进一步核查发现：`retrieveAgentMemoryRevisions` 扫描范围内最多 2048 条，按 created_at 升序向调用者返回至多 256 条；`assertCodingContextCurrent` 也只在该返回集合找引用。若 Hindsight 找到集合以外的有效记忆，不能通过直接 getHead 绕过 scope，也不能注入后在恢复时被错误判失效。须新增有界、按精确来源集合解析的 scoped hydration，并由召回与恢复校验共用，同时保留过期状态变更和审计。这个问题请列入接入分析。
12. 第一版为专用 bank 关闭自动 consolidation，不召回 observations，也不创建 mental models，缩小衍生删除与隐式费用范围。官方当前文档支持 `HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION=false`/bank 配置；所选部署版本仍需协议实测。关闭自动处理不代表零模型调用，retain/embedding/rerank 仍须计量与限额。
13. 官方 Operations 文档说明 cancel 是协作式：状态已 cancelled 不保证正在执行的子批次已停止，部分写入可能晚到。因此 cancelled 本身不能作为远端清理完成的屏障。需要锁版本验证可证明的 worker 停止/结算机制；不能证明时保留 cleanup_pending 并隔离该投影，不宣称完全清除。
14. scoped hydration 复用现有 SQL 的授权谓词：项目、scope.kind、organizationId、team project 先匹配；user_project 还要求 userId 相同，故意不比较源记忆的 sessionId/runtimeId；runtime 才比较会话和来源 runtime；团队共享分支首版不启用。回执执行 scope 与当前执行 scope 的精确比较继续保留，这是另一种检查。直接 getHead 不能充当授权。
15. Hindsight 故障隔离在 `recallScopedMemory` 内部：先获得有效本地结果，远端超时/不可用/额度不足时返回本地候选的预算选择。只捕获提供方失败，不能用此兜底吞掉本地权限或数据完整性错误。新增 AbortSignal、每次调用 deadline、每轮/每阶段调用数和召回独立费用控制；讨论栏最多可有多步，不能只限制 retain。先用影子模式验证；开关只影响新组装上下文，不给已保存的编码简报偷偷补新记忆。
16. 发出的查询单独最小化、脱敏和限长，项目连接配置说明它会发送记忆正文以及相关当前查询。不得把编码完整简报、批准产物正文和全部对话默认作为 query。相同查询如缓存远端候选，只缓存来源身份与排名，并在每次使用时重新做本地授权、版本和到期检查。

### 阶段 B：有证据的经历与归纳（独立增量）

仅复制短句可能不能发挥 Hindsight 对丰富经历的能力。第二步新增本地可追溯的 ExperienceRecord，来源为已接受 Coding Run 中有证据的事件序列：问题、失败测试、已接受修复、最终测试及关联来源 id/digest。失败尝试可以作为已完成修复经历的组成，不自动把“尝试”当“成功规律”。不上传整段原始聊天、全量工具日志、隐藏推理或全仓代码。

ExperienceRecord 是可撤销、可过期、范围明确的经历，不能绕过待审 change_map/repair_pattern 变成指令。设计需明确其启用策略、来源/版本/删除语义和最小脱敏字段。Hindsight 提取或 Reflect 得到的跨运行规律属于 DerivedInsight 候选，记录全部来源和提供方版本，再经人工或明确政策进入正式记忆。当前 provenance 联合须新增独立类型并迁移，不能复用 coding_run.statementKind 伪造来源。

先在讨论栏“查相似经历/复盘”中消费低信任经历引用；编码简报仍只使用正式记忆。Reflect 按复盘需要显式触发，有独立预算，不每步执行。来源被撤销时，衍生归纳须失效或重算。因 source_facts 截断无法证明完整来源时，不允许将归纳晋升。

## 边界和实施结构

拟新增小型 HindsightClient、MemoryProjectionWorker 与存储契约，不改动模型提供方适配器，不在 Native/OpenCode 分别装一套可直接写的 MCP。
设置按项目开启，记录 endpoint/配置 generation/bank 映射/模型配置身份及预算上限；密钥只在宿主的安全存储中。初次 backfill 有界并能取消。
用户能看到待同步/可用/失败/待远端清理、来源与最近一次召回；关闭后回到现有本地召回。不能因“关闭同步”直接承诺远端清理；删除数据是独立显式操作。
费用涵盖 retain 提取、embedding、自动 consolidation、recall reranker/embedding 与可选 Reflect；只有估算时标估算，不能编造 provider settlement。写入与召回分别限制次数、输入量、并发和重试；超过召回限额走本地，超过写入限额暂停同步。若承诺硬金额上限，必须由服务模型网关或提供方可验证的额度执行，不能拿客户端估算冒充硬限额。收费试点独立配置预算，协议联调用假服务。部署文档需说明自动 consolidation 能否禁用/限额与观测方式。
服务异步操作历史可能保留原始载荷；文档删除、索引清除、操作历史、日志和备份的保留是不同层次。界面只报告已经验证的清理范围，不能用一个 deleteDocument 响应保证所有副本彻底消失。

## 拟验证

- 本地晋升+outbox 的持久化失败同时回滚；重启恢复队列。
- 相同操作重试不重复入队；响应丢失、operation unknown、旧新修订乱序。
- 删除与正在执行 retain 竞争、到期、可见范围变化；远端清理未完成的状态。
- bank 由宿主固定；跨项目/用户/组织污染、无标签/缺 metadata 命中均拒绝。
- 语义命中且零共同词元仍可进入候选；过时版本不能进入简报；两路合并预算正确。
- Hindsight 断开/超时保持本地召回，现有记忆恢复校验和压缩回归不变。
- 锁定服务版本后的协议契约测试：operation 幂等、source metadata/document_id 回传、基础 facts 类型过滤、原始/衍生数据删除、异步完成与鉴权。
- 用固定真实脱敏案例比较本地 BM25 与加入 Hindsight 的 Recall：相关性、无关召回、跨会话修复经验命中、延迟与总成本。若只验证协议，不能宣称提高任务成功率。
- 为避免把原有 256 条窗口问题算作 Hindsight 的优势，评估分别比较“现有 BM25”“相同授权候选池中的 BM25”“相同池中的 BM25+Hindsight”。窗口修正收益与语义增益分开记录。
- 短句正式记忆没有增量收益时，停止扩大该类 backfill；这不证明丰富经历没有价值。阶段 B 若继续，只先用独立、已审核且脱敏的经历样本做有界实验，协议和来源生命周期未通过前不能开启生产经验学习。

## 官方材料（本次已读取，服务版本尚未锁定）

- https://hindsight.vectorize.io/developer/api/retain
  - retain 会抽取事实；metadata/document_id 可用于追溯。
  - document_id 支持 replace/append；异步 retain 的 operation_id 用于恢复未知响应与去重。具体保留时间和冲突约束待查。
- https://hindsight.vectorize.io/developer/api/recall
  - 可选择 world/experience/observation；metadata/document_id 可回传。
  - 默认标签匹配可包含未标记事实；不能靠默认过滤实现隔离。
  - observation 的 source facts 可因预算截断；不能假定返回完整出处。
- https://hindsight.vectorize.io/developer/api/documents
  - 删除文档及相关 memories；全部衍生 observation/mental models/异步任务的闭包需要锁版本核查。
- https://hindsight.vectorize.io/developer/api/memories
  - individual memory invalidate 与删除文档语义不同。
- https://hindsight.vectorize.io/developer/observations
  - 支持关闭自动 consolidation；后续手动运行属于额外模型工作。
- https://hindsight.vectorize.io/developer/api/operations
  - cancel 为协作式；状态 cancelled 不代表没有迟到写入。

## 希望 Cursor 明确回答

- 哪些设计与代码不匹配？请给具体文件/函数证据。
- 阶段 A 是否值得先做，还是需要一个更小的 ExperienceRecord 版本才能验证 Hindsight 的价值？请给判断依据。
- 是否还有阻塞正确性的缺口，尤其 recall 与本地治理、异步乱序、清理与成本？
- 哪些复杂度应推迟，第一批到底应包含哪些模块和测试？
- 外部文档未实测的能力请标记为待验证，不要替提供方保证。

## 本轮咨询与 Codex 处置

Cursor session：`dac3b3e9-b35e-4e27-ab2d-d94cfd3af9d2`。
顾问原始结论是 `fail`，指出三个方案缺口；这不是对项目现有实现或最终修订方案的测试结论。下列修订由 Codex 独立判断，没有请求第二轮“通过”背书。

| 顾问意见 | 处置 | 理由与落点 |
| --- | --- | --- |
| expiry-visibility-cleanup | 采纳 | 代码确认过期会在 retrieve 内落盘；补阶段 A 第 1、5 条以及后台到期扫描。可见性变更按旧投影清理，不只看 active。 |
| hydration-visibility-predicate | 采纳为明确契约 | 原意已是 user_project，但“检查 scope”不够精确；第 14 条显式写出 SQL 匹配语义，区分记忆可见性和执行回执范围。 |
| recall-hot-path-isolation-budget | 采纳 | 编码启动的调用确无外层 catch；第 15、16 条明确内部 provider 错误隔离、读预算和查询数据范围。 |
| 现有 Team outbox 不适合私有原文 | 采纳 | 它会合并 metadata 操作，且明确排除 local/Coding Run 来源。第三方投影单独建模。 |
| durable 内网络 / 未落盘领取会破坏边界 | 采纳 | 第 5 条拆成领取、网络、结算三段；outbox 与 source 一起落盘。 |
| 初始排序及省略计数不明确 | 采纳 | 第 7 条冻结待验证的初始名次融合与独立阈值，修正唯一候选并集计数。 |
| 仅短句的收益可能不够 | 采纳 | 先验证价值，不把接通协议视作收益证明；阶段 B 独立实验。 |
| 阶段 A 无收益就不再做阶段 B | 不采纳为普遍停止条件 | 短句与丰富经历是不同语料，不能由一种没有收益推断另一种没有价值。停止扩大短句同步，同时允许有独立证据和预算的小样本经历实验。 |
| 把窗口外命中当作 Hindsight 的收益 | 调整评估方式 | 先统一授权候选池比较，区分修复现有窗口和语义检索的贡献。 |
| 用户自行安装 MCP 可绕过宿主 | 延后处理 | 本次不安装此类 MCP，也不改变用户执行器配置。以后做统一执行器外联治理时单独定义；不能借此阻止本次只读设计。 |
| 锁版本协议实测 | 保留为实施验收条件 | 本次完成官方资料复核；未启动 Hindsight，因此没有部署版本和真实请求回执，不伪造证据。 |

Cursor 工具环境未能在线读取官方页面；Codex 已独立读取本方案列出的官方页面并核对摘录。文档支持和运行实测仍然分开记录。

本轮产物为方案和顾问报告，全部位于临时目录。项目业务代码、服务配置和用户数据未修改，未运行 Hindsight 收费调用。
