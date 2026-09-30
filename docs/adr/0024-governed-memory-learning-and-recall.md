<a id="adr-0024-governed-memory-learning-and-recall"></a>

# ADR 0024：受治理的记忆学习、召回与缓存友好上下文

状态：提议（Proposed）。第 5 节的策略晋升可见性需要确认后才能改为已接受。

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
- 设最低相关度：至少命中一个非停用词查询词元。零命中的记忆不再进入简报，计入 `omittedMemoryCount`。
- 编码召回的查询词加入节点标题、节点说明，以及已批准澄清/方案产物的标题和摘要，不再只用 `run.request + userInstruction`。
- 预算保持：编码简报最多 8 条、4,000 字节（每条另计 200 字节标签预留）。讨论栏最多 4 条、2,000 字节。阶段 Agent 最多 6 条、3,000 字节。统一的单条可召回上限是 `AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES = 3_800`。新来源的候选（第 4 节）必须满足该上限；已存在的更大记忆仍可人工修订缩短，召回时计为已省略。
- 常驻记忆（每次都带的项目约定，类似 CLAUDE.md）需要在修订上新增 `recall: 'resident' | 'on_demand'` 字段，涉及共享解析器、SQLite 检查和版本迁移，放到第 4 节的迁移里一起做。在此之前全部按需召回。

<a id="injection"></a>

### 3. 注入范围

- 阶段 Agent 和讨论栏把召回的记忆作为低信任背景，与编码简报的规则相同：不能授权，不能覆盖当前请求、原始需求或已批准产物，不算 Gate 或仓库证据，冲突时以当前请求为准。
- 范围沿用 ADR 0018 的交集规则。阶段 Agent 使用 `resolveTrustedWorkflowActor` 得到的用户。讨论栏在已配对到该本地项目时使用配对用户；未配对时使用本轮开始时已附加需求的 Run 创建者；两者都没有时本轮不召回。
- 这两处在每次调用时重新召回，不持久化附件，所以删除和过期对下一次调用立即生效。它们不产出受回执保护的执行，不增加 `CodingContextReceipt` 式的变化检查。
- 多 Agent 协调器暂不接入。它的 `expectedContext` 重放校验要求在 `attachedAt` 时刻完全重建相同来源；接入前需要先改为读取已持久化的附件，否则任何记忆变化都会让重试报 `conflicting_context`。

<a id="learning"></a>

### 4. 从已接受的 Coding Run 提取候选

- 触发点：Coding Run 进入 `completed`，并且最新规范测试证据为 `passed`（Native 在 `settleCompletedExecutorResult`，OpenCode 在 Change Acceptance 之后）。与 `recordCodingEvaluation` 同一位置。
- 内容：只用可观察事实和确定性模板，不调用模型。当前模板有三类：
  - `test_command`：已验证的项目测试命令。
  - `change_map`：需求/节点标题到改动路径的对应。
  - `repair_pattern`：初次测试失败（含解析出的 `file:line`），经修复后通过，以及修复涉及的路径。
- 每条语句不超过可召回上限，必须满足 `redactSensitiveText` 不改变原文（与现有候选规则一致）。模板实现在 `packages/shared/src/memory-learning.ts`。
- 以后如果改由模型提取，只允许白名单结构（约定、命令、坑、文件地图），产物仍是候选。
- 持久化需要新的候选来源类型 `provenance.kind = 'coding_run'`，内容为 `runId`、`codingRunId`、`testEvidenceId`、`diffArtifactId` 和结果摘要。需要一次迁移：按 v25 的 `legacy_alter_table` 模式重建 `agent_memory_candidates`，新增 `provenance_kind` 列，把运行时相关列改为按来源类型条件必填。还需要 `saveAgentMemoryCandidate` 的第二个校验分支（Coding Run 存在、已完成、测试证据通过、范围等于 `contextReceipt.scope`），以及生命周期投影和晋升 IPC 改为不依赖 `runtimeId` 定位候选。

<a id="promotion"></a>

### 5. 晋升：去重与策略晋升

- 去重：晋升和修订前，先规范化语句（NFKC、小写、合并空白、去掉末尾标点）并与同范围内的活动记忆比较。规范化后相同的，拒绝晋升，并指向已有记忆。词元 Jaccard 相似度不低于 0.8 的，建议修订那条记忆，复用 `supersedes` 版本链，而不是新建。判定函数在 `memory-learning.ts`。
- 策略晋升（`actorKind: 'policy'`）只用于 `coding_run` 来源中的 `test_command` 和 `change_map`，并且要求没有去重命中。`repair_pattern` 和所有 Agent Runtime 来源仍需人工晋升。
- 策略晋升的可见性：原计划用 `runtime` 可见性 + `thirty_days`，但按背景中的约束 2，这样的记忆跨运行召回不到，没有学习效果。本 ADR 提议改为 `user_project` + `private` + `thirty_days`：只对同一用户在同一本地项目可见，30 天自动过期，可随时删除。这比原计划的范围更宽，需要确认后才能实现。
- 策略标识为 `desktop-coding-run-memory-policy` v1，审计照常记录 `promotion_actor_kind = 'policy'`。

<a id="in-run-compaction"></a>

### 6. 运行中和会话级压缩

- Native v2 repair 调用增加：`initialChangeSet`（已应用的 initial 替换，有长度上限）和 `failureLocations`（从原始测试输出解析出的 `file:line`，只保留工作区内的规范相对路径）。可编辑文件的片段以首个失败位置为中心，而不是文件开头；片段不从第 1 行开始时带 `startLine`。不可编辑文件只附带短的只读片段（最多 3 个，失败行前后各 20 行，每个不超过 2,000 字符）。提示超限时依次去掉只读片段、`initialChangeSet` 正文（只保留路径）、`failureLocations`，最后才把可编辑片段截短到下限以下。单个可编辑片段上限 32 KB 已超过 30,000 字符的提示上限，所以每一级先把以失败行为中心的窗口缩到 4,000 字符的下限，仍超限才进入下一级。initial 提案的 `summary` 和分析摘要目前没有持久化，暂不附带。
- 讨论栏超出预算时，较早的工具观察先降级为占位 `{sourceId, name, args, observedAt, degraded: true}`，可以用相同 `name` 和 `args` 重新查询，而不是整条丢弃。降级按从旧到新进行，最新一条保持完整，并写回本轮的观察数组，保证之后各步的前缀稳定。降级优先于丢弃较早的聊天历史。
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
| 第 1 节 前缀契约 | 已实现，有测试 |
| 第 2 节 BM25、最低分、查询扩展、单条上限常量 | 已实现，有单元测试 |
| 第 2 节 常驻记忆 | 待第 4 节迁移 |
| 第 3 节 阶段 Agent 注入 | 已实现，有测试 |
| 第 3 节 讨论栏注入 | 已实现，有测试。每轮开始时召回一次；召回失败或超出上下文预算时本轮不带记忆 |
| 第 3 节 协调器 | 未做，见第 3 节原因 |
| 第 4 节 模板与去重判定（共享纯函数） | 已实现，有单元测试 |
| 第 4 节 `coding_run` 来源、迁移、存储校验、UI | 未做 |
| 第 5 节 去重接入晋升、策略晋升 | 未做，策略可见性待确认 |
| 第 6 节 `file:line` 解析（共享纯函数） | 已实现，有单元测试 |
| 第 6 节 repair 上下文接入执行器 | 已实现，有测试（`buildNativeCodingV2RepairPrompt`） |
| 第 6 节 工具结果占位 | 未做 |
| 第 6 节 滚动摘要、token 预算单位 | 推迟到 V3.0 |

<a id="consequences"></a>

## 影响

- 不相关的记忆不再占用简报预算。代价是查询词和记忆没有共同词元时不会召回，即使语义相关。仍然不使用嵌入。
- 阶段 Agent 和讨论栏的提示会包含记忆语句。它们与编码简报一样只保存在本地，不进入 Team 摘要。
- 每条记忆的可召回上限统一为 3,800 字节，界面和修订都应按这个上限提示。
- 缓存命中率的真实提升、合并 system prompt 后的输出质量，都需要用付费的真实调用验证，确定性测试只保证前缀结构。
