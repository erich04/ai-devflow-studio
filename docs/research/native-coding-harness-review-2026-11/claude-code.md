# Claude Code 的 harness 机制：教程 20 个方面与 13 个补充方面

> 调研时间 2026-10 下旬，只读。资料限于 learn.shareai.run 教程及其源码分析、Claude Code 官方文档和 Anthropic 工程博客；没有检索或引用泄露、反编译的 Claude Code 源码，也没有读取 DevFlow 仓库。标"据 learn.shareai.run 的源码分析"的内容只出自该教程，教程没有注明所分析的 Claude Code 版本（未核实）。官方文档页面没有发布日期，内容以 2026-10 下旬抓取为准，版本号与日期取自官方 changelog [D34]。S 编号沿用 `.tmp/research/multi-agent/` 下 landscape.md 与 mechanics.md（本文用到 S1、S2、S3、S5、S105、S106），其余编号见文末。全文为转述，没有大段引用原文。

## 一句话结论

Claude Code 的内核仍是"响应里有 tool_use 块就执行并回填，没有就停"的单循环，它的生产强度来自循环外的确定性层：按每次调用判定并发与权限的工具管线、OS 沙箱加分类器的审批、由便宜到昂贵的上下文压缩与按稳定度分层的提示缓存、可恢复的会话与文件检查点，以及把"做完没有"交给独立评估器或 Stop hook。2025-2026 年的主要变化：auto 成为交互会话的默认权限模式（v2.1.283 起覆盖所有计划与提供方，2026-09-25）、MCP 工具默认延迟加载、Glob/Grep 并入 Bash（2026-04）、新模型默认不再提供 TodoWrite/Task 工具（2026-08 起），并新增 agent teams、worktree 隔离、`/loop`、`/goal`、dynamic workflows 和 AGENTS.md 读取 [D2][D18][S105][D34]。

## 五个关注点与总体结构

- 教程把 20 章归入五个正交关注点 [L0]：L1 Tools & Execution（s01-s04：循环、工具分发、权限、hooks）；L2 Planning & Control（s05、s06、s07、s10、s11：TodoWrite、子 Agent、技能、系统提示组装、错误恢复）；L3 Memory Management（s08、s09：压缩、记忆）；L4 Concurrency & Scheduling（s13、s14：后台任务、cron）；L5 Multi-Agent Platform（s12、s15-s20：任务图、团队、协议、自治认领、worktree、MCP、综合）。
- 每章只在 s01 的 `while True` 外加一种机制，循环本身不变 [L1][L20]。s20 的组装顺序：用户输入 → UserPromptSubmit hooks → 注入 cron 与后台通知 → 压缩管线（落盘 → 裁剪 → 占位 → 摘要）→ 用技能目录、MEMORY.md、MCP 状态组装系统提示 → 调模型（外包退避、max_tokens 升级、应急压缩）→ 有 tool_use 则过 PreToolUse hook 与权限 → 内置、MCP 或后台分发 → PostToolUse → 回填 tool_result 或 task_notification；没有 tool_use 则跑 Stop hooks 后返回 [L20]。
- s20 正文列出 27 个内置工具；todo_write 让单个 Agent 不漂移，任务图支撑团队；`task` 是一次性子 Agent，`spawn_teammate` 是长期队友 [L20]。
- 配套仓库 main 已改为 17 课：团队、协议、自治认领、worktree 合并成 s13，新增 s15 集成 harness、s16 Workflow Runtime（脚本编排加 journal 续跑）、s17 Goal Loop（独立判断器决定能否停）[L21][L22][L23]。站点仍是 20 章，本文按站点组织，在 S20、E9 引用新增两章。
- 官方说法一致：循环分收集上下文、行动、验证三个阶段；Claude Code 就是模型外层"提供工具、管理上下文"的 harness，skills、MCP、hooks、子 Agent 都叠在核心循环上；终端、IDE、云端、CI 和 SDK 跑的是同一个循环 [D1][D11][D12]。

## 逐项（S01-S20）

### S01 Agent Loop
- 问题与教学版：模型只能输出命令，要有循环把结果喂回去；教学版约 30 行 `while True`，按 `stop_reason == "tool_use"` 继续，唯一出口是不再调工具 [L1]。
- 生产版（据 learn.shareai.run 的源码分析）：`src/query.ts` 1729 行；流式下 stop_reason 不可靠，改用收到 tool_use 块就置位的 `needsFollowUp`；State 有 10 个字段（messages、toolUseContext、autoCompactTracking、maxOutputTokensRecoveryCount 上限 3、hasAttemptedReactiveCompact、maxOutputTokensOverride、pendingToolUseSummary、stopHookActive、turnCount、transition）；出口覆盖 blocking limit、prompt too long、abort、hook stop、max turns、token budget 续跑；StreamingToolExecutor 在模型还在生成时启动工具；QueryEngine 另管费用超限与结构化输出校验 [L1]。
- 生产版（官方）：SDK 每次运行以 ResultMessage 结束，subtype 为 success、error_max_turns、error_max_budget_usd、error_during_execution、error_max_structured_output_retries，都带 total_cost_usd、usage、num_turns、session_id；maxTurns 与 maxBudgetUsd 默认不限 [D12]。
- 理由：核心保持可读，复杂度集中在带计数器的出口与恢复路径上，每条路径都能单独测试 [L1]。

### S02 Tool Use
- 问题与教学版：工具 schema 与处理函数注册进分发表，加工具不改循环；教学版 5 个工具，`TOOL_HANDLERS` 查表，按原顺序串行，文件工具用 `safe_path` [L2]。
- 生产版（据 learn.shareai.run 的源码分析）：每个工具是 `buildTool()` 对象（schema、校验、权限、执行）；`isConcurrencySafe(input)` 按具体输入判定（只读 Bash 可并发，`rm` 不行，TaskCreate 写不同文件所以可并发）；`partitionToolCalls()`（toolOrchestration.ts:91-115）把调用切成连续批次，批内并发、批间串行，并发上限默认 10（`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`）[L2][L13]；每次调用依次过 Zod 校验、`validateInput()`、PreToolUse hooks、权限、`tool.call()`；结果超过工具的 `maxResultSizeChars` 就落盘，只给预览和路径，FileRead 设为 Infinity，避免"读落盘文件又落盘"的死循环 [L2]。
- 生产版（官方）：SDK 中只读工具（Read、Glob、Grep、标 readOnly 的 MCP 工具）并发，Edit、Write、Bash 串行，自定义工具默认串行，设 `readOnlyHint` 才并行 [D12]；`PostToolBatch` hook 在一批并行调用全部结束、下一次模型调用之前触发 [D13]；工具参考表列出 40 多个内置工具，包括 Monitor、ToolSearch、Workflow、SendMessage、LSP [S105]。
- 理由：按输入而不是按工具判定并发，探索类读操作能并行，写操作又不会互踩；输出上限挂在工具定义上，溢出处理统一 [L2]。

### S03 Permission
- 问题与教学版：安全不能靠信任模型，要在执行前判定；教学版三道闸门：硬拒绝表 → 规则匹配 → 用户确认 [L3]。
- 生产版（据 learn.shareai.run 的源码分析）：PermissionResult 有 allow、deny、ask、passthrough 四种；`hasPermissionsToUseToolInner()`（permissions.ts:1158-1310）依次查整工具 deny、整工具 ask、工具自己的 `checkPermissions()`、需用户交互、内容级 ask 与安全检查（这两项不可绕过）、bypass 模式、allow，passthrough 最后转为 ask；规则来自 user、project、local、flag、policy、cliArg、command、session 8 个来源；`isDestructive()` 只用于 UI 标签；fork 子 Agent 的 `permissionMode: 'bubble'` 把弹窗冒泡到父终端；auto 模式先模拟 acceptEdits、再查安全白名单，最后才调分类器 [L3]。
- 生产版（官方）：模式有 default（Manual）、acceptEdits、plan、auto、dontAsk、bypassPermissions；规则写作 `Tool(specifier)`，按 deny → ask → allow 取首个命中，具体程度不改变顺序，任一作用域的 deny 都压过 allow [D3]；Bash 规则识别 `&& || ; | |& &` 与换行，复合命令每个子命令都要放行，`timeout`、`nice`、`nohup` 等包装先剥掉再匹配 [D3]；critical-path `rm`、AskUserQuestion、显式 ask 规则在任何模式都不自动批准（只有 bypassPermissions 可关掉危险 `rm` 提示）；auto 模式下分类器连续 3 次或累计 20 次拦截就退回人工审批，阈值不可配 [D2]。
- 理由与变化：遥测显示用户批准约 93% 的提示，审批疲劳让逐条把关失效，因此加沙箱和分类器 [A1][A3]；auto 模式约 2026-03 上线，v2.1.283（2026-09-25）起成为所有计划与提供方交互会话的默认起始模式 [A1][D2][D34]。

### S04 Hooks
- 问题与教学版：日志、审批、自动提交等横切逻辑挂在事件上，不写进循环；教学版 4 个事件（UserPromptSubmit、PreToolUse、PostToolUse、Stop），回调返回非 None 即阻止或续跑 [L4]。
- 生产版（据 learn.shareai.run 的源码分析）：27 个事件（coreTypes.ts:25-53），HookResult 14 个字段（blockingError、permissionBehavior、updatedInput、additionalContext、preventContinuation 等）；关键不变式是 hook 返回 allow 仍要过 settings 的 deny/ask（toolHooks.ts:325-331）；`stopHookActive` 防止"Stop hook 报错 → 模型自纠 → 再报错"的死循环；PostToolUse 的 preventContinuation 让循环正常退出 [L4]。
- 生产版（官方）：现为 33 个事件，新增 PostToolBatch、PermissionDenied、PreModelSwitch/PostModelSwitch、DirectoryAdded、MessageDisplay、UserPromptExpansion 等；处理器有 command、HTTP、MCP 工具、prompt、agent 五类，插件 mod 还能注册进程内 JS 函数 [D13]；退出码 0 成功、2 阻断、其他为非阻断错误；Stop/SubagentStop 连续续跑 8 次后强制结束（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`）[D13][D30]；PreToolUse 的 allow 不能越过 deny/ask 规则 [D3]。
- 理由与变化：hooks 于 2025-06-30（v1.0.38）发布 [D34]；项目 `.claude/settings.json` 里的 hook 曾在信任对话框之前执行，被报告为漏洞后改为信任之后才解析 [A3]。

### S05 TodoWrite
- 问题与教学版：长任务里最初目标会被工具结果挤出注意力，要先列计划；教学版 `todo_write` 把列表存在内存，连续 3 轮不更新就注入 `<reminder>` [L5]。
- 生产版（据 learn.shareai.run 的源码分析）：TodoWrite（V1，存 AppState）与 Task System（V2）并存，由 `isTodoV2Enabled()` 切换；todo 有 `activeForm` 字段给 spinner；没有固定"3 轮"提醒，最接近的是 3 个以上 todo 全部完成却没有验证项时追加 verification nudge（TodoWriteTool.ts:72-107）[L5]。
- 生产版（官方）：v2.1.268 起任务跟踪工具默认只在 Opus 4.7、Sonnet 4.6、Haiku 4.5 及更早模型上提供，因为新模型不靠清单也能跟踪多步工作，而工具定义与提醒占上下文；`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` 可打开；有任务工具时默认给 TaskCreate/Get/Update/List，TodoWrite 仅在 `CLAUDE_CODE_ENABLE_TASKS=0` 时出现；后台与云端会话始终提供 [S105]；v2.1.233（2026-08-14）首次在新模型上移除 [D34]。
- 理由：计划工具不增加执行能力，只增加规划能力 [L5]；官方按模型能力开关，而不是一律提供 [S105]。

### S06 Subagent
- 问题与教学版：子任务用干净的 messages[]，只回传结论；教学版 `task` 工具开新循环，30 轮安全上限，子 Agent 没有 task 工具以防递归，工具调用仍过 PreToolUse hook [L6]。
- 生产版（据 learn.shareai.run 的源码分析）：三种执行方式（指定类型的 normal、fork、general-purpose）；fork 用 `buildForkedMessages()` 构造与父对话一致的前缀以命中 prompt cache，system prompt、tools、model、消息前缀、thinking 配置五项须字节级一致；`createSubagentContext()` 克隆 readFileState、新建子 AbortController、depth 加 1；`isInForkChild()` 防止 fork 递归；`run_in_background` 异步启动并以通知回报 [L6]。
- 生产版（官方）：默认最多嵌套 3 层（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`），同时最多运行 20 个，超出时报错并告诉模型不要重试，会话内总数不限；交互会话默认开 fork 模式，子 Agent 默认后台运行且工具集更小；maxTurns 到限返回标为 partial 的结果，可 resume；后台子 Agent 的权限请求在主会话弹出并注明来源 [S1]；SDK 的 maxBudgetUsd 到限后拒绝新子 Agent 并停掉后台子 Agent [S5][D12]。
- 理由：子 Agent 换来的是并行和"没看过实现的眼睛"，代价是 token 和重新收集上下文的时间，并不会更聪明 [D32]。

### S07 Skill Loading
- 问题与教学版：规范文档按需加载，不常驻系统提示；教学版两层：启动时把技能目录（每个约 100 token）放进系统提示，`load_skill` 以 tool_result 注入全文（每个约 2000 token），只按注册表名查找，避免路径穿越 [L7]。
- 生产版（据 learn.shareai.run 的源码分析）：来源有 managed、user、project、`--add-dir`、旧 commands、动态、按 `paths` 条件激活、内置、插件、MCP；目录预算约为上下文窗口的 1%，上限 8000 字符；Skill 工具的 tool_result 只显示"Launching skill"，正文经 newMessages 注入；frontmatter 有 when_to_use、allowed-tools、context（inline 或 fork）、model、hooks、paths [L7]。
- 生产版（官方）：description 与 when_to_use 合计在目录中截断到 1,536 字符；`disable-model-invocation: true` 让模型看不到描述；`context: fork` 在子 Agent 中运行，默认后台；描述里的尖括号被转义，不能冒充内部格式 [D19]；压缩后重新注入已调用技能的正文，每个上限 5,000 token、合计 25,000 token，最旧的先丢 [D8]；skills 于 2025-10-16（v2.0.20）上线 [D34]。
- 理由：渐进披露，不用的知识不花 token；按需加载与压缩互补，一个管"不该带的不带"，一个管"该丢的怎么丢" [L7]。

### S08 Context Compact
- 问题与教学版：上下文必然会满，按"便宜的先跑、贵的后跑"腾空间；教学版依次做：单条 user 消息的 tool_result 合计超 200KB 时从大到小落盘、留 2000 字符预览 → 消息超 50 条时保留头 3 尾 47、不拆 tool_use/tool_result 对 → 只保留最近 3 条完整工具结果 → LLM 摘要并把 transcript 存 JSONL；摘要连续失败 3 次熔断，prompt_too_long 时应急压缩 1 次 [L8]。
- 生产版（据 learn.shareai.run 的源码分析）：query.ts 里顺序为 applyToolResultBudget → snipCompact → microcompact → contextCollapse → autoCompact；阈值为 contextWindow − maxOutputTokens − 13,000；摘要输出上限 20,000 token；压缩后恢复最多 5 个最近文件、每个 5,000 token、合计 50,000 token，并重新附加计划和 agent/skill/tool 上下文；microcompact 分按时间（60 分钟）和 cache_edits 两条路径；重复读取未变文件返回 FILE_UNCHANGED_STUB；摘要 prompt 首尾两次要求只输出文本、不调工具，先写 `<analysis>` 再写 `<summary>`，analysis 在格式化时剥掉 [L8]。
- 生产版（官方）：默认在接近模型上限时自动压缩，原生 1M 窗口的模型约在 967K 触发，`/autocompact` 可设 100K–1M；单个大输出导致压缩后立刻又满时，几次尝试后停止并报错 [D1][D9]；压缩后重注入根 CLAUDE.md、auto memory、计划和技能描述，paths 规则按需重载，重读最多 5 个最近文件，超过 5,000 token 的只给路径 [D8]；v2.1.198 起摘要请求继承 thinking 配置；v2.1.290 起处于 1 小时缓存 TTL 的大会话（默认 ≥200K token）空闲时可被压缩 [D8][D7][D34]。
- 理由：上下文越长召回越差（context rot），是边际收益递减的资源；压缩保留架构决策、未解决 bug 与实现细节，丢冗余工具输出，并带上最近访问的 5 个文件 [A5]。

### S09 Memory
- 问题与教学版：压缩有损且不跨会话，需要一层不参与压缩的存储；教学版在 `.memory/` 下每条记忆一个带 frontmatter 的 md，分 user/feedback/project/reference 四类，MEMORY.md 索引常驻系统提示，每轮用一次 side-query 选最多 5 条相关记忆注入，失败降级为关键词匹配；每轮结束提取，文件数到 10 时整理 [L9]。
- 生产版（据 learn.shareai.run 的源码分析）：扫描最多 200 个文件按 mtime 排序，用 Sonnet side-query 选最多 5 个，每个文件不超过 200 行或 4096 字节，单会话注入预算 60KB，预取异步不阻塞；提取在 stop hook 里 fire-and-forget，由权限受限的 forked agent 执行（maxTurns 5、skipTranscript）；"Dream"整理有四道门：距上次 ≥24 小时、扫描节流、≥5 个会话有改动、`.consolidate-lock` 锁（1 小时过期）；session memory 足够（≥10K token、≥5 条消息、≤40K token）时直接用它做压缩摘要，不调 LLM；MEMORY.md 上限 200 行或 25KB（memdir.ts:34-38）[L9]。
- 生产版（官方）：auto memory 存于 `~/.claude/projects/<project>/memory/`，同一仓库的 worktree 共享（v2.1.63，2026-02-28）；每次会话只加载 MEMORY.md 前 200 行或 25KB，主题文件由 Claude 用文件工具按需读取；不记能从代码或 git 推出的内容；写入时自动加 `modified` 时间戳，超限时报错要求重写索引；子 Agent 可用 `memory` 字段维护独立记忆 [D14][D34]。官方文档没有提到 side-query 选择，两者是否并存未核实。
- 理由：索引常驻可被缓存，正文按需注入不破坏缓存 [L9]；持久记忆也是注入的持久化落点，需要在会话启动时检查 [A3]。

### S10 System Prompt
- 问题与教学版：系统提示应按运行状态组装；教学版拆成 identity、tools、workspace、memory 四段，按真实状态决定是否加载，并以 `json.dumps(context)` 作缓存键避免重复拼接 [L10]。
- 生产版（据 learn.shareai.run 的源码分析）：`getSystemPrompt()` 返回 string[]，`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 分开静态段（identity、doing_tasks、using_tools 等）与动态段（memory、env_info、mcp_instructions 等），静态段合成全局缓存块；mcp_instructions 是唯一易变段；CLAUDE.md 与日期作为 `<system-reminder>` 用户消息前置，git status 追加到系统提示；标准交互模式核心约 20-30KB，`CLAUDE_CODE_SIMPLE` 约 150 字符；coordinator、proactive、agent 模式会替换或追加 [L10]。
- 生产版（官方）：请求按"系统提示与工具定义 → 项目上下文（CLAUDE.md、auto memory、无作用域规则）→ 对话"排列，plan mode 与技能说明作为对话消息追加，不动前缀 [D7]；Claude Code 还以 system reminder 注入 CLAUDE.md、输出风格、文件被外部修改的提示和提交署名 [D1]；SDK 默认用极简提示，`claude_code` preset 才是 CLI 的完整提示，可加 `append` [D26]。
- 理由：稳定内容在前、易变内容在后，缓存命中最大化；段落取舍看真实状态，不看消息里的关键词 [L10][D7]。

### S11 Error Recovery
- 问题与教学版：截断、超长、限流是常态，要按错误类型恢复；教学版三条路径：max_tokens 先从 8K 升到 64K 原样重发，仍截断再续写最多 3 次；prompt_too_long 应急压缩 1 次；429/529 指数退避加抖动，连续 3 次 529 切备用模型 [L11]。
- 生产版（据 learn.shareai.run 的源码分析）：每轮判断十几种 transition（next_turn、max_output_tokens_escalate/recovery、reactive_compact_retry、collapse_drain_retry、image_error、aborted_streaming、stop_hook_blocking、token_budget_continuation、max_turns 等）；退避为 `min(500×2^(attempt-1), 32000)` 毫秒加 0-25% 抖动，优先用 Retry-After（withRetry.ts:530-548）；续写提示要求不道歉、不复述、从断点接着写，并把剩余工作拆小；流式中可恢复错误先扣住，不让 SDK 看到；token budget 续跑连续 3 次增量不足 500 token 就判定收益递减而停止 [L11]。
- 生产版（官方）：瞬时错误最多重试 10 次（上限 15；设 `CLAUDE_CODE_RETRY_WATCHDOG` 后 429/529 可无限重试，其他默认 300 次）；输入加 max_tokens 超限时降低 max_tokens 重试，降不下去再压缩；模型声称调工具却没有工具块时最多补问 2 次；已完成文本块或工具调用后才断流的不重发，以免同一工具执行两次，改为保留已完成部分继续 [D22]；`--fallback-model`/`fallbackModel` 可配最多 3 个模型的回退链，只对当前轮生效，认证、计费、限流错误不触发 [D9]；`-p` 输出 `system/api_retry` 事件，API 错误结束的轮次触发 StopFailure hook [D11][D13]。
- 理由：区分"可安全重放"与"已有副作用"的失败点，才能避免重复执行工具 [D22]。

### S12 Task System
- 问题与教学版：持久化、带依赖的任务图，跨会话可恢复，是多 Agent 协作的基础；教学版 `.tasks/{id}.json`，`blockedBy` 全部完成才可认领，claim 写 owner 并转 in_progress，complete 后扫描解锁下游，没有环检测 [L12]。
- 生产版（据 learn.shareai.run 的源码分析）：TaskRecord 9 个字段（id、subject、description、activeForm、owner、status、blocks、blockedBy、metadata），存 `~/.claude/tasks/{taskListId}/{id}.json`；`claimTask()`（utils/tasks.ts:541-612）在 proper-lockfile 锁内重读，查已被认领、已完成、上游未完成后只写 owner（最多重试 30 次，5-100ms 退避）；`claimTaskWithBusyCheck()` 用列表级锁把"该 Agent 是否已有任务"与认领合成原子操作；`.highwatermark` 防 ID 复用；四个工具都是 isConcurrencySafe 且 shouldDefer；依赖由 TaskUpdate 的 addBlocks/addBlockedBy 维护；队友终止时未完成任务被清 owner 并重置为 pending [L12][L17]。
- 生产版（官方）：TaskCreated、TaskCompleted hook 以退出码 2 拦截，可当质量门 [D13][S2]；任务工具的提供范围随模型变化（见 S05）[S105]。
- 理由：任务管理与错误恢复是独立层，utils/tasks.ts 只做 CRUD [L12]。

### S13 Background Tasks
- 问题与教学版：慢命令不该让 Agent 空等；教学版放进 daemon 线程，先回带 bg_id 的占位 tool_result，完成后以 `<task_notification>` 文本块并入下一条 user 消息，不复用原 tool_use_id [L13]。
- 生产版（据 learn.shareai.run 的源码分析）：单线程事件循环，"后台"就是不 await，输出重定向到文件；7 种后台任务（local_bash、local_agent、remote_agent、in_process_teammate、local_workflow、monitor_mcp、dream）；完成通知进命令队列，优先级 next 高于 later，后台默认 later；后台 bash 看门狗在输出 45 秒不增长时检查 `(y/n)` 类交互提示；每批工具结束后用 Haiku 生成约 30 字符的过去时摘要供移动端显示进度 [L13]。
- 生产版（官方）：模型用 `run_in_background` 显式请求；前台命令默认超时 2 分钟、上限 10 分钟，超时不杀而是转后台（`sleep` 开头的除外）；无人值守会话中后台命令默认 30 分钟、最多 2 小时，`-p` 文本输入时为 10 分钟；输出流式写文件，超过 5GB 杀掉；v2.1.277 删除 TaskOutput 工具，改用 Read 读输出文件 [S105]；系统内存吃紧且会话空闲 30 分钟以上时回收后台任务 [D6]；主对话里运行超过 2 分钟的 MCP 调用自动转后台 [D18]；Monitor 工具（v2.1.98，2026-04-09）把后台输出逐行喂回模型 [S105][D34]。
- 理由：一个 tool_use 只对应一个 tool_result，后台完成是独立事件，通知不能冒用原 ID [L13]。

### S14 Cron Scheduler
- 问题与教学版：周期性工作应由 harness 产生，不靠模型记住；教学版独立调度线程每秒检查，按"日期+分钟"去重，命中入队，Agent 空闲时由 queue processor 交付；durable 任务写 `.scheduled_tasks.json`，进程退出调度即停 [L14]。
- 生产版（据 learn.shareai.run 的源码分析）：CronCreate、CronDelete、CronList 受编译期与运行时开关控制；`.scheduled_tasks.lock` 防同项目多会话重复触发，chokidar 监视文件变更；重复任务最多延迟周期的 10%（上限 15 分钟），落在 :00/:30 的一次性任务最多提前 90 秒；7 天过期（可配，上限 30 天）；MAX_JOBS=50（CronCreateTool.ts:25）；以 priority later 入队并标 WORKLOAD_CRON，容量紧张时降级服务 [L14]。
- 生产版（官方）：`/loop`（v2.1.71，2026-03-07）与 cron 工具都是会话级，每会话最多 50 个任务、8 字符 ID；只在会话空闲、轮次之间触发，不补跑错过的次数，resume 时恢复未过期任务；现行抖动为"最多为到下次运行间隔的一半、上限 30 分钟"，`*/5` 例外，与教程描述的版本不同；重复任务 7 天后最后触发一次并删除；脱离会话的定时用云端任务（最小间隔 1 小时）或桌面任务 [D20][D34]。
- 理由：抖动避免大量会话同时请求 API；7 天过期限定被遗忘的循环最多跑多久 [D20]。

### S15 Agent Teams
- 问题与教学版：一个上下文装不下大任务，需要能通信的长期队友；教学版 MessageBus 用 `.jsonl` 收件箱（追加写、读后删除，有竞态），队友跑在 daemon 线程，最多 10 轮，完成后向 Lead 汇报 [L15]。
- 生产版（据 learn.shareai.run 的源码分析）：没有中央总线，每个 Agent 直接写对方的 `~/.claude/teams/{team}/inboxes/{agent}.json`，读-追加-写回在 proper-lockfile 下进行（最多重试 10 次）；Lead 的 `useInboxPoller` 每 1 秒检查，有消息就提交为新一轮；权限请求经邮箱冒泡给 Lead，队友每 500ms 轮询回复；团队注册表为 `config.json`；禁止队友再生队友（AgentTool.tsx:273）[L15]。
- 生产版（官方）：实验特性，需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`（研究预览 v2.1.32，2026-02-05）；共享任务表（pending、in progress、completed，可声明依赖，认领用文件锁）；邮箱是 JSON 文件，读时逐条校验，写入成功才算发送；消息自动投递，队友停下时自动给 Lead 发 idle 通知并附最终答复 [S2][D34]；官方建议 3-5 人、队友用 Sonnet，token 随人数线性增长 [S2][S106]；已知问题有 Lead 不等队友、任务状态滞后、进程内队友 resume 后不回来 [S2]。
- 理由：子 Agent 是临时工，队友负责长期并行协作 [L15][L20]。

### S16 Team Protocols
- 问题与教学版：关机、计划审批这类协商需要 request-response 契约；教学版 ProtocolState 记录 request_id、type、sender、target、status、payload，按消息类型分发，`match_response` 校验响应与请求类型匹配且只接受 pending 状态 [L16]。
- 生产版（据 learn.shareai.run 的源码分析）：teammateMailbox.ts 定义 15 种结构化消息（idle_notification、permission_request/response、plan_approval_request/response、shutdown_request/approved/rejected、task_assignment、team_permission_update、mode_set_request、sandbox_permission_*、teammate_terminated 等），有 Zod 校验，文本消息包在 `<teammate-message>` 里；关机是三方通信，确认后清理窗格、取消任务分配、移出团队；计划审批请求由 ExitPlanModeV2Tool 产生，当前自动回写 approval，显式审批可附 permissionMode 与 feedback；字段命名不统一（permission 用 request_id，shutdown 与 plan 用 requestId）[L16]。
- 生产版（官方）：Lead 发 shutdown 请求，队友可批准退出或附理由拒绝；队友提交计划时，若权限模式没改过，Claude Code 收到即批准，Lead 不审 [S2]；auto 模式下分类器在投递前审查每条普通或结构化消息，其他 Agent 转述的"已批准"按不可信输入处理 [S2][D2]；v2.1.224 起还能用 ListAgents/SendMessage 给本机其他会话发消息，消息只含文本，不带历史或文件 [D29]。
- 理由：所有协议共用同一个 request_id 关联机制，状态机只有 pending → approved/rejected [L16]。

### S17 Autonomous Agents
- 问题与教学版：Lead 逐个分配无法扩展，队友要自己看板认领；教学版生命周期 WORK → IDLE → SHUTDOWN：IDLE 每 5 秒先查收件箱（关机优先），再扫描 pending、无 owner、依赖已完成的任务，60 秒无活就退出；压缩后消息过短时重注入身份 [L17]。
- 生产版（据 learn.shareai.run 的源码分析）：由四个机制组合：`sendIdleNotification()` 通知 Lead；`waitForNextPromptOrShutdown()` 每 500ms 轮询待处理消息、邮箱和任务表，shutdown 优先；`useTaskListWatcher` 用 fs.watch 监视任务目录（1 秒防抖）；等待期间 `tryClaimNextTask()` 主动认领并改为 in_progress；没有固定空闲超时，由 Lead 关机 [L17]。
- 生产版（官方）：队友做完一项后自行认领下一个未分配、未阻塞的任务，被阻塞的任务不自领，但可由 Lead 指派 [S2]；TeammateIdle hook 以退出码 2 让队友带反馈继续工作 [S2][D13]。
- 理由：认领必须在文件锁内完成读-查-写，否则并发队友会重复认领 [L17]。

### S18 Worktree Isolation
- 问题与教学版：并行 Agent 需要隔离的文件系统；教学版为任务建 `.worktrees/{name}` 和 `wt/{name}` 分支，任务记录 worktree 字段（绑定不改状态），队友认领后工具在该目录执行，有改动时默认拒绝删除，生命周期事件写 events.jsonl [L18]。
- 生产版（据 learn.shareai.run 的源码分析）：两条路径：EnterWorktree 直接 `process.chdir()` 切换会话；Agent 工具 `isolation: "worktree"` 用 cwdOverride 包住子 Agent；名称只允许 `[a-zA-Z0-9._-]` 并拒绝 `.`、`..`；路径为 `.claude/worktrees/`，分支为 `worktree-{slug}`，用 `git worktree add -B` 优先基于 origin 默认分支；状态 PersistedWorktreeSession 写在会话 transcript 里，不含 taskId，任务与 worktree 是两个独立系统 [L18]。
- 生产版（官方）：`--worktree`（v2.1.49，2026-02-19）与 `isolation: worktree`（v2.1.50）；`worktree.baseRef` 取 fresh（默认，远端默认分支）或 head；隔离期间拦截四类调用：编辑主 checkout 的路径、工作目录落在主 checkout、把 git 重定向回主 checkout、无法从命令文本确认 git 去向；运行时持有 `git worktree lock`；子 Agent 无改动的 worktree 自动删除，有工作的保留，定期清扫只删超过 cleanupPeriodDays 且已无未提交或未推送工作的；非 git 版本控制用 WorktreeCreate/WorktreeRemove hook 替代 [D21][D34]。
- 理由：worktree 隔离文件编辑，子 Agent 拆分会话内工作，跨会话消息在会话之间传递发现，三者分工不同 [D21]。

### S19 MCP Tools
- 问题与教学版：外部服务用标准协议发现与调用，工具名用 `mcp__server__tool` 命名空间，非法字符替换为 `_`；教学版用 mock 模拟 tools/list 与 tools/call，连接后重建工具池并去掉提示缓存，只给 Lead 用 [L19]。
- 生产版（据 learn.shareai.run 的源码分析）：6 种传输（stdio、sse、http、ws、sse-ide、sdk），本地服务器每批并发连接 3 个、远程 20 个；`assembleToolPool()`（tools.ts:345-364）把内置工具与 MCP 工具分别排序后拼接，同名保留内置，以保住内置工具之后的缓存断点；配置优先级 claude.ai 连接器 < plugin < user < 已批准的项目 .mcp.json < local，存在企业 managed-mcp.json 时排除其他来源；OAuth 2.0 + PKCE，令牌进系统钥匙串，过期前 5 分钟刷新；连续 3 次终局性连接错误就关闭重连 [L19]。
- 生产版（官方）：tool search 默认开启，只把工具名和服务器说明放进上下文，定义按需加载（v2.1.7，2026-01-14 起默认在工具描述超过上下文 10% 时延迟，现在默认全部延迟）；常驻描述上限 4,096 字符、经搜索加载的 16,384 字符；输出超 10,000 token 警告、默认上限 25,000 token，成功文本超 50,000 字符落盘，错误文本超约 11,000 字符只留首尾各 5,000；远程服务器空闲 5 分钟、stdio 30 分钟中止调用；项目 .mcp.json 的服务器要等工作区被信任后才能批准 [D18][D34]。
- 理由：工具定义位于系统提示层，会话中途增删会让缓存失效，延迟加载让首个请求的工具表全程不变 [D7]。

### S20 Comprehensive Agent
- 问题：把前 19 章的机制挂回同一个循环，看清每个组件在循环中的位置（顺序见上节）[L20]。
- 教学版：27 个内置工具加 MCP 动态工具，`assemble_tool_pool()` 每轮组装；权限作为 PreToolUse hook；todo 与任务图两层计划；`task` 与 `spawn_teammate` 两种委派；LLM 调用前跑压缩管线，调用外包恢复；慢 bash 进后台线程；cron 独立线程每秒检查；worktree 与任务绑定 [L20]。
- 生产版：官方把 Claude Code 定义为模型外层"提供工具、管理上下文"的 harness，同一循环跑在终端、IDE、桌面、云端、CI 与 SDK 中 [D1]。仓库 17 课版本补了两种更高层的控制：保存好的 workflow 脚本（agent、parallel、pipeline、phase 原语，按调用内容哈希写 journal 以便续跑，schema 校验失败重试 1 次）与 goal loop（独立判断器决定能否停）[L22][L23]，对应官方的 dynamic workflows（默认 16 并发、单次最多 1000 个 agent，按调用记录结果并在恢复时重放）[S3] 与 `/goal` [D10]。
- 理由：复杂性属于 harness，不属于"另一个 Agent 大脑"[L20]。

## 补充方面（E1-E13）

### E1 沙箱与 OS 级隔离
- 机制：Bash、PowerShell、Monitor 命令及其子进程在 OS 边界内运行（macOS 用 Seatbelt，Linux/WSL2 用 bubblewrap，原生 Windows 不沙箱）；写入限于工作目录、临时目录和追加目录，读默认可达机器大部分位置（含 `~/.ssh`）；网络没有直连，经本机代理按域名白名单放行，白名单初始为空，UDP、QUIC、ICMP 出不去 [D4]。
- 模式与逃生口：auto-allow 模式下沙箱内命令免审批，但 deny 规则、内容级 ask 规则和 critical-path `rm` 仍生效；命令在沙箱内失败时模型可带 `dangerouslyDisableSandbox` 重试，由权限模式决定谁批准，`allowUnsandboxedCommands: false` 可关闭逃生口（v2.0.30）；凭据可 deny 或 mask，mask 时沙箱内只见哨兵值，代理在出站时替换真值，需开 TLS 终止 [D4][D34]。
- 边界：文件工具、MCP、hooks、LSP 不在沙箱内；代理不检查 TLS 内容，放行 github.com 这类宽域名可能被 domain fronting 绕过；要把整个进程装进边界，用 sandbox-runtime、dev container 或 VM [D4]。云端会话每会话一个隔离 VM，GitHub 凭据不进 VM，由代理在服务端附加，并拒绝删除分支和推送标签 [D25][A2]。
- 数据与理由：沙箱让内部使用的权限提示减少 84%，运行时已开源 [A2][A3]；Anthropic 的原则是先做环境遏制再做模型引导，因为概率性防线全部失手时，确定性边界是最后一道 [A3]。

### E2 文件编辑格式与补丁应用
- 机制：Edit 是精确字符串替换（old_string → new_string，不用正则或模糊匹配），要求先读后改、old_string 唯一，否则加上下文或设 `replace_all` [S105]；教学版同样"文本出现才替换一次"，生产版执行前另有 Zod 与 `validateInput()` 校验（据 learn.shareai.run 的源码分析）[L2]。
- 细节：文件在上次读取后被改动，只要 old_string 与当前内容精确且唯一匹配就允许编辑并提示重读；对单个文件、不带管道的 `cat`、`head`、`tail`、`sed -n`、`grep`、`rg` 查看也算读过；新模型在读取无需审批时可直接改未读文件，Opus 4.6、Haiku 4.5 及更早模型必须先读；Write 整体覆盖，NotebookEdit 改单元格；当前工具表中没有 MultiEdit [S105]。
- 失败处理：每次编辑前快照文件供 /rewind，Bash 改动不进检查点（见 E4）[D5]。
- 理由：精确匹配让失败可检测、可重试，也让检查点只需跟踪编辑工具 [S105][D5]。

### E3 代码搜索与仓库理解
- 机制：不建向量索引；CLAUDE.md 预先放进上下文，其余靠 glob、grep 等原语即时检索，避开索引过期和语法树的复杂度 [A5]。
- 当前实现：v2.1.117（2026-04-22）起 macOS/Linux 原生构建把 Glob、Grep 移出默认工具集，改用 Bash 内嵌的 bfs 与 ugrep，这些搜索按 Bash 调用经过 hooks 与权限；Windows、显式点名 Glob/Grep、移除了 Bash 的会话或子 Agent 仍有独立工具 [S105][D34]。Grep 基于 ripgrep、遵守 .gitignore，有三种输出模式；Glob 按 mtime 排序、最多 100 个结果，默认不遵守 .gitignore [S105]。
- 增强：LSP 工具（v2.0.74，2025-12-19）需要安装 code intelligence 插件，提供跳转定义、找引用、调用层级，并在每次编辑后自动报告类型错误 [S105][D34]；宽范围搜索默认交给内置 Explore 子 Agent [D32]；大仓库用分目录 CLAUDE.md、Read deny 屏蔽生成代码、`worktree.sparsePaths`，已有 RAG 索引的组织以 MCP 暴露 [D24]。
- 理由：即时检索比预计算慢，但不用维护索引，模型还能从文件名、目录结构、时间戳获得信号 [A5]。

### E4 会话持久化、恢复、检查点与撤销
- 会话：每条消息、工具调用与结果写入 `~/.claude/projects/` 下的 JSONL；`--continue`/`--resume` 沿用同一 session ID 追加，`--fork-session` 或 `/branch` 复制到新 ID [D1]。SDK 的 SessionStore 适配器只需实现 append 和 load，把本地 transcript 镜像到 S3、Redis、Postgres 供多主机恢复；镜像写失败最多尝试 3 次后丢弃该批并发出 `mirror_error` [D28]。
- 检查点：每个开启新轮次的用户提示建一个检查点，保留最近 100 个检查点的文件快照，默认约 30 天后清理（cleanupPeriodDays）；`/rewind` 或空输入时双击 Esc 可分别恢复代码、对话或两者，也能从某点起或到某点止做摘要 [D5]；SDK 用 `enableFileCheckpointing` 加 `rewindFiles(uuid)` [D27]；/rewind 于 v2.0.0（2025-09-29）上线 [D34]。
- 局限：只跟踪文件编辑工具；只被 Bash 改过的文件、多数子 Agent 的编辑、外部修改、软硬链接都不恢复；运行中排队的消息没有自己的检查点；远端副作用不能回滚，只能靠权限控制 [D5][D1]。
- 恢复范围：resume 会恢复活跃的 `/goal`（轮数和计时清零）与未过期的 cron 任务，不重启后台命令和 monitor；进程内队友 resume 后不会回来 [D10][D20][S2]。

### E5 模型与提供方适配
- 范围：只跑 Claude 模型，接入方式为 Anthropic API、Bedrock、Google Cloud Agent Platform、Microsoft Foundry、Claude Platform on AWS，或实现 Anthropic Messages 格式的网关；`ANTHROPIC_BASE_URL` 只改请求去向，不改模型；网关可经 `/v1/models` 发现模型，只保留 id 含 claude 或 anthropic 的条目 [D9][D23]。
- 推理与上下文：effort 分 low、medium、high、xhigh、max，最新一代模型默认 medium 且 thinking 不能关；交互会话默认收到脱敏的 thinking 块；不认识的模型 ID 按 200K 窗口处理并在那里压缩 [D9][D32]。流式细节（据 learn.shareai.run 的源码分析）：以 tool_use 块而非 stop_reason 判断继续，可恢复错误在流结束前扣住 [L1][L11]。
- 失败处理：重试、tool-call 解析补问、回退链见 S11 [D22][D9]；带安全分类器的模型拒答时按内容类别切到指定的旧模型重跑 [D9]。
- 取舍：单一 API 格式让缓存、tool search、thinking 等能力可以深度利用，代价是不能换用非 Claude 模型，这一点与 OpenCode、Pi 的多提供方路线不同 [D7][D23]。

### E6 Prompt 缓存、成本与预算
- 缓存：按前缀精确匹配，前缀任何变化都会让其后内容重算；切模型、多数模型上改 effort、增删预加载的工具定义会失效，编辑文件、切权限模式、调用技能、rewind 不会；会话中编辑 CLAUDE.md 不失效但也不生效，要等 /clear、/compact 或重启 [D7]。TTL：订阅额度内主对话 1 小时，其余请求（子 Agent、workflow、压缩等）5 分钟，API key 与云厂商默认 5 分钟，可用 `promptCacheTtl` 改；fork 与同前缀的 workflow 扇出（后者最多等 5 秒）复用父缓存 [D7]。
- 观测：`/usage` 的 `Prompt cache (main)` 行给出命中率、未命中次数、是否温热和最可能的失效原因（如工具定义变化），状态栏 JSON 有 `prompt_cache` 对象 [D7][S106][D17]。
- 成本与预算：`/usage` 本地按牌价计算会话花费；企业部署平均约每开发者每活跃日 13 美元，90% 用户低于 30 美元 [S106]；`--max-budget-usd`（v2.0.28）与 maxBudgetUsd 在每次响应后比较，因此可能超出一次响应的费用 [D12][D34]；长会话变贵的来源有长上下文、缓存过期、定时任务、跨会话消息、goal 检查、子 Agent 和压缩 [S106]。
- 理由：历史按缓存价重读，"少改前缀"比"少写字"更省钱 [D7]。

### E7 工具输出管理
- Bash：输出先流式写入工作文件；成功结果内联约 30,000 字符，超出则给文件路径和前 2,000 字符预览；失败结果内联约 10,000 字符的首尾摘录，不给路径；读回窗口 `BASH_MAX_OUTPUT_LENGTH` 默认 30,000、硬上限 150,000；`bashOutputMaxChars` 最高 128,000（v2.1.261）[S105]。
- Read 与 WebFetch：Read 单次最多 25,000 token，整文件超 256KB 拒绝，超 token 时返回首页并标 PARTIAL view，用 offset/limit 分页，v2.1.296 起可设 `allow_large`；PDF 每次最多 20 页；WebFetch 每次最多 10 万字符，并先由独立模型按提示抽取，结果有损 [S105]。MCP 的限制见 S19 [D18]。
- 教程补充（据 learn.shareai.run 的源码分析）：每个工具的 `maxResultSizeChars` 决定是否落盘，单条消息内工具结果合计预算 200,000 字符（toolLimits.ts:49），预算处理排在所有压缩步骤之前 [L2][L8]。
- 理由：Claude Code 把工具响应默认限制在 25,000 token；截断时应告诉模型下一步怎么做，而不是返回不透明的错误 [A4]。

### E8 人工介入与运行中引导
- 中断与排队：Esc 立即停止当前工具调用并保留已完成的工作；运行中输入的消息会排队，若 Claude 正在跑工具，这批调用结束后同一轮内就送达；Ctrl+Enter 立即发送（v2.1.275 起；v2.1.281 起会把可后台的工作转后台而不是中断）；排队的命令等本轮结束后按序执行 [D6][D1]。
- 计划模式：只读探索并写计划，批准选项决定之后进入哪种权限模式（auto、逐个审批或继续规划），Ctrl+G 可直接编辑计划；auto 可用时，计划阶段的 shell 命令交分类器审查 [D2]；`opusplan` 别名在计划阶段用 Opus、执行阶段用 Sonnet [D9]。
- 提问与审批：AskUserQuestion 发多选题，默认一直等待，可设 60s、5m 或 10m 超时后注明"用户可能不在"继续；权限提示和计划批准不会因空闲自动通过；审批时可附评论 [S105][D3]；子 Agent 拿不到 AskUserQuestion，后台子 Agent 的权限请求在主会话弹出 [S1]；`--permission-prompts none` 用于无人值守，并移除需要人回答的工具 [D11]。
- 理由：经验用户自动批准的频率约为新用户两倍，但更常中途打断，引导更多靠打断与排队而不是逐步审批 [A3]。

### E9 完成判断与验证
- 基本规则：模型给出不含工具调用的回复就停，"看起来做完了"是它唯一的依据 [D12][D32]。
- 加强手段：`/goal`（v2.1.139，2026-05-11）是会话级 prompt 型 Stop hook，每轮结束后由小模型读对话，判定 met、not yet 或 impossible；条件最长 4,000 字符；评估器不调工具，只看对话；连续几轮没有工具调用就停下交还用户；有后台工作时推迟评估，30 分钟起检查，每个目标在两次用户提示之间最多 3 次空闲检查 [D10][D34]。Stop hook 退出码 2 可强制继续（如 `tsc --noEmit`），连续 8 次上限 [D32][D13]。`/code-review` 用没看过实现过程的新子 Agent 审 diff；`/verify` 构建并运行应用、观察结果，v2.1.215 起只能由用户调用 [D32][D31]。
- 教程：仓库 s17 在原出口处接入独立判断器（ok、reason、impossible），判断失败时停止自动续跑并保留目标，后台任务未结束时返回 defer [L23]；据 learn.shareai.run 的源码分析，TodoWrite 在 3 个以上 todo 完成却没有验证项时追加验证提醒 [L5]。
- 理由：由一个新模型而不是干活的模型判定完成；要求 transcript 中出现所运行的命令与输出作为证据；必须遵守的检查放进 hook，而不是 CLAUDE.md [D10][D32]。

### E10 不可信内容、提示注入与密钥
- 输入层：服务端探针扫描工具结果，疑似注入时在结果旁加警告；WebFetch 由独立模型摘要页面；curl、wget 不自动批准；无法完整解析的 Bash 命令要求审批 [A1][D2][D25]。
- 动作层：auto 模式分类器（Sonnet 4.6）只看用户消息和工具调用，剥掉 assistant 文本与工具结果；分两阶段，单 token 快筛之后才做推理；内部评估中快筛误拦率 8.5%，二阶段降到 0.4%，对真实越权动作漏报 17%（n=52）；在委派时、子 Agent 运行中、交回报告时各检查一次 [A1][D2]。
- 多 Agent 与技能：子 Agent 报告交回前被扫描，冒充 `<system-reminder>` 或 `Human:` 的文本被插入反斜杠，提到 bypassPermissions 等权限设置的加标记行，并加头注明这是子 Agent 的话、不代表用户授权 [S1]；技能描述中的尖括号被转义 [D19]。
- 信任与密钥：项目配置（hooks、.mcp.json、仓库外导入）要等工作区被信任后才执行或批准，`-p` 不弹信任框 [D25][D18][D14]；凭据存钥匙串或权限 0600 的文件；`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` 按变量名或值剥离子进程环境中的凭据；OTel 默认脱敏提示、工具输入和内容；MCP 错误详情会去掉类似凭据的文本 [D25][D30][D16][D18]。
- 教训：直接经由用户的注入（2026-02 内部钓鱼演练 25 次成功 24 次）和经已放行域名的外泄，模型层都拦不住，只能靠出口控制和文件边界 [A3]。

### E11 可观测性与评估
- OpenTelemetry：导出指标、事件和 beta 链路；每个用户提示一个 `claude_code.interaction` 根 span，下挂 llm_request、tool（再分 blocked_on_user 与 execution）、hook，子 Agent 的 span 嵌在父 tool span 下；属性含 agent_id、parent_agent_id、workflow.run_id、effort、ttft_ms；Bash 子进程继承 TRACEPARENT，`-p` 与 SDK 读取外部 TRACEPARENT 并入调用方链路；仓库里的 settings 不能打开或改向遥测 [D16]。
- 本地观测：状态栏脚本从 stdin 接收 JSON（模型、cost、context_window 用量、rate_limits、prompt_cache、worktree、PR），事件驱动、300ms 防抖 [D17]；`/context`、`/usage`、`/tasks` 与 Ctrl+O 记录视图 [D8][S106][D6]。
- 评估：`claude plugin eval` 为插件或技能跑用例，评分器可用正则、是否调用某工具或模型评分，可与无插件基线对比，并在 CI 里设门槛 [D33]；Anthropic 建议同时评 transcript 与 outcome，区分 pass@k 与 pass^k，并定期人工阅读 transcript [A6]；auto 模式分类器用 1 万条真实流量、52 条真实越权和 1000 条合成外泄任务评估 [A1]。

### E12 运行模式与集成
- 形态：交互 CLI；`-p` 非交互（text、json、stream-json 输出，`--json-schema` 结构化输出，`--include-partial-messages` 流式 token）；Python/TypeScript Agent SDK（2025-09-29 由 Claude Code SDK 改名）；IDE、桌面、云端会话、Remote Control、Slack、GitHub Actions 与 GitLab CI；`claude mcp serve` 把自身工具作为 MCP 服务器暴露 [D1][D11][D18][D34]。
- 无人值守：`--bare` 跳过 hooks、技能、插件、MCP、auto memory、CLAUDE.md 的自动发现，官方表示它将成为 `-p` 的默认；不加 `--bare` 时 `-p` 会执行项目 hooks 且不弹信任框；运行结束时等待主对话启动的后台命令，达到 `--max-budget-usd` 则停掉它们 [D11]；SDK 默认用极简系统提示，需显式选 `claude_code` preset [D26]。
- ACP：Claude Code 本身不实现 ACP；Zed 于 2025-09-03 用自研适配器以 ACP 接入（公开测试），该适配器现为 agentclientprotocol/claude-agent-acp，基于 Claude Agent SDK，2026-05 仍在更新 [T1][T2]。
- 变化：auto 模式拦截达到阈值时，工程博客写的是 `-p` 直接终止进程 [A1]，当前文档改为不执行该动作、继续运行 [D2]。

### E13 项目指令与配置层级
- CLAUDE.md：按 managed policy → 用户 `~/.claude/CLAUDE.md` → 项目 `./CLAUDE.md` 或 `.claude/CLAUDE.md` → 本地 `CLAUDE.local.md` 加载，从文件系统根到工作目录逐级拼接，越近的越靠后；子目录的 CLAUDE.md 在读写其中文件时按需加载；`@path` 导入最多 4 层，导入仓库外文件需首次批准；`.claude/rules/*.md` 可用 `paths` 限定作用范围；块级 HTML 注释注入前剥离；单文件超 4 MiB 跳过；建议每份不超过 200 行 [D14]。
- AGENTS.md：v2.1.277（2026-09-18）起，工作目录及其上级没有 CLAUDE.md 或 CLAUDE.local.md 时读 AGENTS.md，有则只读 CLAUDE.md，可在 /config 改 [D14][D34]。
- settings：优先级 managed > 命令行 `--settings` > 项目本地 > 共享项目 > 用户；列表类键合并而不覆盖；任一层的 deny 都生效；`defaultMode` 的 auto、bypassPermissions 和遥测导出变量不能从项目文件设置；多数改动热加载并触发 ConfigChange hook [D15][D3]。
- 理由：CLAUDE.md 是上下文而非强制配置，必须遵守的规则应改用 hook、deny 规则或 managed 设置 [D14][D32]。

## 对自建 harness 最值得借鉴的 10 条

1. 循环按"响应中有无 tool_use 块"决定是否继续，把所有出口和恢复路径枚举为带计数器的 transition（续写不超过 3 次、应急压缩 1 次、Stop hook 续跑不超过 8 次、maxTurns、预算），结果返回 subtype、轮数和花费，逐条路径写测试 [L1][L11][D12][D13]。
2. 工具元数据按每次调用判定：`isConcurrencySafe(input)` 让连续只读调用并发、写调用串行；每个工具声明输出上限，超限落盘并给路径与预览，读文件工具豁免以免循环 [L2][S105]。
3. 权限用 deny → ask → allow 首个命中，任一作用域的 deny 都生效，hook 的 allow 越不过 deny/ask；复合命令逐段匹配；critical-path 删除和需要用户交互的工具在任何模式都不自动批准；被拒动作作为 tool result 回给模型，而不是终止会话 [D3][D2][L4][A1]。
4. 先做环境遏制：OS 沙箱加出站代理白名单，凭据不进沙箱或用哨兵值替换；项目内配置（hooks、MCP、外部导入）等信任确认之后才解析 [D4][A2][A3]。
5. 若用模型审批，审批器只看用户消息和工具调用，不看 assistant 文本和工具结果；连续 3 次或累计 20 次拒绝就退回人工；委派与交回时各审一次 [A1][D2]。
6. 上下文按"便宜到昂贵"处理：大结果落盘 → 裁中间 → 旧结果占位 → 摘要（摘要请求禁止调工具、先分析后总结）；压缩后限额重注入最近文件、计划和技能；摘要失败 3 次熔断，压缩后立即又满就报错，不空转 [L8][D8][D1]。
7. 提示按稳定度分层（系统提示与工具 → 项目上下文 → 对话），会话内不改工具表，外部工具延迟加载；fork 子 Agent 复用父前缀；记录每次缓存未命中的可能原因 [D7][L10][D18]。
8. 完成判断与执行分离：确定性检查放进 Stop hook（退出码阻断、带续跑上限），开放条件交给只读对话的独立评估器（met、not yet、impossible），要求 transcript 里有命令与输出作为证据，有后台工作时推迟判定 [D10][D13][D32][L23]。
9. 多 Agent 的硬上限由运行时强制：深度 3、并发 20、预算到限拒绝新 spawn；任务认领在文件锁内完成读-查-写；子 Agent 报告转义冒充的标签并标明"非用户授权"；并行写入用 worktree，隔离期间拦截指回主 checkout 的编辑与 git 命令 [S1][S5][L12][D21]。
10. 会话可恢复也可撤销：追加式 JSONL transcript，resume 与 fork 分开，每轮编辑前快照文件、代码与对话可分别回滚，并写明不覆盖的范围（Bash 改动、子 Agent 编辑）；OTel span 带 agent_id 与 parent_agent_id，评估同时看 transcript 与 outcome [D1][D5][D16][A6]。

## 来源

所有页面于 2026-10 下旬访问。L 系列页面未标发布日期；D 系列为官方文档，无发布日期，版本与日期以 [D34] 为准。

教程（learn.shareai.run 与配套仓库）
- [L0] 首页与架构层次页 https://learn.shareai.run/zh/ ；https://learn.shareai.run/zh/layers/
- [L1] s01 Agent Loop https://learn.shareai.run/zh/s01/
- [L2] s02 Tool Use https://learn.shareai.run/zh/s02/
- [L3] s03 Permission https://learn.shareai.run/zh/s03/
- [L4] s04 Hooks https://learn.shareai.run/zh/s04/
- [L5] s05 TodoWrite https://learn.shareai.run/zh/s05/
- [L6] s06 Subagent https://learn.shareai.run/zh/s06/
- [L7] s07 Skill Loading https://learn.shareai.run/zh/s07/
- [L8] s08 Context Compact https://learn.shareai.run/zh/s08/
- [L9] s09 Memory https://learn.shareai.run/zh/s09/
- [L10] s10 System Prompt https://learn.shareai.run/zh/s10/
- [L11] s11 Error Recovery https://learn.shareai.run/zh/s11/
- [L12] s12 Task System https://learn.shareai.run/zh/s12/
- [L13] s13 Background Tasks https://learn.shareai.run/zh/s13/
- [L14] s14 Cron Scheduler https://learn.shareai.run/zh/s14/
- [L15] s15 Agent Teams https://learn.shareai.run/zh/s15/
- [L16] s16 Team Protocols https://learn.shareai.run/zh/s16/
- [L17] s17 Autonomous Agents https://learn.shareai.run/zh/s17/
- [L18] s18 Worktree Isolation https://learn.shareai.run/zh/s18/
- [L19] s19 MCP Tools https://learn.shareai.run/zh/s19/
- [L20] s20 Comprehensive Agent https://learn.shareai.run/zh/s20/
- [L21] shareAI-lab/learn-claude-code README（main 为 17 课版本）https://github.com/shareAI-lab/learn-claude-code
- [L22] s16 Workflow Runtime 中文 README https://github.com/shareAI-lab/learn-claude-code/blob/main/s16_workflow_runtime/README.zh.md
- [L23] s17 Goal Loop 中文 README https://github.com/shareAI-lab/learn-claude-code/blob/main/s17_goal_loop/README.zh.md

沿用编号（URL 同 multi-agent/mechanics.md，本次重新访问了 S1、S2、S105、S106）
- [S1] Create custom subagents https://code.claude.com/docs/en/sub-agents
- [S2] Orchestrate teams of Claude Code sessions https://code.claude.com/docs/en/agent-teams
- [S3] Orchestrate subagents at scale with dynamic workflows https://code.claude.com/docs/en/workflows
- [S5] Subagents in the SDK https://code.claude.com/docs/en/agent-sdk/subagents
- [S105] Tools reference https://code.claude.com/docs/en/tools-reference
- [S106] Manage costs effectively https://code.claude.com/docs/en/costs

Claude Code 官方文档
- [D1] How Claude Code works https://code.claude.com/docs/en/how-claude-code-works
- [D2] Choose a permission mode https://code.claude.com/docs/en/permission-modes
- [D3] Configure permissions https://code.claude.com/docs/en/permissions
- [D4] Configure the sandboxed Bash tool https://code.claude.com/docs/en/sandboxing
- [D5] Checkpointing https://code.claude.com/docs/en/checkpointing
- [D6] Interactive mode https://code.claude.com/docs/en/interactive-mode
- [D7] How Claude Code uses prompt caching https://code.claude.com/docs/en/prompt-caching
- [D8] Explore the context window https://code.claude.com/docs/en/context-window
- [D9] Model configuration https://code.claude.com/docs/en/model-config
- [D10] Keep Claude working toward a goal https://code.claude.com/docs/en/goal
- [D11] Run Claude Code programmatically https://code.claude.com/docs/en/headless
- [D12] How the agent loop works（Agent SDK）https://code.claude.com/docs/en/agent-sdk/agent-loop
- [D13] Hooks reference https://code.claude.com/docs/en/hooks
- [D14] How Claude remembers your project https://code.claude.com/docs/en/memory
- [D15] Settings files and precedence https://code.claude.com/docs/en/settings
- [D16] Monitoring https://code.claude.com/docs/en/monitoring-usage
- [D17] Customize your status line https://code.claude.com/docs/en/statusline
- [D18] Connect Claude Code to tools via MCP https://code.claude.com/docs/en/mcp
- [D19] Extend Claude with skills https://code.claude.com/docs/en/skills
- [D20] Run prompts on a schedule https://code.claude.com/docs/en/scheduled-tasks
- [D21] Run parallel sessions with worktrees https://code.claude.com/docs/en/worktrees
- [D22] Error reference https://code.claude.com/docs/en/errors
- [D23] Claude Code gateway compatibility guide https://code.claude.com/docs/en/llm-gateway-protocol
- [D24] Set up Claude Code in a monorepo or large codebase https://code.claude.com/docs/en/large-codebases
- [D25] Security https://code.claude.com/docs/en/security
- [D26] Modifying system prompts（Agent SDK）https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- [D27] Rewind file changes with checkpointing（Agent SDK）https://code.claude.com/docs/en/agent-sdk/file-checkpointing
- [D28] Persist sessions to external storage（Agent SDK）https://code.claude.com/docs/en/agent-sdk/session-storage
- [D29] Message your other Claude Code sessions https://code.claude.com/docs/en/cross-session-messaging
- [D30] Environment variables https://code.claude.com/docs/en/env-vars
- [D31] Commands https://code.claude.com/docs/en/commands
- [D32] Best practices for Claude Code https://code.claude.com/docs/en/best-practices
- [D33] Test plugins with evals https://code.claude.com/docs/en/plugin-evals
- [D34] Claude Code changelog（最新条目 v2.1.316，2026-10-31）https://code.claude.com/docs/en/changelog

Anthropic 工程与研究文章
- [A1] How we built Claude Code auto mode https://www.anthropic.com/engineering/claude-code-auto-mode （约 2026-03-25，据检索元数据）
- [A2] Making Claude Code safer with sandboxing（claude.com 同文题为 Beyond permission prompts）https://www.anthropic.com/research/claude-code-sandboxing （2025-10-20，与 changelog v2.0.24 同日）
- [A3] How we contain Claude across products https://www.anthropic.com/engineering/how-we-contain-claude （约 2026-05-25，据检索元数据）
- [A4] Writing effective tools for AI agents https://www.anthropic.com/engineering/writing-tools-for-agents （2025-09）
- [A5] Effective context engineering for AI agents https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents （2025-09）
- [A6] Demystifying evals for AI agents https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents （2026-01，日期据二手转述）

第三方
- [T1] Zed Blog《Claude Code: Now in Beta in Zed》https://zed.dev/blog/claude-code-via-acp （2025-09-03）
- [T2] agentclientprotocol/claude-agent-acp（原 zed-industries/claude-code-acp）https://github.com/agentclientprotocol/claude-agent-acp （2026-05 仍有提交，据检索元数据）
