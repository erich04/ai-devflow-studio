<a id="adr-0024-governed-memory-learning-and-recall"></a>

# ADR 0024：受治理的记忆学习、召回与缓存友好上下文

状态：已接受（Accepted），2026-09-30。第 5 节的策略晋升可见性按本 ADR 的提议采用 `user_project` + `private` + `thirty_days`；第 2 节的常驻记忆不再单独实现，由 ADR 0025 的 L0 项目说明承担。

日期：2026-09-29

<a id="context"></a>

## 背景

ADR 0018 和 ADR 0021 建立了带版本、有范围、可删除的记忆，以及确定性抽取压缩的编码简报。按 2026-09 的代码核对，还有以下不足：

- 写入：候选只来自独立 Agent Runtime，内容是固定模板句。Coding Run 结束后不产生候选，没有去重，`actorKind: 'policy'` 在契约里存在但没有代码使用。
- 召回：只有编码简报会召回。打分是查询词的子串计数，没有 IDF，也没有最低分，所以不相关的记忆也会占满预算。每条另计 200 字节标签预留、总预算 4,000 字节，因此超过约 3,800 字节的语句永远召回不到，而候选上限是 8 KB。
- 注入：阶段 Agent、讨论栏和多 Agent 协调器都不读记忆。
- 预算：ADR 0021 写的 12,000 字节已过时，运行时实际使用 `CODING_BRIEF_MAX_BYTES = 24_000`。
- 缓存：DeepSeek/OpenAI 使用自动前缀缓存，但 Native v2 三个阶段的 system prompt 不同，讨论栏的易变字段排在稳定大字段之前，所以几乎命不中缓存。

核对代码时还发现两个约束，会影响设计：

1. 候选来源只允许 `provenance.kind = 'agent_observation'`。共享解析器（精确键）、SQLite 表（`runtime_id` 等列为 NOT NULL，并用 `json_extract` 校验）、`saveAgentMemoryCandidate`（要求存在对应的运行时观察事件）和渲染投影四处都依赖这一点。Coding Run 没有持久化的 AgentRuntime。
2. `runtime` 可见性的召回条件是 `c.runtime_id = request.runtimeId`，而每个 Coding Run 都会生成新的 `agent-runtime-coding-*`。所以 `runtime` 可见性的记忆跨 Coding Run 永远召回不到，只有 `user_project` 和 `project_shared` 能跨运行复用。

<a id="decision"></a>

## 决策

<a id="prompt-prefix-contract"></a>

### 1. 提示前缀是缓存契约

- Native v2 的 analysis、initial、repair 共用一个静态 `NATIVE_CODING_V2_SYSTEM_PROMPT`，由 user JSON 的 `phase` 字段选择规则。运行数据（例如 `allowedPaths`）只放在 user 消息里。
- Native v2 的 user JSON 以 `stateVersion → brief` 开头，以 `phase → limits` 结尾，阶段数据放在中间。
- 讨论栏的上下文键顺序为 `originalRequirements → history → [backgroundMemory] → [criticalProposalInput] → toolObservations → latestWorkflow → contextNotice → remainingSteps → [proposalVerification]`。同一轮内工具观察只追加；已降级的观察保持降级，使后续步骤仍是前一步的前缀扩展。
- 不添加 `cache_control` 或 `prompt_cache_key` 请求参数。前后效果用现有的 `cacheReadTokens` 和 `cacheHitRate` 对比。

<a id="recall"></a>

### 2. 召回质量

- 打分改用 BM25（k1=1.2，b=0.75），IDF 按当前范围内可召回的记忆集合计算。分词改为精确词元匹配：ASCII 词拆分驼峰和路径分隔符，去掉常见停用词并做轻量词形归一；汉字用重叠二元组。实现在 `packages/shared/src/memory-relevance.ts`，由编码、阶段 Agent 和讨论栏共用。
- 设最低相关度：至少命中一个非停用词查询词元。零命中的记忆不再进入简报，计入 `omittedMemoryCount`。停用词除英文虚词和单个汉字虚词外，还包括常见的两字词（需要、使用、可以、支持等）和路径结构词（`src`、`lib`、`dist`、`index` 等），否则较长的中文需求或带路径的查询几乎和每条记忆都有公共词元。讨论栏的查询只用最新问题和 Run 标题，不带整页原始需求。
- 编码召回的查询词加入节点标题、节点说明，以及已批准澄清/方案产物的标题和摘要，不再只用 `run.request + userInstruction`。
- 预算保持：编码简报最多 8 条、4,000 字节（每条另计 200 字节标签预留）。讨论栏最多 4 条、2,000 字节。阶段 Agent 最多 6 条、3,000 字节。统一的单条可召回上限是 `AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES = 3_800`。新来源的候选（第 4 节）必须满足该上限；已存在的更大记忆仍可人工修订缩短，召回时计为已省略。
- 记忆全部按需召回，不设常驻记忆。每次都要带的项目约定属于 [ADR 0025](0025-resident-knowledge-context.md) 的 L0 项目说明（仓库根目录的 `AGENTS.md` 或 `CLAUDE.md`），由 Git 管理、可评审、所有执行器拿到的内容一致。原计划在修订上新增的 `recall: 'resident' | 'on_demand'` 字段和对应迁移不再做。

<a id="injection"></a>

### 3. 注入范围

- 阶段 Agent 和讨论栏把召回的记忆作为低信任背景，与编码简报的规则相同：不能授权，不能覆盖当前请求、原始需求或已批准产物，不算 Gate 或仓库证据，冲突时以当前请求为准。
- 范围沿用 ADR 0018 的交集规则。阶段 Agent 使用 `resolveTrustedWorkflowActor` 得到的用户。讨论栏在已配对到该本地项目时使用配对用户；未配对时使用本轮开始时已附加需求的 Run 创建者；两者都没有时本轮不召回。
- 这两处在每次调用时重新召回，不持久化附件，所以删除和过期对下一次调用立即生效。它们不产出受回执保护的执行，不增加 `CodingContextReceipt` 式的变化检查。
- 多 Agent 协调器暂不召回记忆。原计划的前置条件已完成：Supervisor 重试时读取已持久化的附件并逐项核对（附件 id、Runtime、检查点、`attachedAt`、范围、授权、`contextDigest`，且不含知识引用和记忆），不再在 `attachedAt` 时刻重建来源。召回本身推迟，原因有三：
  - 协调器的 Supervisor 和 Specialist 目前都不调用模型，召回的记忆没有消费方，只会增加失效面。
  - 存储层拒绝带知识或记忆的 Specialist 附件（启动和重试替换两处），接入需要同时放开并设计 Specialist 的继承规则。
  - 带记忆的附件在任一被引用记忆修订、删除或过期后，`isAgentRuntimeContextCurrent` 判为过期，进行中的协调会话会因此停止。需要先确定召回时机（会话开始时一次还是每个 Specialist 各自召回）和过期后的处理方式。
  等协调器开始调用模型时再按这三点设计。

<a id="learning"></a>

### 4. 从已接受的 Coding Run 提取候选

- 触发点：Coding Run 进入 `completed`，并且最新规范测试证据为 `passed`（Native 在 `settleCompletedExecutorResult`，OpenCode 在 Change Acceptance 之后）。与 `recordCodingEvaluation` 同一位置。
- 内容：只用可观察事实和确定性模板，不调用模型。当前模板有三类：
  - `test_command`：已验证的项目测试命令。语句不带任务标题（`Verified test command for this project: <命令>.`），同一项目的每个任务得到同一句，去重才能识别。
  - `change_map`：需求/节点标题到改动路径的对应。
  - `repair_pattern`：初次测试失败（含解析出的 `file:line`），经修复后通过，以及修复涉及的路径。
- 每条语句不超过可召回上限，必须满足 `redactSensitiveText` 不改变原文（与现有候选规则一致）。模板实现在 `packages/shared/src/memory-learning.ts`。
- 以后如果改由模型提取，只允许白名单结构（约定、命令、坑、文件地图），产物仍是候选。
- 持久化使用新的候选来源类型 `provenance.kind = 'coding_run'`，内容为 `runId`、`nodeId`、`codingRunId`、`testEvidenceId`、`diffArtifactId` 和 `statementKind`（语句本身就是结果摘要，不再单独存一份）。v37 迁移按 v25 的 `legacy_alter_table` 模式重建 `agent_memory_candidates`，新增 `provenance_kind` 和 `coding_run_id`，运行时相关列按来源类型条件必填。`saveAgentMemoryCandidate` 的第二个校验分支要求：Coding Run 存在、已完成且不是 fake；它自己的测试证据通过、命令等于项目规范命令；Diff 存在；范围等于该运行的 `contextReceipt.scope`。
- 候选 id 由 Coding Run 和语句类型决定，`createdAt` 取 Coding Run 的完成时间，重试时回放而不是重复创建。学习在 `recordCodingEvaluation` 之后执行，尽力而为，结果记在 Coding Run 轨迹里；失败不影响运行和工作流。
- 记忆面板和生命周期 IPC 的 `runtimeId` 改为可选。省略时是项目范围：已配对时为配对用户，否则为 Run 创建者；本地范围忽略会话，因为每个 Runtime 和 Coding Run 的本地会话都不同。这样 Coding Run 学到的记忆可以查看、晋升、修订和删除。带 `runtimeId` 时仍是原来那个 Runtime 的精确范围。
- Coding Run 来源的记忆一律不进入 Team 摘要，包括 Team 范围和人工晋升的。Team 摘要需要持久化的 Runtime，而这些事实只来自本机的工作树和测试。Agent Runtime 附件里的 `sourceRuntimeId` 对这类记忆记为 `agent-runtime-coding-<codingRunId>`，与该运行 Context 回执中的 `runtimeId` 一致。

<a id="promotion"></a>

### 5. 晋升：去重与策略晋升

- 去重：晋升和修订前，先规范化语句（NFKC、小写、合并空白、去掉末尾标点）并与同一用户、同一项目的有效记忆（未过期、未删除）比较。规范化后相同的，拒绝晋升（`AgentMemoryDuplicateError` 带已有记忆 id），修订成另一条有效记忆的内容也拒绝。词元 Jaccard 相似度不低于 0.8 的，面板提示修订那条记忆，但不阻止。判定函数在 `memory-learning.ts`；渲染投影的候选带 `duplicateOf`，面板据此提示并禁用完全相同候选的提升按钮。
- 策略晋升（`actorKind: 'policy'`）只用于 `coding_run` 来源中的 `test_command`，并且要求没有去重命中。`change_map`、`repair_pattern` 和所有 Agent Runtime 来源仍需人工晋升。原计划 `change_map` 也走策略，2026-09-30 审阅后收窄：它带任务标题（Team 需求的标题可能由其他成员撰写）和模型选的路径，不经审阅就会进入之后 30 天的提示；而测试命令是用户自己保存的项目配置。
- 存储层自己校验策略晋升，不信任调用方：候选必须是 `coding_run` 的 `test_command`，语句等于按当前项目测试命令生成的模板，授权的 `actorId`、`policyId`、版本、`user_project`、`private`、`thirty_days`、`expiresAt = decidedAt + 30 天` 都是固定值，`authorityDigest` 由存储按固定键序重算。规则在 `apps/desktop/electron/coding-run-memory-policy.ts`，学习流程和存储共用。
- 已有有效记忆完全相同的语句，学习时不再保存为候选（轨迹记为 `duplicate`），否则这类永远不能晋升的候选会一直留在面板里，挤掉需要审阅的候选。
- 策略晋升的可见性：原计划用 `runtime` 可见性 + `thirty_days`，但按背景中的约束 2，这样的记忆跨运行召回不到，没有学习效果。因此改为 `user_project` + `private` + `thirty_days`：只对同一用户在同一本地项目可见，不进入 Team 摘要，30 天自动过期，可随时删除。这比原计划的范围更宽，2026-09-30 确认采用。
- 策略标识为 `desktop-coding-run-memory-policy` v1，审计照常记录 `promotion_actor_kind = 'policy'`。
- 忽略待审候选：本人可以在面板里忽略一条从未晋升的候选（二次确认）。v38 迁移新增 `agent_memory_candidate_dismissals`，只保存候选 id、范围、来源类型、`contentDigest`、`provenanceDigest`、操作人和时间，不保存语句。同一事务删除候选行。之后同一 id 或同一来源和内容的候选不会再被保存：`saveAgentMemoryCandidate` 返回 `dismissed`，学习轨迹记为 `dismissed`，Agent Runtime 带候选的新转换被拒绝；已提交的同一转换重放时，匹配的忽略记录代替候选行。已晋升的候选是记忆的来源，不能忽略，要不再召回应删除那条记忆。
- 删除记忆沿用 ADR 0018：写墓碑、清除索引与派生状态，之后不再召回、不再显示内容；修订历史中的语句仍保留在本地数据库中，用于审计和版本链，面板不再显示。

<a id="in-run-compaction"></a>

### 6. 运行中和会话级压缩

- Native v2 repair 调用增加：`initialChangeSet`（已应用的 initial 替换，有长度上限）和 `failureLocations`（从原始测试输出解析出的 `file:line`，只保留工作区内的规范相对路径）。可编辑文件的片段以首个失败位置为中心，而不是文件开头；片段不从第 1 行开始时带 `startLine`。不可编辑文件只附带短的只读片段（最多 3 个，失败行前后各 20 行，每个不超过 2,000 字符）。提示超限时依次去掉只读片段、`initialChangeSet` 正文（只保留路径）、`failureLocations`，最后才把可编辑片段截短到下限以下。单个可编辑片段上限 32 KB 已超过 30,000 字符的提示上限，所以每一级先把以失败行为中心的窗口缩到 4,000 字符的下限，仍超限才进入下一级。initial 提案的 `summary` 和分析摘要目前没有持久化，暂不附带。所有片段（包括 initial 阶段的搜索片段）都先对整个文件脱敏再截取，避免窗口边缘把多行私钥切成脱敏规则识别不了的片段；私钥块逐行替换为标记，保持行数，行号仍对得上。脱敏改变了行数时，可编辑片段不带 `startLine`，只读片段直接跳过。解析 `file:line` 时逐行匹配并限制路径长度，避免长串输出触发回溯；Windows 的盘符根目录（含 `file:///C:/`）会先去掉再匹配。
- 讨论栏超出预算时，较早的工具观察先降级为占位 `{sourceId, name, args, observedAt, degraded: true}`，可以用相同 `name` 和 `args` 重新查询，而不是整条丢弃。降级按从旧到新进行，最新一条真实工具结果（不是数组最后一项，恢复提示也会追加进来）保持完整，并写回本轮的观察数组，保证之后各步的前缀稳定。超限时的处理顺序是：先去掉本步的召回记忆，再降级工具结果，最后才丢弃较早的聊天历史。
- 滚动会话摘要、LLM 摘要和按提供方估算 token 的预算单位，等 V3.0 的会话账本与 `PromptSection` 压缩契约（`docs/plans/v3.x-agent-runtime-capability-roadmap.md`）建成后再做，避免两套压缩边界。

<a id="supersedes"></a>

## 与既有 ADR 的关系

- ADR 0021 中"这里消费的是明确提升/修订的记忆，不是每个 Coding Run 后自动学习"和"自动编码评估记录证据检查，不创建或提升持久记忆"两句，被第 4、5 节取代：已接受的 Coding Run 会产生候选，低风险候选可由策略晋升。
- ADR 0021 中"简报采用保守的 12,000 UTF-8 字节预算"更正为运行时实际使用的 24,000 字节（`CODING_BRIEF_MAX_BYTES`）。共享默认值 `CODING_CONTEXT_MAX_BYTES = 12_000` 只在未显式传入预算时生效。
- ADR 0021 中"不扩展阶段 Agent"的限制被第 3 节取代，专职/多 Agent 委托的限制仍然有效。
- ADR 0018 拒绝的"自动持久保存每次 Agent 观察"仍然拒绝。这里只从已完成且测试通过的运行中提取固定结构的事实，产物是候选，经去重和人工或受限策略才会生效。范围、版本链、墓碑和审计规则不变。

<a id="implementation-status"></a>

## 实施状态

| 部分 | 状态 |
| --- | --- |
| 第 1 节 前缀契约 | 已实现，有测试；Native v2 已用真实 DeepSeek 对比一次（见“影响”） |
| 第 2 节 BM25、最低分、查询扩展、单条上限常量 | 已实现，有单元测试 |
| 第 2 节 常驻记忆 | 不做，由 ADR 0025 L0 项目说明承担 |
| 第 3 节 阶段 Agent 注入 | 已实现，有测试 |
| 第 3 节 讨论栏注入 | 已实现，有测试。每轮开始时召回一次；召回失败或超出上下文预算时本轮不带记忆 |
| 第 3 节 协调器重试读取已持久化附件 | 已实现，有测试 |
| 第 3 节 协调器召回记忆 | 推迟，见第 3 节原因 |
| 第 4 节 模板与去重判定（共享纯函数） | 已实现，有单元测试 |
| 第 4 节 `coding_run` 来源、v37 迁移、存储校验、完成时生成候选（Native、OpenCode） | 已实现，有测试；只用模拟模型验证 |
| 第 4 节 项目范围的记忆面板与生命周期 IPC | 已实现，有测试 |
| 第 5 节 人工晋升与修订前去重、策略晋升（仅 `test_command`，存储层校验） | 已实现，有测试 |
| 第 5 节 忽略待审候选（v38 迁移、存储、IPC、面板） | 已实现，有测试；打包冒烟校验已晋升候选不能忽略 |
| 第 6 节 `file:line` 解析（共享纯函数） | 已实现，有单元测试 |
| 第 6 节 repair 上下文接入执行器 | 已实现，有测试（`buildNativeCodingV2RepairPrompt`）；真实 DeepSeek 触发一次，修复后测试通过 |
| 第 6 节 工具结果占位 | 已实现，有测试。本轮 42,000 字符观察上限和 30,000 字符提示上限都先降级再丢弃 |
| 第 6 节 滚动摘要、token 预算单位 | 推迟到 V3.0 |

<a id="consequences"></a>

## 影响

- 不相关的记忆不再占用简报预算。代价是查询词和记忆没有共同词元时不会召回，即使语义相关。仍然不使用嵌入。
- 阶段 Agent 和讨论栏的提示会包含记忆语句。它们与编码简报一样只保存在本地，不进入 Team 摘要。
- 每条记忆的可召回上限统一为 3,800 字节，界面和修订都应按这个上限提示。
- 确定性测试只保证前缀结构。2026-09-30 用 `deepseek-flash` 做了一次真实对比（[证据](../engineering/evidence/prompt-cache-live-20260930.json)），同一套 `memory-context-live` 三个场景各跑一次，只替换执行器：
  - 前缀契约之前（`f0fad85` 的执行器）：6 次调用，输入 6,062 token，缓存命中 768（12.7%），未命中 5,294；initial 阶段命中率 14.0%。
  - 前缀契约之后：6 次调用，输入 9,318 token，缓存命中 4,992（53.6%），未命中 4,326；initial 阶段命中率 72.7%。
  - 合并后的 system prompt 带全部阶段规则，每次调用的输入平均多约 540 token，但未命中的输入少了 18%，输入费用从 USD 0.0015928 降到 0.0013278。两次运行的 6 个场景都在首次测试就通过，输出正确。
  - 局限：各只跑一次，DeepSeek 缓存是尽力而为；这里压缩后的简报约 2 KB，实际项目的简报最大 24,000 字节，可缓存的前缀更长；讨论栏和阶段 Agent 的记忆注入不在这个验证范围内。
- 同日另用 `test:native-repair-live` 真实触发了一次 repair（[证据](../engineering/evidence/native-repair-live-20260930.json)）：准确措辞只写在 Native v2 清单跳过的 `build/` 测试里，initial 猜错、测试失败；repair 调用收到 2 个 `failureLocations`、测试文件的只读片段和 1 条已应用替换，第二次批准后测试通过。三次调用共用同一个 system prompt，repair 阶段缓存命中率 55.7%，全程 58.2%，费用 USD 0.0014045。夹具文件短于片段窗口，所以可编辑片段从第 1 行开始；以失败行为中心取片段由单元测试覆盖。
