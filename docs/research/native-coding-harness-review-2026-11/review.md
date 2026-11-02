# Native Coding v3 harness 评审：逐项对照、改进顺序与面试讲法

> 2026-11-01，只读评审。输入是本目录 6 份报告和 `../multi-agent/` 下的 mechanics.md、devflow-assets.md。关键事实在本机 v3 工作树（提交 1108087）和参考项目的本地浅克隆里抽查过。没有运行测试、应用或模型。
> 记法：v3 代码沿用 internal-v3.md 的缩写。loop、harness、tools、session、context、ext 指 `apps/desktop/electron/native-coding-*.ts`；ws、evid、merge、runner 指 `coding-{candidate-workspace,evidence-v3,child-merge,command-runner}.ts`；`E/` = `apps/desktop/electron/`，`S/` = `packages/shared/src/`；Panel = `apps/desktop/src/views/NativeCodingHarnessPanel.tsx`；live、plan 指 v3 的 `docs/evaluation/native-coding-v3-live-20261011.md` 与 `docs/plans/native-coding-harness-v3-20261011.md`。行号都指 v3。
> 参考写成 `[报告:编号]`：cc = claude-code.md，op = opencode-pi.md，cx = codex-others.md，ds = deepseek-harness.md，oh = aider-openhands-more.md，ma = mechanics.md，da = devflow-assets.md，iv = internal-v3.md。编号沿用各报告，链接见第 10 节。
> 术语：r1–r8 是对照评测的轮次（题库 31 道合格题，每轮跑一部分；r8 有 $3 上限、10 道题）。interactive r1–r6 是 12 个交互故障场景的真实模型演练。"错误成功"指会话报告完成，但评测方持有的独立断言没通过。

## 1. 结论

v3 是 DevFlow 自己写的约 3,000 行编码 Agent 内核，没有 OpenCode 代码。它最扎实的是副作用和花费可信：先写收据再执行、模型请求的交付状态分三类、epoch 单写者租约、人批准冻结修订、四个隔离的工作区、根/子预算同事务准入，真实模型故障演练 r4、r6 都是 12/12。33 项按 0–4 打分平均 2.06，4 分只有循环、工作区隔离、预算与缓存三项。你关心的两块正是短板：任务管理没有计划、没有任务图，委派在对照题里 0 次（S05、S12 为 0 分）；权限没有规则，默认执行方式没有 OS 沙箱（S03、E1 为 2 分）；完成判定只看公开测试，r8 报告完成 5 次全是错误成功。建议顺序是：先合入 main、修好 schema 41 冲突、补瞬时错误重试；再做独立验证者，同时上 OS 沙箱和命令前缀规则；最后做计划/任务图和委派。这与之前多 Agent 调研的结论一致，只是先做验证、后放开编排；面试时讲"副作用可信的 harness，加一次被独立评测揭穿的错误成功和之后的修正"，不要讲"比 Claude Code 强"。

## 2. 我们的 harness 是什么

- **范围**：DevFlow 桌面端 build 节点里的编码执行器，草稿 PR #238；只在项目配置 `nativeVersion: 3` 时启用（E/main.ts:629-636）。
- **体量**：合并基点 289a12b 之后 41 个提交、147 个文件、+14,034/−114 行。新增生产文件 3,080 行、测试 1,614 行、脚本 2,828 行，另改已有文件约 346 行 [iv]。
- **自己写的**：循环、会话状态机、33 个工具、工作区、证据、合入、命令 runner。没有新增运行时依赖；Provider 是手写 fetch 调 `/chat/completions`（S/agent-review.ts:2169,2254），git 和 docker 走系统命令行。
- **复用 DevFlow 已有的**：工具注册表（860 行）、V2.0 AgentRuntime（1,821 行）、governedModelCall、脱敏、本地 MCP 客户端（497 行）、LocalStore、编码简报 [iv]。
- **不是 OpenCode**：所有 package.json 都没有 `@opencode-ai/*`；唯一相关引用是复用 DevFlow 自己写的进程树终止函数（runner:8）。OpenCode 1.18.15 是评测里的对照组。
- **架构**：
  - 宿主反复调用 `runBatch`，每批最多 12 个模型步骤。每步：执行上一步留下的工具调用（先写 started 收据，再授权、执行、写 completed 收据）；吸收插话；检查 80 步和 60 分钟上限；组装请求（固定 system 加历史，运行状态附在末条消息）；根步数 CAS 并落盘 attempt；经 governedModelCall 预留、发送、结算；追加回复（loop:99-313）。
  - 会话有 14 个状态，整份 JSON 存 SQLite，每次变更版本 +1 并做比较交换（session:12,79-87）。objectiveVersion 是目标版本，人每插话一次 +1；reconciling 是"有操作结果不确定，要人核对"的状态。
  - 四个内容身份：B 是输入快照（内容寻址），C 是私有候选仓库，D 是真实交付 worktree（只在人批准后由宿主写入），V 是每次验证从冻结字节新建的目录（ADR 0029:13-20）。
  - 根任务可派至多 3 个子任务，深度 1，每个子任务有自己的 C。
- **主要数字**：
  - interactive r4、r6（含真实杀进程和重启）都是 12/12。
  - r8：v3 花 $0.849，中位 6.8 分钟；8 个有调用的会话共 491 次模型调用、约 607 次工具调用；缓存命中 97.4%。
  - 对照轮 r1–r8 共 27 次 v3 观测，独立验收通过 0 次。r8 报告完成 5 次，独立断言是 80/81、104/111、41/46、42/51、319/320，全部失败。
  - r5–r8 的 22 次观测：错误成功 6、用满 80 步 4、HTTP 402 余额不足 7、invalid_test_plan 2、无效工具批 1、预算拒绝 2。
- **状态**：比 main 落后 46 个提交（按 10-29 的 2fbb037；按 11-01 拉取的 origin/main dee264b 是 52 个）。两边都把本地 schema 定为 41，内容不同（见第 6 节 #1）。2026-10-12 起暂停付费测试，发布门槛未达到（live:29）。

## 3. 逐项评分

评分：0 没有；1 只有雏形，或只在测试里；2 能用，有明显缺口；3 与主流相当；4 有特色，强于多数参考。只按 v3 草稿现状打分，不计计划中的工作。

| 方面 | 我们的做法（证据） | 做得最好的参考 | 分 | 差距 |
|---|---|---|---|---|
| **工具与执行** | | | | |
| S01 Agent Loop | 宿主按批调度持久会话，每批 ≤12 步；模型请求前先落盘 attempt；14 个状态（loop:99-222，session:12） | dsh：turn 由 step 组成，结束原因固定五种，停止前有串行检查点 [ds:d-turn][ds:d-stop]；Claude Code 把出口与恢复写成带计数器的 transition [cc:L1] | 4 | 一次无效回复就暂停整题（r8 07） |
| S02 Tool Use | 33 个工具统一声明 schema、权限类、120 秒、256 KB；整批校验，控制工具须单独；每次调用签一次性授权并审计（tools:20-27,316-331） | Claude Code 按输入判定能否并发，连续只读调用并发、上限 10 [cc:L2]；Codex 可并行工具取读锁、其余取写锁 [cx:C8] | 2 | 全部调用排一个队串行（tools:289-296），而 system 说可以并发（loop:16）；r8 有 23% 轮次一次多调用 |
| S03 Permission | 开工时人选 trusted_local 或 container；新命令、依赖、网络、MCP 各出权限卡，按内容摘要和目标版本生效 1 小时（E/native-coding-permissions.ts:8-21）；子任务不能批准（harness:447-458） | Codex：沙箱、审批策略、exec policy 前缀规则三层，规则带 match/not_match 样例 [cx:C12][cx:C15]；Claude Code deny→ask→allow，任一作用域的 deny 都生效 [cc:D3] | 2 | 没有规则和"本任务内允许"；面板只有"允许这次操作/拒绝"（Panel:67-69） |
| S04 Hooks | 没有用户 hook，只有宿主内部回调（loop:28-30） | Claude Code 33 个事件，hook 的 allow 越不过 deny/ask [cc:D13][cc:D3]；Codex 按定义哈希信任后才运行 [cx:C19] | 0 | 暂不建议做（第 6 节） |
| **计划与控制** | | | | |
| S05 TodoWrite | 没有计划工具，会话没有计划字段（session:16-64）；plan:133 设想过未实现 | Codex update_plan，至多一个 in_progress [cx:C21]；Claude Code 对新模型默认不给，3 项以上完成却无验证项时提醒 [cc:S105][cc:L5] | 0 | 人看不到进度，委派和验证没有挂靠点 |
| S06 Subagent | delegate_task 分只读、隔离编码两种；冻结父候选作子基线，独立 C，额度为子集，同时 ≤3、深度 1，子任务停下后宿主通知父任务（harness:189-283） | Claude Code：fork 复用父前缀缓存，默认后台，深度 3、并发 20，权限请求冒泡 [cc:L6][cc:S1]；OpenHands 子会话持久、可续跑 [oh:O-taskmgr] | 3 | 对照题 0 次使用；子任务首条消息与父任务无共同前缀（harness:225）；await_task 每次只等 5 秒 |
| S07 Skill Loading | list_skills/read_skill 按需读，结果标 instructions_only（ext:47-55）；目录不进提示 | Claude Code 目录常驻（每条 ≤1,536 字符），正文按需，压缩后重注入 [cc:D19][cc:D8]；Codex 目录预算占上下文 2% [cx:C28] | 1 | 没有测试，r8 0 次调用，模型不知道有哪些 Skill |
| S10 System Prompt | system 是 422 字常量；简报 ≤24,000 字节放首条 user；运行状态以 JSON 附在末条消息（loop:16，context:9-30） | Claude Code 静态段在前、动态段在后 [cc:L10][cc:D7]；dsh 把提示变化追加到历史尾部 [ds:d-inhist] | 3 | 不能按项目或角色配置 |
| S11 Error Recovery | 模型错误按交付状态分三类：未发送、已收到但无效、交付未知（loop:201-210）；工具错误交回模型，同批后续调用要求重规划（loop:244-246） | Codex 按 Retry-After 退避，流重试 5 次、请求重试 4 次，可从 WebSocket 退回 HTTP [cx:C44]；dsh 默认重试 5 次、500 ms–10 s [ds:d-retrysrc] | 2 | 429、5xx、超时都不自动重试；402 显示为 invalid_model_response（r6/r7 共 7 次） |
| **记忆管理** | | | | |
| S08 Context Compact | 按 Provider 真实序列化度量，超过 80% 改发压缩请求；只在闭合的工具对处切，保留用户原话和澄清答案，原文可 read_history 回读（context:42-61） | Claude Code 由便宜到昂贵四级（落盘、裁剪、占位、摘要），摘要失败 3 次熔断 [cc:L8]；Codex 90% 阈值，写交接摘要 [cx:C30][cx:C36] | 2 | 真实运行 0 次触发（r8 峰值 178,955 token）；没有廉价层 |
| S09 Memory | 开工时宿主召回 Hindsight 项目记忆写进简报，注明是不可信背景（E/coding-runtime.ts:3169-3183） | Claude Code 的 MEMORY.md 索引常驻（≤200 行或 25 KB），主题文件按需读 [cc:D14] | 2 | 循环内不能查询，也不写回本次学到的东西 |
| **并发与调度** | | | | |
| S13 Background Tasks | 持久命令 worker：先写收据再 fork，worker 收到 go 才 spawn；read_command 由宿主等待 ≤30 秒；子任务与父任务并行（runner:76-114,155-256） | Claude Code run_in_background，完成后以通知进入下一轮 [cc:L13]；dsh jobs 完成后唤醒空闲 Agent [ds:d-jobs] | 3 | 命令完成不通知，靠轮询（r8 read_command 51 次） |
| S14 Cron | 无；main 只有与 Agent 无关的 Hindsight 唤醒定时器（main E/main.ts:4600） | Claude Code cron 只在会话内、7 天过期 [cc:D20]；OpenCode 2.x schedules 仍是实验 [op:B26] | 0 | 暂不建议做 |
| **多 Agent 平台** | | | | |
| S12 Task System | 无；父会话只有扁平 children 列表（session:63）；main 的 parseAgentTaskGraph 未接入（S/agent-coordination.ts:641） | dsh agent-team：DAG、revision 比较并交换、blockedBy 无环、writeScopes 重叠告警 [ds:d-team]；Claude Code 认领在文件锁内读-查-写 [cc:L12] | 0 | 见第 5 节 |
| S15 Agent Teams | 一个根加至多 3 个子，角色写死（root、read_only、isolated_coding），子任务之间不通信（tools:73） | Cline v4 团队运行时：共享任务、认领、邮箱、mission log [oh:C-multi][oh:C-teamtypes] | 1 | 暂不建议做长期团队 |
| S16 Team Protocols | 父子结果有结构：await_task 返回状态、发现和修订 digest，report_findings 带来源哈希，merge_task 绑定父修订（harness:239-245，tools:53,110-113） | Claude Code 15 种结构化消息，Zod 校验，request_id 关联 [cc:L16]；Cline mission log 带 evidence 和 nextAction [oh:C-teamtypes] | 2 | 协议无版本号；没有计划审批之类的请求-响应 |
| S17 Autonomous Agents | 无，每个会话由人在 build 节点启动并授权（harness:374-391） | Codex goal：空闲时续跑，同一阻塞连续 3 轮才允许标 blocked [cx:C47][cx:C48] | 0 | 暂不建议做 |
| S18 Worktree Isolation | B/C/D/V：C 是新 `git init` 的私有仓库，不带宿主 gitdir、remote、alternates；D 只在批准后事务写入；V 每次从冻结字节新建；每个子任务一个 C（ws:115-140,178-206，evid:96-100） | Claude Code worktree，隔离期间拦截指回主 checkout 的编辑和 git 命令 [cc:D21]；OpenHands 子会话默认独立 worktree [oh:O-child] | 4 | C、V 各装一次依赖；快照上限 2 GiB、200,000 个文件（ws:97） |
| S19 MCP | 本地 stdio MCP 经 call_mcp 间接调用，每次调用人批，先写意图收据，未知不重放（ext:39-100） | Claude Code 工具定义默认延迟加载，输出默认上限 25,000 token，项目 .mcp.json 要先信任 [cc:D18]；Codex 按 destructive/read-only 注解决定审批 [cx:C61] | 2 | 没有经 v3 工具层的测试；r8 0 次调用 |
| S20 Comprehensive | 以 CodingExecutor v3 挂进 build 节点，前有澄清和设计 Gate，后有测试、PR、验收；每次模型调用经团队预算准入（harness:490，E/main.ts:1992-2030） | Codex 的 TUI、exec、app-server、SDK 共用同一个 Session 和 turn 循环 [cx:C1][cx:W3] | 2 | 草稿未合入；发布门槛未达到（live:29） |
| **补充方面** | | | | |
| E1 沙箱 | 默认 trusted_local 不是 OS 沙箱，只做最小环境变量和进程组终止；container 用 digest 固定镜像、cap-drop ALL、只读根、可断网，缺镜像不回退（runner:116,173-188） | Codex：macOS Seatbelt deny default，Linux bubblewrap 加 seccomp，可写根里 .git、.codex 只读 [cx:C63][cx:C64][cx:C67]；dsh 沙箱不可用就报错、不降级 [ds:d-sbx] | 2 | 真实评测全在 trusted_local；被允许的命令能读用户全部文件、能联网 |
| E2 编辑格式 | apply_patch 唯一片段替换，必须带读取时的文件哈希；先写含前后哈希的效果日志再落盘，重启按日志对账（tools:84-104,158-169） | Codex apply_patch 由 Lark 语法约束、可跨文件，定位逐级放宽到标点归一 [cx:C70][cx:C73]；OpenCode 1.18 编辑后附 LSP 错误 [op:A21] | 3 | 一次只改一处（r8 apply_patch 119 次）；没有编辑后诊断 |
| E3 代码检索 | 目录、glob、正则检索（worker 内 1 秒超时）、TS LanguageService 查符号和引用（E/coding-repository-query.ts:7-67） | Aider 用 tree-sitter 标签加 PageRank 生成仓库地图，按 token 预算二分 [oh:A-rm]；Claude Code 宽范围搜索交给 Explore 子 Agent [cc:D32] | 2 | 每次 read_file、glob、search 都重读并哈希整棵候选树（tools:151,155,215） |
| E4 持久化与撤销 | 会话 JSON 存 SQLite，版本号 CAS；解析层强制 transcript 和收据只追加、终态不能复活；重启先对账命令与子任务再恢复（session:126-142，harness:540-574） | OpenCode 每步在独立 git 目录拍快照，revert 后可 unrevert [op:A19][op:A20]；Claude Code /rewind 分别恢复代码和对话 [cc:D5] | 3 | 恢复强，撤销没有；拒绝修订不回滚 C（harness:441-446） |
| E5 模型适配 | 手写 Chat Completions；原生工具只对 api.deepseek.com 的 deepseek-flash 开启；reasoning_content 随历史回传（S/agent-review.ts:2316-2330,2418） | dsh 同模型才回放 thinking 签名，step 开始时冻结 provider、model、思考强度 [ds:d-think][ds:d-loopreadme] | 2 | 只支持一个模型；SSE 不推给界面 |
| E6 缓存、成本、预算 | 运行状态放末尾，前缀稳定；每次调用预留、发送、结算；根与子预算在同一 API 准入事务里核算，Postgres advisory lock（S/model-call-budget.ts:32-39,75-95） | OpenHands max_budget_per_run 覆盖压缩等全部 LLM 调用 [oh:O-budget]；Codex 记录每次缓存失效的原因 [cx:C88] | 4 | 预留按 1,048,576 输入全未命中计，约 $0.393/次，r8 两题因此被拒；token 上限把缓存命中也算进去 |
| E7 工具输出 | 各工具分页；命令输出全量落盘（≤64 MiB）再分页；结果超 256 KB 报 result_too_large（tools:269-273，runner:202,258-289） | dsh 单个结果内联 ≤12,500 token，超出给头尾和文件路径 [ds:d-spill]；OpenCode 截断后全文存盘并提示怎么读 [op:A7] | 3 | 没有通用落盘，超限直接失败 |
| E8 人工介入 | request_user_input 持久等待；steer 任意时刻排队、在步边界注入，objectiveVersion+1 使旧问题、权限、子任务和批准失效（loop:45-74，harness:392-399） | OpenCode 2.x inbox 区分 steer 与 queue 并持久化 [op:B3]；Claude Code 计划模式，提问可设超时 [cc:D2][cc:S105] | 3 | 没有计划模式；提问无超时；r8 模型 0 次提问 |
| E9 完成判定 | 普通文本不算完成；propose_changeset 冻结修订，人批准时逐条确认验收条目，宿主事务写 D、在 V 跑保存的测试，V 前后摘要须等于目标（harness:447-482，evid:104-111） | Anthropic harness 的 evaluator 实际操作应用、每项硬阈值 [ma:S100]；OpenHands critic 低于 0.6 再迭代 [oh:O-critic]；Claude Code /goal 由新模型判定 [cc:D10] | 2 | 只看公开测试，r8 报告完成 5 次全错；没有独立验证者 |
| E10 不可信内容 | system 声明文件、网页、工具文本是低信任；Skill 标 instructions_only，网页标 untrusted；结构化叶子脱敏；网页只许配置的 HTTPS origin，拒私网和跨域重定向（S/redaction.ts:27-90，E/coding-public-documents.ts:7-54） | Claude Code 服务端探针扫描工具结果，审批分类器不看 assistant 文本和工具结果，子 Agent 报告转义伪造标签 [cc:A1][cc:S1] | 3 | 没有注入实验，没有工具结果隔离标记 |
| E11 观测与评测 | 会话存每次 attempt、收据、授权与审计；评测脚本加 31 道合格题，独立验收用评测方持有的参考断言（docs/evaluation/README.md） | Anthropic 建议同时评 transcript 与结果，区分 pass@k 与 pass^k [cc:A6]；dsh 回放录制会话做确定性测试 [ds:d-replaytest] | 3 | 31×3 对照没做完；没有回放测试和 trace 导出 |
| E12 运行方式 | 只在 Electron 内经 IPC 运行；评测脚本直接 import 生产模块，不是对外接口（E/main.ts:4134-4152） | Codex exec --json、--output-schema 与 app-server JSON-RPC [cx:C98][cx:W3]；Pi 的 print、JSON、RPC、SDK 共用一套机制 [op:P29] | 1 | 没有 CLI、SDK、ACP |
| E13 项目指令 | 根 AGENTS.md（缺失时 CLAUDE.md）放进简报；宿主 profile 配容器和网络（E/repository-knowledge.ts:412-414） | Codex 从项目根到 cwd 逐层拼 AGENTS.md，总预算 32 KiB [cx:C100][cx:C24]；Claude Code 子目录 CLAUDE.md 按需加载 [cc:D14] | 2 | 不读子目录 AGENTS.md；步数、批次等限额不能配置 |

**分布**：4 分 3 项（S01、S18、E6）；3 分 9 项（S06、S10、S13、E2、E4、E7、E8、E10、E11）；2 分 13 项（S02、S03、S08、S09、S11、S16、S19、S20、E1、E3、E5、E9、E13）；1 分 3 项（S07、S15、E12）；0 分 5 项（S04、S05、S12、S14、S17）。平均 2.06。按层：工具与执行 2.0，计划与控制 1.8，记忆 2.0，并发与调度 1.5，多 Agent 平台 1.6，补充方面 2.5。
高分都在"副作用和花费可信"这条线上。0 分集中在扩展和自主能力；其中 S04、S14、S17 建议继续保持 0，S05、S12 要补。任务管理（S05、S12 为 0，S06 机制 3 分但真实 0 次使用）和权限（S03、E1 为 2）都低于平均。

## 4. 强项

1. **副作用先写收据，恢复时对账而不重放。** 工具 started 收据（loop:280-286）、编辑效果日志（tools:84-104）、命令收据落盘后 worker 才收到 go（runner:76-114,249）、MCP 意图收据（ext:69-71）；重启按收据判 completed、not_executed 或 unknown（tools:334-363），孤儿 worker 先用随机 token 认证再终止（runner:304-345）。参考：dsh 在模型请求和工具执行前落盘，失败就不执行 [ds:d-ckpt]，step 失败给未答调用补"结果未知" [ds:d-recover]；OpenCode 2.x 启动时结算遗留调用 [op:B1]。v3 多了 worker 的 go 握手和孤儿认证。
2. **模型调用不假装 exactly-once。** attempt 先落盘再发送；交付未知进 reconciling，人确认可能重复计费后才 retry_unknown；迟到回复只记用量（loop:120-124,155-170,201-210，harness:435-440）。参考：Claude Code 在已完成工具调用后断流时不重发，思路相近 [cc:D22]；OpenCode 1.18 可重试错误不限次数 [op:A3]，dsh always 模式无上限且每次计费 [ds:d-retry]。把交付未知做成持久状态并要人确认的，六份报告里只有 v3。
3. **单写者有进程级证明。** epoch CAS 取得写者（loop:105-118），接管前要求旧 PID 已不存在、命令已对账（harness:173-176），代码注释写明"租约过期本身不能证明旧写者已停"。参考：OpenCode 靠进程内的 ensureRunning 保证同一会话一个 runner [op:A4]。
4. **批准的是冻结修订，验证在新建目录里做。** 修订内容寻址、用 link 发布、同 ID 不能覆盖（ws:221-256）；批准绑定 digest、objectiveVersion、policyVersion，10 分钟内须开始应用（harness:447-464）；D 用预写事务，只回滚能证明属于本事务的字节（evid:25-62）；测试前后 V 的摘要都须等于目标，测试改了源码即 evidence_invalid（evid:104-111）。参考：Claude Code 的检查点不跟踪 Bash 改动 [cc:D5]；六份报告的参考里，没有把人对最终改动的批准绑定到内容摘要的做法。
5. **子任务隔离与三方合入。** 子任务在冻结基线的独立 C 上工作，父任务显式 merge_task，用 `git merge-file` 对当前父字节合并，冲突不写入，合并日志防重复应用（merge:13-70）。参考：Claude Code、OpenHands 给子 Agent 独立 worktree，合并留给人或主 Agent [cc:D21][oh:O-child]；Kimi Tower 只合并通过检查的分支 [cx:K7]。
6. **根/子预算在同一事务准入。** 未结算和未知费用按预留计入，Postgres advisory lock 防并发超领（S/model-call-budget.ts:75-95，apps/api/src/repositories/postgres-team-repository.ts:1963-1969）。参考：Claude Code maxBudgetUsd 在每次响应后比较，可能超出一次响应 [cc:D12]；OpenCode、Pi、dsh 没有金额预算 [op:B22][op:W1][ds:d-meter]。
7. **缓存前缀稳定，并做过对照实验。** 运行状态插在最后一条 JSON 工具结果的右括号前（context:26-30）；#239 对照命中率 0%→84.92%、费用 ¥0.3816→¥0.1118，r8 会话命中 97.4%。参考：Claude Code 静态/动态分界 [cc:L10]，dsh 工具只增不删 [ds:d-models]。
8. **插话会作废旧决定。** steer 在步边界注入，objectiveVersion+1，待答问题、待批权限、活动子任务和旧批准一起失效（loop:57-74，harness:392-399）；interactive 的 steering 场景 r1–r6 全过。参考：OpenCode 2.x 和 Pi 都有 steer 队列 [op:B3][op:P2]，但没把它和批准绑定。

## 5. 任务管理与权限控制

### 5.1 任务管理

**现状**
- 计划只存在于模型正文和 reasoning 里，会话没有计划字段（session:16-64）。长任务每题 54–80 步，22 次观测里 4 次用满 80 步。
- 委派机制完整（S06），但对照题 0 次使用；只在场景明确要求时用（interactive 每轮 2–3 次）。子任务的问题交给人，不交给父任务（harness:244）。
- 后台命令在持久 worker 里跑，模型用 read_command 轮询；子任务与父任务并行。
- 完成只认"人批准加公开测试通过"。验收条目来自已批准澄清（harness:505），只由人在批准时勾选（harness:455-457），评测里由操作者代批（live:25）。

**参考对照**

| 方面 | Claude Code | Codex | OpenCode | dsh | OpenHands | Cline |
|---|---|---|---|---|---|---|
| 计划/待办 | TaskCreate 或 TodoWrite，新模型默认不给；3 项以上完成无验证项时提醒 [cc:S105][cc:L5] | update_plan，至多 1 个 in_progress，只发事件 [cx:C21] | todowrite 整表替换，子代理默认禁用 [op:A40][op:A13] | todo_write 跨 turn、重开保留 [ds:d-todo] | TaskTracker，可写 TASKS.md [oh:O-tracker] | v3 的 focus chain 存 markdown，v4 已移除 [oh:CL-focus][oh:C-legacy] |
| 任务图 | blocks/blockedBy，认领在文件锁内读-查-写 [cc:L12] | 无 [cx:C21] | 无，2.x 的 goal 不是 DAG [op:B24] | 实验 agent-team：DAG、revision CAS、writeScopes 告警 [ds:d-team] | 无，只跟踪子任务状态 [oh:O-taskmgr] | dependsOn 推出 isReady/blockedBy，claim/complete/block [oh:C-teamtypes] |
| 委派是否被用 | 按 description 选；claude_code 预设要求未被要求时不派 [cc:S1][ma:S5] | 只在用户明说或 AGENTS.md、skill 要求时派 [ma:S7] | task 描述里列出可派子代理，深度 1 [op:A14] | workflow 工具要求用户明确要求才用 [ds:d-wf] | delegate ≤5 个，task 可续跑 [oh:O-delegate][oh:O-taskmgr] | spawn_agent 阻塞到子代理结束 [oh:C-spawn] |
| 后台任务 | run_in_background，完成通知进下一轮 [cc:L13] | exec 超过 yield 返回 session_id，write_stdin 轮询 [cx:C51] | 2.x background:true，job 表持久 [op:B8][op:B27] | jobs：忙则下一步通知，闲则唤醒 [ds:d-jobs] | 终端 30 秒无输出软超时返回 [oh:O-term] | team_run_task 异步，team_await_runs [oh:C-teamtools] |
| 完成判定 | /goal 由小模型读对话判定；Stop hook 退出码 2，≤8 次 [cc:D10][cc:D13] | goal 无剩余必要工作才能 complete；review 输出 JSON [cx:C47][cx:C96] | 2.x goal 独立评审 done/continue/wait，≤50 轮 [op:B24] | goal ≤256 轮；ralph 的报告不验证 [ds:d-goal][ds:d-ralph] | Stop hook 可否决；critic 低于 0.6 再迭代 ≤3 次；/goal ≤10 轮 [oh:O-run][oh:O-critic][oh:O-goal] | 无工具调用即完成，先注入提醒 [oh:C-loop] |

三点读法。待办清单不是共识：Claude Code 对新模型默认关掉，Pi 认为它增加模型要维护的状态 [op:W1]。没有一个系统靠"给一个委派工具"就得到模型主动委派。完成判定的共同方向是交给不干活的一方，形式有读对话的新模型、critic 打分、可执行检查（Goose recipe、Trae must_patch [oh:G-retrytypes][ds:t-done]）。

**v3 目标设计**
1. **计划和任务图合成一个宿主状态 `session.plan`。** 节点形如 `{id, title, kind: investigate|implement|verify, owner, dependsOn[], acceptanceRefs[], writeScope[], status, evidenceRefs[]}`；限额沿用 parseAgentTaskGraph（≤12 节点、≤24 边、无环，S/agent-coordination.ts:10-19,641-769）。新工具 `update_plan` 整体提交或打补丁，版本只追加。宿主校验：已完成节点不可改；标 done 必须引用存在的收据或命令 id；verify 节点只有宿主能改；propose_changeset 前每个 implement 节点须为 done 或带理由的 dropped。计划摘要放进运行状态 JSON（context:9-30），不动前缀；面板显示。不另做 TodoWrite。
2. **委派挂在计划上，但不强迫。** delegate_task 必须给 planNodeId，结果回写该节点；互不依赖的 investigate 节点可并行（≤3）。system 写明触发条件，例如要读 10 个以上文件或有 3 个以上互不依赖的问题 [ma:S116]。fork 式只读子任务复用父前缀，降低委派成本（第 6 节 #10）。下一轮付费评测统计使用率和效果再调。
3. **后台命令完成后由宿主唤醒**，沿用子任务的通知方式（harness:277-283），代替轮询。
4. **独立验证者由宿主插入，不由模型决定。**
   - 开工授权后，宿主拿已批准澄清的验收条目（harness:505）启动 verifier 子任务：只读 B，外加一个只能写验证者私有目录的工具。它与实现者并行工作。
   - 每条检查标为"新行为"（在 B 上应失败）或"保持行为"（在 B 上应通过）。宿主先在 B 上跑一遍核对标签，再冻结检查和它们的运行命令（运行命令第一次执行前出一张权限卡）。
   - 检查放在 C 之外。实现者的文件工具只能读 C（tools:80-83，ws:22-46 拒绝 `..` 和绝对路径）；trusted_local 下读它要新命令、要人批，进沙箱后由沙箱拒读该目录。
   - propose_changeset 之后，宿主先在从冻结字节新建的目录里跑公开测试和隐藏检查，不碰 D。不通过就回到 ready，只告诉模型哪条验收条目没过、观察到什么，不给检查源码；最多 2 轮修复（参考各家 3 轮左右的上限 [cc:D10][oh:O-critic][cx:C48]），之后暂停等人。
   - 通过后才进入人工审查，面板按验收条目显示结果。批准后的 D/V 流程不变；隐藏检查放进第二个验证目录，按"目标加检查"的合并摘要核对，不改 evid:104-111 现有判断。
   - 实现者和 lead 都不能推翻结论；人可以用 manual_accepted 写明理由放行，作为 Gate 例外。
5. **与之前多 Agent 结论的关系：一致。** 之前的结论是 lead 写可校验的任务图、角色由宿主登记、验证者在实现前写好检查且实现者看不到、Gate 是 lead 必须请求的检查点、交付分支单写者 [ma:可直接借鉴的设计 1、2、5、7、9][da]。差别只在顺序和范围：先在编码节点内做验证者和计划（v3 已有的 propose_changeset→review 就是"必须请求的检查点"，D 只由宿主写入就是单写者）；第一版只做无环 DAG，不做循环和等待节点；Run 级 lead、followup 类原语放到阶段 3 之后。拆法和顺序由模型写，宿主只强制验证节点、Gate 和单写者，所以不会退化成写死的流程。

### 5.2 权限控制

**现状**
- 已有三层：开工授权（选执行方式，核对输入和依赖计划，harness:374-391）；运行中的权限卡（新 argv 命令、依赖计划变化、网络 origin、MCP 调用，按 `{kind, value}` 摘要加 objectiveVersion 匹配，生效 1 小时，E/native-coding-permissions.ts:12,17）；最终修订由人批准（harness:447-458）。
- 没有规则、作用域和模式。同一条命令换个超时也要重批，因为摘要包含超时。面板只有"允许这次操作/拒绝"（Panel:67-69）。
- 子任务的权限卡显示在嵌套的子任务面板里（Panel:85），父任务只看到 pendingChild（harness:244）。interactive r5 就因驱动没处理子任务权限卡而失败。
- trusted_local 不是沙箱（runner:116）：允许一条命令，就等于允许它以用户身份读写和联网。r8 有 4 个会话申请 corepack（2 次）、bash、git，按评测规则全部拒绝。

**参考对照**

| 方面 | Claude Code | Codex | OpenCode | dsh | OpenHands | Cline |
|---|---|---|---|---|---|---|
| 规则引擎 | `Tool(specifier)`，deny→ask→allow 首个命中，任一作用域 deny 生效，复合命令逐段匹配 [cc:D3] | exec policy `prefix_rule`：allow/prompt/forbidden，match/not_match 加载时自检 [cx:C15] | 有序规则取最后匹配；tree-sitter 拆子命令；"总是允许"只存前缀 [op:A11][op:A10] | pre-execute 给 allow/deny/ask，之后单调 guard 只能拒绝 [ds:d-pipe][ds:d-guard] | 风险四级加 Always/Never/ConfirmRisky [oh:O-risk][oh:O-policy] | 每工具 ToolPolicy 加宿主审批回调，没有回调就拒绝 [oh:C-policy][oh:C-approval] |
| 模式 | default、acceptEdits、plan、auto、dontAsk、bypassPermissions；auto 为交互默认 [cc:D2] | 审批 on-request（默认）/granular/never × 沙箱 read-only/workspace-write/full [cx:C12][cx:C13] | build 与 plan agent；run 未加 --auto 时自动拒绝 [op:A12][op:A39] | 三档预设，默认 workspace-write 加 ask [ds:d-perm] | 会话默认 NeverConfirm [oh:O-state] | act/plan/yolo，plan 守卫硬拦改文件的命令 [oh:C-guard] |
| OS 沙箱 | Seatbelt/bubblewrap，写限工作目录，网络经代理白名单 [cc:D4] | Seatbelt deny default；bubblewrap 加 seccomp；.git、.codex 只读 [cx:C63][cx:C64][cx:C67] | 无 [op:B34] | bwrap→Landlock、Seatbelt、Windows ACL，不可用即报错 [ds:d-sbx] | Docker 或远程 workspace [oh:O-docker] | 未见 |
| 子任务审批 | 后台子 Agent 的请求在主会话弹出并注明来源 [cc:S1] | 文档说子 Agent 继承父会话沙箱与审批 [ma:S7] | 子会话只继承父会话的 deny 和外部目录规则 [op:A13] | 子 agent 不能 ask_user_question；无应答即拒 [ds:d-ask][ds:d-approval] | 报告未涉及 | spawn_agent 继承工具策略与审批回调 [oh:C-spawn] |
| 无人值守 | `--permission-prompts none` 移除要人回答的工具 [cc:D11] | never：失败直接回给模型 [cx:W1] | 2.x Unattended 时 ask 变 deny [op:B9] | 无应答者即拒绝 [ds:d-approval] | 报告未涉及 | 只有 --auto-approve 或 --yolo 才自动批准 [oh:C-cli] |

**v3 目标设计**
1. **先上 OS 沙箱。** 新增 `sandboxed_local` 作为默认执行方式，trusted_local 保留为显式选择。macOS 用 `/usr/bin/sandbox-exec`，策略 deny default，只许写 C 或 V、私有 HOME 和临时目录 [cx:C63]；Linux 用 bubblewrap，只读挂 `/`，C 和临时目录可写，断网 [cx:C64]，不可用时退到 Landlock [ds:d-sbx]；沙箱起不来就报错停下，不降级到无沙箱。Windows 继续用 container，或人在开工时明确选择不受保护。网络默认关；依赖准备已有单独的 dependencies 权限，只在这一步开网。命令 worker（runner:155-256）和 MCP stdio 进程都在沙箱里起。选 OS 沙箱而不把 container 设为默认，是因为桌面用户不一定装了 Docker，C 和 V 还要各装一次依赖；Codex、Claude Code、dsh 本地也都选 OS 沙箱。
2. **规则引擎**（扩展 E/native-coding-permissions.ts）。规则形如 `{kind:'command', prefix:['git',['status','diff','log']], decision:'allow', scope:'project', justification, match:[['git','status']], notMatch:[['git','push']]}`。
   - v3 的命令本来就是 executable 加 args 数组，不需要像 Claude Code、OpenCode 那样解析 shell；`bash/sh -c` 包装一律 ask（Claude Code 对解析不了的命令要求审批 [cc:D2]）。
   - 求值：任一作用域 deny 即拒；再看 ask；最后 allow；无命中等于 ask [cc:D3]。保存的批准盖不过配置的 deny [op:B9]。样例在加载时校验，当单元测试用 [cx:C15]。
   - 作用域分 policy、project、session。团队策略只能加 deny 或 ask，不能加 allow（ADR 0019:41，能力只能收窄）。allow 只在 sandboxed_local 或 container 下生效，trusted_local 下只认 deny 和 ask。
   - 默认规则：C 是没有 remote 的私有仓库（ws:115-140），所以 git status/diff/log/add/commit 默认允许，git push/remote 默认拒绝；包管理器下载（如 corepack）归网络权限。
   - 权限卡加一个按钮"本任务内允许此前缀"，写 session 规则；前缀默认取模型在调用时提出的（Codex 的 prefix_rule 参数 [cx:C51]），人可以改短。
3. **三种模式**：ask（现状，trusted_local 下唯一可用）；sandboxed（规则内自动执行、规则外问，新默认）；unattended（评测和以后的后台运行，ask 一律变 deny [op:B9]；r8 的"冻结规则全部拒绝"就是这种模式）。不做模型审批分类器（第 6 节）。
4. **子任务审批冒泡。** 子任务的权限请求在根任务面板置顶，注明"来自子任务 X（隔离编码）"，决定写回子任务会话。"本任务内允许"写到根任务的 session 规则，隔离编码子任务继承；子任务只能继承、不能放宽；只读子任务仍然拿不到命令（tools:73）。参考 Claude Code 冒泡 [cc:S1] 和 OpenCode 子会话只继承 deny [op:A13]。
5. **与现有审批和预算衔接。**
   - 开工授权多记三项：规则集摘要、沙箱档、模式。任务中途改规则只能收窄，放宽要重新授权。
   - 一次性批准仍随 objectiveVersion 失效（E/native-coding-permissions.ts:12）。session 规则跨插话保留，因为它描述的是命令，不是目标。
   - 自动放行的命令照样写收据、签一次性授权，审计里记命中的规则 id（tools:316-331）。
   - 最终修订、计划审批、retry_unknown 永远由人决定，规则管不到。预算准入不变：命令不花模型钱，规则也不能放宽预算。

## 6. 改进计划

| # | 级 | 改什么 | 为什么（证据） | 参考实现 | 规模 | 怎么验证（付费？） | 价值 产品/学习/面试 |
|---|---|---|---|---|---|---|---|
| 1 | P0 | 合入 main；v3 的迁移改为 42，并兼容已写到草稿 41 的库 | 两边 CURRENT_SCHEMA_VERSION 都是 41（E/local-store-schema.ts:5）：v3 的 41 建 native_coding_sessions 和 Hindsight 表（:2960），main 的 41 建 project_memory_*（main :2962）；草稿库会跳过 main 的 41，v3 在 39 上踩过同样的坑（v3 :2962-2964 的注释） | v3 处理 39 冲突的写法：`create table if not exists` 补建 | 1 个迁移加测试约 60 行；合并冲突量未知 | 迁移测试覆盖从 40、main 的 41、草稿 41 三种库升级；`corepack pnpm verify`；`node scripts/native-coding-electron-smoke.mjs --harness-v3`；不付费 | 高/低/中 |
| 2 | P0 | 独立验证者、隐藏验收检查、最多 2 轮修复（5.1 第 4 条） | E9 2 分；r8 报告完成 5 次全错；对照 27 次 0 次通过 | Anthropic harness evaluator [ma:S100]；Factory 验证契约 [ma:S126]；OpenHands critic [oh:O-critic]；DeerFlow acceptance_checks [ds:f-acc] | 约 450 行（harness、tools、evid、session、Panel）加 300 行测试 | 脚本化模型的 lifecycle 测试：公开测试过、隐藏检查不过就不进审查；在 B 上核对标签。付费：重跑 r8 的 10 题，约 $1–2，目标错误成功 0 | 高/高/高 |
| 3 | P0 | 瞬时错误重试与错误分类：未计费的 429/503 和未发送的连接错误退避重试（遵守 Retry-After，≤5 次）；5xx ≤2 次，每次重新预留；超时仍走 reconciling；402、401 单独的暂停原因；无效工具批重问 1 次；无进展先提示一次再暂停 | r6/r7 7 次 402 显示为 invalid_model_response；r8 07 一次无效工具批就结束；无进展直接暂停（loop:199，plan:401 设想过先反馈） | Codex responses_retry [cx:C44]；dsh llm-retry [ds:d-retrysrc]；DeepSeek 错误码 [cx:D9]；OpenHands 卡死检测先提示 [oh:O-stuck] | 约 150 行（loop、S/agent-review.ts:2516-2555 映射、暂停原因、面板文案）加 150 行测试 | 假 Provider 单元测试逐个错误码；不付费 | 高/中/中 |
| 4 | P1 | trusted_local 进 OS 沙箱，sandboxed_local 设为默认，失败即停（5.2 第 1 条） | E1 2 分；真实评测全在 trusted_local；被允许的命令能读用户全部文件 | Codex seatbelt 策略 [cx:C63]、bwrap 加 seccomp [cx:C64]、受保护路径 [cx:C67]；dsh sandbox-local [ds:d-sbx]；Claude Code 沙箱使内部提示减少 84% [cc:D4][cc:A2] | 新文件约 250 行，runner 改约 40 行，加测试 | macOS、Linux CI：写 C 外被拒、读 ~/.ssh 被拒、无网、起不来时报 SANDBOX_UNAVAILABLE；不付费 | 高/高/高 |
| 5 | P1 | 规则引擎、三种模式、"本任务内允许"、子任务权限冒泡（5.2 第 2–5 条），依赖 #4 | S03 2 分；每个新 argv 都要点；r8 4 个会话申请额外命令；interactive r5 因子任务权限卡失败 | Codex prefix_rule [cx:C15]；Claude Code 规则顺序 [cc:D3]；OpenCode 2.x 求值与 Unattended [op:B9]；Claude Code 冒泡 [cc:S1] | 约 350 行（permissions、tools:304-314、harness 授权、Panel、共享类型）加 250 行测试 | 规则表单元测试（含样例自检）；lifecycle 测试子任务请求出现在根任务；Electron smoke 看卡片；不付费，下轮付费评测顺带统计每题提示数 | 高/高/高 |
| 6 | P1 | 宿主持久化的计划/任务图 update_plan（5.1 第 1–2 条） | S05、S12 0 分；长任务 54–80 步，4 次用满 80 步；委派 0 次 | Codex update_plan [cx:C21]；dsh agent-team [ds:d-team]；Cline 团队任务 [oh:C-teamtypes]；自己的 parseAgentTaskGraph | 约 300 行加 200 行测试 | 单元测试：无环、≤12 节点、完成节点不可改、done 须有证据；Panel 测试。付费 A/B 看步数和独立通过率 | 中/高/高 |
| 7 | P1 | 同批只读工具有限并发（4），结果按调用顺序写回 | S02 2 分；r8 23% 轮次一次多调用；plan:399 写了并发 4，实际单队列 | Claude Code partitionToolCalls [cc:L2]；Codex 读写锁 [cx:C8]；dsh batch [ds:d-batch]；Pi 按序写回 [op:P1] | 约 150 行（executePending、队列、授权记录批量写入）加测试 | 慢速假读工具：并发 ≤4、transcript 顺序不变、杀进程后收据完整；不付费 | 中/高/中 |
| 8 | P1 | 候选树清单增量计算：按 size、mtime、inode 缓存文件哈希 | 每次读和检索都重哈希整棵树（tools:151,155,215；ws:81-108,158） | OpenCode 用 git 索引 write-tree 拍快照 [op:A19]；Claude Code 重复读未变文件返回占位 [cc:L8] | ws 约 100 行加测试 | candidate-workspace 测试；在 deep 场景的 605 文件仓库上对比单次读耗时；不付费 | 中/中/中 |
| 9 | P1 | 预算预留按实测请求大小算；token 上限不计缓存命中，金额上限不变 | 预留约 $0.393/次，r8 10、11 两题因余额低于一次预留被拒；r8 03 用了 8,428,817 token，多为缓存命中 | 请求已按真实序列化度量（E/native-request-budget.ts:4-10）；DeepSeek 价格 [cx:D2] | S/model-call-budget.ts 约 40 行加测试 | API model-call-budget 测试（现 9 例）加用例，`corepack pnpm test:budget-postgres`；不付费 | 中/中/中 |
| 10 | P2 | fork 式只读子任务，复用父任务前缀命中缓存 | 子任务首条消息是新拼的 JSON（harness:225）；flash 命中价约为未命中的 1/50 [cx:D2] | Claude Code fork 五项字节一致 [cc:L6]；dsh subagent_fork 不给换模型参数以复用 KV cache [ds:d-subbase] | 约 150 行 | 用 scripts/native-coding-cache-probe.ts 测子任务首个请求的命中率；小额付费（几美分） | 中/高/高 |
| 11 | P2 | 命令完成事件唤醒，代替 read_command 轮询 | r8 read_command 51 次；live 问题 1 曾因轮询耗尽步数 | Claude Code 完成通知 [cc:L13]；dsh jobs [ds:d-jobs] | 约 100 行，沿用 harness:277-283 | lifecycle 测试；不付费 | 中/中/中 |
| 12 | P2 | 通用大结果落盘：超限给头尾和读取方式，不再报错 | 超 256 KB 直接 result_too_large（tools:269-273） | dsh spill-policy [ds:d-spill]；OpenCode Truncate [op:A7] | 约 80 行 | 工具层单元测试；不付费 | 低/中/低 |
| 13 | P2 | 用户可见的撤销：C 每步提交，拒绝时可回到指定修订 | 拒绝修订只回 ready，不回滚 C（harness:441-446） | OpenCode snapshot/revert/unrevert [op:A19][op:A20]；Cline v4 stash 加私有 ref [oh:C-ckpt] | 约 200 行 | candidate-workspace 测试加 Electron smoke；不付费 | 中/中/中 |
| 14 | P2 | Skill 目录写进简报；进入子目录时加载该目录 AGENTS.md；补测试 | S07 1 分（0 次调用、无测试）；plan:181 设想过子目录 AGENTS.md | Codex 技能预算 2% [cx:C28]、AGENTS.md 逐层拼接 [cx:C100]；OpenCode 读文件时附目录指令 [op:A31] | 约 150 行 | 单元测试；不付费 | 中/中/低 |
| 15 | P2 | 无界面运行入口，加用录制会话回放的确定性测试 | E12 1 分；付费测试暂停，回放能不花钱做回归 | dsh llm-replay [ds:d-replaytest]；Codex exec --json [cx:C98] | 约 300 行（正式化 scripts/native-coding-trial-live.mts，加回放 Provider） | CI 里回放 r8 会话，结果与原记录一致；不付费 | 中/高/高 |

权限排在 P1 而不是 P0：权限现在的问题是偏严、难用，不是不安全；完成判定的问题是会把错的当成对的（r8 5/5）。沙箱和规则要一起做，因为没有沙箱时放行规则等于交出整个用户账号。

**暂不做，以及原因**
- Cron（S14）和自主认领（S17）：v3 每次都要人授权开工（harness:374-391），这是 Gate 模型的一部分；Claude Code 的 cron 只在会话内、7 天过期 [cc:D20]，OpenCode 2.x 的 schedules 还是实验 [op:B26]。
- 带邮箱的长期团队（S15、S16）：委派真实 0 次；并行写者的证据是负面的 [ma:S103][ma:S104][ma:S114]；Claude Code teams 仍是实验，有 lead 不等队友等已知问题 [ma:S2]。
- 用户可配置 hooks（S04）：项目内 hook 是注入面，Claude Code 曾在信任框之前执行项目 hook [cc:A3]；"结束前检查"由验证者承担。
- 多 Provider 抽象（E5）：v3 依赖精确序列化和 DeepSeek 的 reasoning、缓存规则；Pi、OpenCode 2.x 都写了完整的 provider 层 [op:P21][op:B20]。真要第二个模型时再做。
- 模型审批分类器：Claude Code 自报对真实越权漏报 17%（n=52）[cc:A1]；OpenHands 的 LLM 分析器直接采信模型自报的风险 [oh:O-llmrisk]；dsh auto-review 自述可能放行不安全操作 [ds:d-auto]。先做沙箱和规则。
- 旧工具结果裁剪：DeepSeek 只认完整前缀单元 [cx:D6]，改写历史会丢缓存；真实峰值 179k，远低于阈值；OpenCode 2.x 也删了 prune [op:B15]。
- 读对话的 /goal 式判官：可执行的隐藏检查是更硬的证据，读对话的判官会被同样的自报误导。
- 默认上传会话日志（dsh 的做法 [ds:d-wire]）：v3 不上传，保持。
- Pi 只有 4 个默认工具、系统提示约 2.5 KB，刻意不做权限、子代理、计划模式和后台 bash [op:W1][op:P4]；mini-SWE-agent 只有 bash、历史只追加、不压缩 [oh:M-readme]。它们说明每个功能都要靠评测证明值得。v3 根任务每次请求带 34 个工具定义，r8 里工具 JSON 有 18,118 字符；新能力优先放进已有结构（计划进运行状态，验证复用 V），少加工具。

## 7. 路线图

**阶段 1：合入与稳固（约 1–2 周，不需要付费）**
- 目标：v3 能合入 main；一次瞬时错误不再结束整题；读工具不再白白排队。
- 内容：#1、#3、#7、#8、#9，另补"缺 reasoning_content 时请求会 400"的回归测试（第 9 节）。先合 main 再加功能：10-29 到 11-01 之间 main 又前进 6 个提交，越晚冲突越多。
- 完成检查：合入后的分支 `corepack pnpm verify` 通过；三种起点的迁移测试通过；`node scripts/native-coding-electron-smoke.mjs --harness-v3` 通过；#3、#7、#8、#9 的单元测试通过；PR #238 转为可评审。是否合入由你决定，合入后 v3 仍只在 `nativeVersion: 3` 时启用。

**阶段 2：完成判定与权限（约 3–4 周，需要付费）**
- 目标：报告完成就意味着通过了实现者看不到的检查；常见命令不必逐条点；子任务的权限请求在根任务处理。
- 内容：#2、#4、#5。
- 完成检查：确定性测试全过；macOS 与 Linux 沙箱测试通过；一轮带验证者的付费评测（r8 的 10 题）错误成功为 0、独立通过至少 1 题，并记录每题权限提示数和验证者开销。
- 付费：按 r8 的 v3 $0.849/10 题，加验证者估计每轮 $1–3，建议预批 2 轮。

**阶段 3：任务管理与编排（约 4–6 周，需要付费）**
- 目标：模型写计划，宿主校验并显示；委派有明确用途；做完 31×3 对照。
- 内容：#6、#10、#11；再按之前多 Agent 结论把 lead 提到 Run 级（宿主登记角色、委派写入前的计划审批、交付单写者）；#12–#15 视时间穿插。
- 完成检查：31×3 对照按独立验收计分，达到发布门槛（live:29）：至少 30 题、错误成功 0、复杂题比 v2 高 10 个百分点、中位 ≤15 分钟、每个独立通过 ≤$10；并与单 Agent 基线比较委派的收益（ADR 0019:77）。
- 付费：r8 一轮（10 题 × 3 个执行器）账面 $2.6584，约 $0.09/次，31×3 一轮约 $8–10；如果缓存回到 r6 水平（v3 单题 $0.57–2.73），会高一个数量级。

## 8. 面试怎么讲

本节按 2026-11-02 第二阶段工程实现与真实评测更新；其余评审与评分保留 2026-11-01 的调查快照。当前实现见[第二阶段记录](../../plans/native-coding-harness-phase2.zh-CN.md)，质量、成本和限制见[真实评测报告](../../evaluation/native-coding-v3-phase2-20261102.md)。下文历史价格、行数与轮次数字不是当前重新测量的结果。

**2 分钟介绍**（第二阶段工程实现；真实质量门槛未通过）
> 我在自己的项目 DevFlow 里写了一个编码 Agent 的 harness，叫 Native Coding v3。初次评审时生产代码约 3,000 行 TypeScript、测试约 1,600 行，没有用 OpenCode 或 Agent SDK，模型是 DeepSeek V4.1 Flash。要解决的问题是：编码 Agent 会真的跑命令、改文件、花钱，进程随时可能被杀，模型还会自己宣布做完了。
> 架构是宿主驱动的持久会话。宿主每次调度一批，最多 12 步；每步先执行上一步留下的工具调用，再经预算准入调一次模型。会话有 14 个状态，存 SQLite，每次修改都比较版本号。代码在四处流转：输入快照、私有候选仓库、真实交付 worktree、每次验证重建的目录。
> 三个设计：一是所有副作用先写收据再执行，重启按收据对账，不确定就停下让人核对，不重放；模型请求超时算可能已送达，不自动重发，避免重复扣费。二是人批准的是内容寻址的冻结修订，绑定摘要和目标版本，中途插话会让旧批准作废；验证目录测试前后的摘要都要等于修订。三是根任务和子任务的预算在团队服务的同一个事务里准入，用 Postgres 咨询锁防并发超领。
> 真实模型的故障演练，包括杀进程、重启、子任务和插话，两轮都是 12/12。把运行状态从 system 挪到最后一条消息后，对照实验里缓存命中从 0% 提到 84.92%，第 8 轮会话是 97.4%。
> 第 8 轮它报告完成 5 次，公开测试都过了，评测方的隐藏断言一次没过，比如 80/81、104/111。因此第二阶段加了独立检查：实现前根据批准需求和原始代码生成、冻结，实现者看不到。人批准修订只是允许验收；公开测试和独立检查都过了才能自动完成，失败最多返修两轮。
> 同时把 macOS/Linux 的系统沙箱设为默认，起不来就停止；权限用 deny、ask、allow 的优先级，任务授权绑定参数、目标版本与有效期。子任务不能扩大权限，改变需求后旧授权不能继续执行。这三项已经合入 V3，跨平台 CI 通过，但主 PR 仍是草稿。
> 真实评测又发现：验证者本身也会错。两道题的参考实现通过外部验收，却被生成检查拒绝，原因包括测试数据用错和生成文件有语法错误。因此我没有把零假完成当成成功：如果所有任务都暂停，它同样可以是零。下一步仍是第二阶段，要核验检查自身的有效性，并把验收器故障和业务失败分开；还不能声称任务成功率提高。

**5 个深入话题**
1. **崩溃与重复**：收据先行、交付三态、epoch 租约加旧 PID 检查、孤儿 worker 认证（loop:105-124，runner:304-345）。能讲为什么不追求 exactly-once、为什么超时算可能已送达；数字：unknown、application、verification 场景真实杀进程，r4、r6 通过。
2. **批准语义**：冻结修订、objectiveVersion、子任务不能批准、10 分钟应用窗口（harness:447-464）。数字：10 元验收里 clarification 11 次、steering 13 次调用通过。
3. **工作区与合入**：B/C/D/V 各自的职责，D 的预写事务只回滚自己的字节，外部改动进 delivery_conflict，子任务三方合入；和 Claude Code worktree 的区别是合并由宿主按日志完成。
4. **缓存与预算**：DeepSeek 只认完整前缀单元、命中价约为未命中的 1/50；#239 的对照 ¥0.3816→¥0.1118；r8 每题 $0.11–0.14 对 r6 的 $0.57–2.73；旧的完整上下文预留约 $0.393 导致 r8 两题被拒；#286 按实测请求大小将这两个历史请求的预留降至约 $0.087，缓存命中不再计入任务 token 限额。这是预留口径的变化，不是实际账单下降的证明。
5. **评测与完成判定**：分别衡量公开测试、冻结的产品内独立检查、评测方参考断言；不能用其中一项替代另一项。第二阶段用参考实现校准未修改的生成检查，发现 03 的夹具误用和 05 的路径替换语法错误。宿主包装、检查预检和可定位反馈仍需实现，不能把设计写成既有能力。历史失败分类与 pass@k/pass^k 的区别见 [cc:A6]。

**常见问题**
1. 为什么不直接用 OpenCode？DevFlow 已把 OpenCode 1.18 当并列执行器，但看不到它的内部轨迹；它的子任务只继承 deny 规则、task_id 不校验归属，只能串行跑 1 个 [da]；r8 里 OpenCode 10 次有 7 次撞上 24 次工具上限。收据、冻结修订批准、任务级预算都需要自己掌握循环；另一个原因是想学清楚这些机制。
2. 怎么防死循环？每批 ≤12 步，根任务 80 步、60 分钟，追加要人批（最多 10,000 步、24 小时）；进展指纹（本次工具请求加最近 8 个工具结果）连续 3 次相同时先提醒一次，提醒后仍重复才暂停（#288）；每次调用过预算准入。对比：OpenCode 1.18 的 doom_loop 只比较同一条回复里的调用（opencode-pi 按代码推断）[op:A2]。
3. 权限怎么做？#294、#295 已实现默认系统沙箱与字面 argv 前缀规则，按 deny→ask→allow；无人值守时 ask 变 deny，子任务请求冒泡。一次批准只对该操作有效，任务批准还绑定参数、目标版本和有效期。macOS/Linux 有实际隔离测试；Windows 需明确选择受管容器或可信执行，不能声称已有同等默认 OS 后端。
4. 上下文满了怎么办？按真实序列化度量，80% 时发压缩请求，只在闭合工具对处切，保留用户原话，原文可回读。坦白：真实运行没触发过（峰值约 179k，窗口 1M）；不做旧结果裁剪，因为会丢 DeepSeek 前缀缓存。
5. 怎么评测？原评测有 31 道合格题、三执行器对照，独立验收用评测方持有的断言；12 个交互故障场景；每轮 SQLite 预算账本。历史对照 27 次 0 次独立通过。第二阶段只重跑原 r8 十题，冻结提交、需求、基线、规则与预算；工程测试通过不等于质量通过，后续定向复测单列，不拼接成绩。
6. 和 Claude Code、Codex 比？它们强在 OS 沙箱加规则、多级压缩、hooks/skills/MCP 生态和多端运行；我们的同批只读并行已补到最多 4 个（#292）；我们强在副作用与模型调用的崩溃语义、批准绑定内容摘要、预算事前准入（Claude Code 的 maxBudgetUsd 在响应后才比较 [cc:D12]）。能力上差距明显，不比谁更聪明。
7. 多 Agent 呢？委派工具有，原对照与本轮十题都没有主动委派记录。只读并行和独立检查执行流程已有工程证据，但检查质量仍未达标。计划绑定、角色编排和交付单写者的扩展在第三阶段，不能把宿主单独调用检查作者说成完整团队编排。
8. 为什么只支持 deepseek-flash？请求摘要要求精确序列化，reasoning_content 回传和缓存规则都按 DeepSeek 写；不满足的 Provider 直接拒绝（loop:102-103），不静默降级。
9. 遇到 429 怎么办？按退避和 Retry-After 自动重试，最多 5 次；每次先记账和落盘，等待中重启会继续等剩余时间。超过上限再暂停。发送后的超时属于交付未知，仍需人工核对，不自动重发（#288）。
10. 重来会怎么做？先建独立验收再加功能；先做沙箱再谈审批；工具从少开始；计划从第一天就是宿主状态；常合 main，避免 schema 号冲突。

**面试前先补的弱点**：能演示“批准后公开测试通过，独立检查失败仍不能自动完成”，并解释检查自身可能出错；不要说失败就不能进入审查，实际顺序是先审查和批准，再执行验收。默认沙箱、规则和子任务权限已有确定性及真实进程回归；尚需补检查有效性、故障分类与返修反馈，重跑完整十题。准备一页架构图，并把第一阶段、第二阶段工程证据和真实质量结果分别讲清楚。

**如实说明归属**
- 可以说是自己的：循环、会话状态机、收据与对账、B/C/D/V、子任务合入、预算的任务级扩展、评测脚本和评测方法。
- 要说明的：复用了 DevFlow 已有的工具注册表、AgentRuntime、governedModelCall、脱敏、MCP 客户端；机制参考了 Codex、OpenCode、Kimi、Pi、DeepSeek Harness 的源码（plan:38-53），没有复制代码；开发中用了 AI 编码工具（实施记录的分支名是 `codex/native-coding-harness-v3`，方案多次经 Cursor Grok 只读评审，1 个提交带 Cursor 署名）。讲清"设计和取舍是我定的，我能解释每一处为什么这样写"。
- 不要说：生产可用（草稿，发布门槛未达到）；比 Claude Code 强（历史对照 0/27）；所有平台都有默认 OS 沙箱（Windows 没有，trusted_local 也没有）；多 Agent 编排做好了；exactly-once（明确不做）；独立检查可靠性已验证（真实校准已发现误判）。也不要把 deep r1/r2/r4、第二阶段定向复测和完整对照轮混着计分。

## 9. 分歧与未核实

**分歧与处理**
- cx 建议每轮回传 reasoning_content：已做。回复里的 reasoning_content 写进 assistant 消息（S/agent-review.ts:2316-2330），请求体原样带上历史消息（:2213），历史校验要求它是字符串（S/native-conversation-protocol.ts:34）。缺的是"漏传会 400"的回归测试，放进阶段 1。
- cx 建议改用 `deepseek-flash` 模型名：已是（S/agent-review.ts:2418）。
- cx 建议评估改走 Anthropic Messages：现在不需要。Chat Completions 的限制是不能插入非模型生成的工具调用，v3 没有这样做：宿主通知是 user 消息（harness:282），运行状态写在最后一条工具结果里（context:26-30）。
- cx 建议剥离子进程密钥、先读后写：已做，命令环境只带最小变量（runner:184-188），写入必须带读取时的哈希（tools:161,167）。
- 落后提交数：简报的 46 对应 10-29 的 2fbb037；11-01 拉取的 origin/main dee264b 是 52（`git rev-list --count`）。schema 冲突已在代码确认：合并基点是 40，v3 与 main 各自的 41 建不同的表。
- internal-v3 同时写"r1–r8 共 27 次 0 次独立通过"和"deep r1、r2、r4 独立通过"：前者是对照轮，后者和 10 元验收的 2 道小题是专项场景，不矛盾，但不能混用。
- 委派次数的口径：da 统计 1,461 次模型返回、r8 493 次，iv 统计 r8 491 次调用、490 个 assistant 轮次；差异来自计数方式，结论都是 delegate_task 0 次。
- 待办工具：Claude Code 对新模型关掉、Pi 反对，Codex、OpenCode、dsh、OpenHands 保留。处理：做成宿主校验的任务图，不做独立清单。
- 多 Agent：mechanics 建议 lead 加任务图加专职角色，Anthropic 又建议常常把子 Agent 折回单循环 [ma:S115]。处理：目标照旧，先做验证者（有证据的那一类），模型主动委派按评测再放开。
- Linux 沙箱：简报提到 Landlock；Codex 已把旧 Landlock 路径标为弃用、默认 bubblewrap（codex-rs/features/src/lib.rs:1451-1455，已核对），dsh 先 bwrap 后 Landlock。处理：bubblewrap 为主，Landlock 兜底。
- Claude Code 教程的源码分析和官方文档有出入（如生产版没有固定的 3 轮待办提醒、cron 抖动不同）：一律按官方文档 [cc]。

**初次评审时未核实（2026-11-01）**

以下保留当时的调查边界；2026-11-02 已完成部分工程验证与真实评测，当前结果以第 8 节及第二阶段报告为准。
- 本次没跑测试、应用和模型；v3 事实来自 iv，另抽查了 loop、tools、permissions、harness:160-330,360-510、evid:60-121、S/agent-review.ts、local-store-schema.ts 和 Panel。
- 第 6 节的效果（并发提速、清单缓存、计划工具对 DeepSeek Flash 的作用、验证者的误报率、规则减少多少提示）都没有量过；规模是估算。
- r8 中 4 个会话的额外命令被拒，是否影响了这些题的结果，没有追。
- 付费估算按 r8 和 r6 外推。
- 验证者的检查本身可能写错；"在 B 上核对标签"能挡住一部分，误报率要实测。
- macOS `sandbox-exec` 已多年被标为弃用但仍在用，Codex、Claude Code 都依赖它；未来系统版本是否保留，没有查。
- Claude Code 内部细节出自教程的源码分析，版本未注明 [cc]。

## 10. 来源

**输入报告**（`.tmp/research/harness-review/`）：internal-v3.md（v3 事实与评测）；claude-code.md（教程 20 章与官方文档）；opencode-pi.md（OpenCode 1.18.15、2.2.5，Pi 1.4.0）；codex-others.md（Codex rust-v0.166.0、Gemini CLI、Kimi、DeepSeek API 规则）；deepseek-harness.md（dsh alpha.2、Qwen Code、Trae、DeerFlow）；aider-openhands-more.md（Aider、OpenHands SDK、SWE-agent、mini-SWE-agent、Cline v4、Goose、Crush、Letta）。另读 `../multi-agent/mechanics.md` 与 `devflow-assets.md`。

**关键链接**（第 6 节用到的参考都在这里）
- Claude Code：权限 https://code.claude.com/docs/en/permissions （cc:D3）；沙箱 https://code.claude.com/docs/en/sandboxing （cc:D4）；/goal https://code.claude.com/docs/en/goal （cc:D10）；子 Agent https://code.claude.com/docs/en/sub-agents （cc:S1）；沙箱减少 84% 提示 https://www.anthropic.com/research/claude-code-sandboxing （cc:A2）；教程 https://learn.shareai.run/zh/s02/ 、/s06/ 、/s08/ 、/s13/ （cc:L2、L6、L8、L13）。
- Codex，前缀 `https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/`：C8 `core/src/tools/parallel.rs#L155-L320`；C15 `execpolicy/README.md`；C21 `core/src/tools/handlers/plan_spec.rs#L7-L60`；C28 `ext/skills/src/render.rs#L23-L27`；C44 `core/src/responses_retry.rs#L58-L176`；C63 `sandboxing/src/seatbelt_base_policy.sbpl#L7-L13`；C64 `linux-sandbox/README.md#L10-L62`；C67 `protocol/src/permissions.rs#L40-L54`；C98 `exec/src/cli.rs#L21-L330`；C100 `core/src/agents_md.rs#L1-L49`。
- DeepSeek API：价格 https://api-docs.deepseek.com/quick_start/pricing （cx:D2）；错误码 https://api-docs.deepseek.com/quick_start/error_codes （cx:D9）；缓存 https://api-docs.deepseek.com/guides/kv_cache （cx:D6）。
- OpenCode 1.18.15，前缀 `https://github.com/anomalyco/opencode/blob/d7b115f623760e68a4749d16508a9eca350f246f/packages/opencode/src/`：A7 `tool/truncate.ts#L12-L141`；A19 `snapshot/index.ts#L318-L406`；A20 `session/revert.ts#L38-L125`；A31 `session/instruction.ts#L60-L236`。OpenCode 2.2.5：B9 https://github.com/anomalyco/opencode/blob/9bbb8ce18c80f099e0e448775f59d965ead40a21/packages/core/src/permission.ts#L151-L203 （已核对求值顺序）。
- Pi：P1 https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/agent/src/agent-loop.ts#L518-L670 ；作者文章 https://mariozechner.at/posts/2025-11-30-pi-coding-agent/ （op:W1）。
- dsh，前缀 `https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/`：d-batch `packages/core/tools/src/batch.ts#L80-L81`（已核对）；d-sbx `packages/sandbox/sandbox-local/src/index.ts#L2-L3`；d-team `docs/subsystems/agent-team.md?plain=1#L7-L74`；d-retrysrc `packages/llm/llm-retry/src/index.ts#L212-L237`；d-subbase `packages/bundle/base/cordis.patch.yml#L359-L391`；d-spill 同文件 `#L407-L413`；d-jobs `packages/jobs/tool-jobs/README.md?plain=1#L12`；d-replaytest `packages/test-support/llm-replay/README.md?plain=1#L12`。DeerFlow f-acc https://github.com/bytedance/deer-flow/blob/35656d6a9fe2ac76ddcf40335ede7361504ddf5b/backend/packages/harness/deerflow/subagents/acceptance_checks.py 。
- OpenHands SDK，前缀 `https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/`：O-critic `openhands-sdk/openhands/sdk/critic/base.py#L20-L115`；O-stuck `openhands-sdk/openhands/sdk/conversation/stuck_detector.py#L20-L230`；O-child `openhands-tools/openhands/tools/child_conversation/definition.py#L36-L100`；O-budget `openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L762-L785`。
- Cline v4，前缀 `https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/`：C-teamtypes `shared/src/team/types.ts#L9-L170`；C-ckpt `core/src/hooks/checkpoint-hooks.ts#L10-L480`；C-approval `agents/src/agent-runtime.ts#L2490-L2560`。
- 方法与评估：Anthropic harness 设计 https://www.anthropic.com/engineering/harness-design-long-running-apps （ma:S100）；Factory Missions https://factory.com/news/missions-architecture （ma:S126）；mini-SWE-agent README https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/README.md#L28-L50 （oh:M-readme）。
