# 编码 Agent harness 源码调研：Aider、OpenHands、SWE-agent 与 mini-SWE-agent、Cline、Goose（附 Crush、Letta Code）

调研时间 2026-10-31。方法：浅克隆到本机，只读源码和仓库文档；没有安装、构建、运行，也没有调用模型。文中链接都固定在"来源"表记录的提交上。无法从源码确认的内容标"未核实"。本报告不涉及 DevFlow 代码，S01–S20 的方面名取自任务说明（对应 learn.shareai.run 的 20 章，本次未重新抓取该站）。

## 一句话结论

五个系统里，只有 Cline v4（团队运行时：带依赖的共享任务、认领、邮箱、任务日志、成果审阅）和 OpenHands SDK（事件溯源会话、可续跑的持久子会话、默认 git worktree 隔离的子会话、让模型写受限 Python 脚本来编排子代理的 workflow 工具）把多 Agent 编排做成了运行时能力；Goose 只允许一层委派、并发上限 5；Aider 与 SWE-agent/mini-SWE-agent 不做子代理，功夫花在编辑格式、仓库地图、ACI 反馈和可复现评测上。对 DevFlow 最值得借鉴的是：结构化的任务与消息契约、可恢复的子会话、默认隔离、分层的预算与卡死闸门。

## 各项目的定位与总体结构

- **Aider**（主干 5dc9490，2026-05-22）：终端结对编程工具。没有工具调用循环：模型在回复里写编辑块，harness 负责解析、应用、lint/test 和 git 提交。结构是 Coder 类族（每种编辑格式一个子类）加 RepoMap、GitRepo、Linter、Commands。最近 release 是 v0.86.0（2025-08-09），排行榜数据止于 2025-08 [polyglot 数据][A-lb]。
- **OpenHands**：V1 拆成两个仓库。software-agent-sdk（v1.59.0）包含 Python SDK、agent-server、工具集和 workspace；OpenHands/OpenHands（v1.34.0）现在是 "Agent Canvas" 前端，可以驱动 OpenHands 自带 agent，也可以驱动 Claude Code、Codex 等 ACP agent [README][O-app]。定时与 webhook 自动化放在独立的 OpenHands/automation 服务 [O-auto]；各仓库职责见 [AGENTS.md][O-appagents]。
- **SWE-agent**（主干 3ea751c，2026-07-16；最近 release v1.1.0，2025-05-22）：研究用 harness，一个 YAML 描述全部行为；工具是 shell 脚本 bundle，在 SWE-ReX 容器里执行。README 写明已被 mini-SWE-agent 取代并建议改用 [README][S-readme]。
- **mini-SWE-agent**（v2.4.6）：agent 类约 100 行，只有 bash，历史只追加，每条命令单独起 subprocess [default.py][M-default] [README][M-readme]。
- **Cline**（v4.1.26）：已重写为分层 SDK：`@cline/shared` → `llms` → `agents`（无状态循环）→ `core`（会话、存储、压缩、插件、hub 守护进程）→ 应用（VS Code、CLI、桌面）[ARCHITECTURE.md][C-arch]。v3.89.2（2026-06-11）是旧扩展最后一版，focus chain、new_task、影子仓库 checkpoint 等旧机制在其中，v4 移除了一部分。
- **Goose**（v1.57.0，仓库已从 block/goose 迁到 aaif-goose/goose）：Rust 实现。一次回复是一条可重入的 Operation 流水线（审批、技能、recipe、工具执行、子代理、steer、压缩、重试、Stop hook、回合上限），最后一步是推理 [state_machine_builder.rs][G-sm]；所有能力以 MCP 扩展接入 [extension.rs][G-ext]。

## 逐项对照

v3 指 Cline v3.89.2；"无"表示源码里没有对应机制。

| ID | Aider | OpenHands（SDK v1.59.0） | SWE-agent / mini-SWE-agent | Cline（v4.1.26） | Goose（v1.57.0） |
|---|---|---|---|---|---|
| S01 Agent Loop | 文本式循环：[`run_one`][A-runone] 发消息、应用编辑；产生 `reflected_message`（编辑失败、lint/test 错误）就当新消息再发，最多 3 次 [A-attrs] | [`_run`][O-run] 循环：PAUSED/STUCK 退出；FINISHED 时先跑 Stop hook；卡死检测；`agent.step()`；等待确认则停；检查预算与迭代上限（默认 500）[O-init] | SWE-agent [`forward_with_handling`][S-fwh] 包住每步并可重问；mini [`run`][M-default] 循环执行 `execute_actions(query())`，末条消息 role 为 `exit` 即停 | [`execute`][C-loop]：每轮流式生成；无工具调用时先注入完成提醒再结束；max-tokens 截断最多恢复 3 次 [C-retry] | [流水线][G-sm]：斜杠命令 → 一串 Operation → Inference；`GOOSE_MAX_TURNS` 默认 1000 [G-maxturns] |
| S02 Tool Use | 无函数调用工具（旧的 `*_func` 编辑格式已标 Deprecated 并从注册表注释掉 [A-funcdep]）；编辑写在回复文本里由 harness [解析][A-apply]；shell 命令只是"建议"，用户确认后执行 [A-shell] | Action/Observation 模型加执行器；同批调用交 [ParallelToolExecutor][O-par]，`tool_concurrency_limit` 默认 1，按 `declared_resources` 加资源锁 [O-conc]；FinishTool 之后的调用被丢弃 [O-finish] | SWE-agent 工具是 bundle（bin 脚本 + config.yaml 签名），解析器 function_calling 或 thought_action [S-default] [S-07]；mini 只有一个 `bash` 工具，或纯文本解析 [M-litellm] | 工具带 `executionMode`；默认 sequential，相邻的 parallel 调用用 `Promise.all` 并发 [C-exec]；工具集按模式预设 [C-presets] | 工具全部来自 MCP 扩展并加扩展名前缀 [G-tools]；ToolExecutionOperation 执行 [G-sm] |
| S03 Permission | 只有逐项确认（加文件、跑命令、修 lint/test）和 `--yes-always`，无规则引擎 [A-lintloop] [A-args-yes] | 分析器给动作打 LOW/MEDIUM/HIGH/UNKNOWN [O-risk]；LLM 分析器直接采信模型在参数里自报的 `security_risk` [O-llmrisk]；策略 Always/Never/ConfirmRisky（阈值 HIGH，UNKNOWN 也确认）[O-policy]；会话默认 NeverConfirm [O-state] | SWE-agent 命令黑名单（vim、nano、gdb、交互式 python 等），命中后重问 [S-filter]；mini 三种模式 human/confirm/yolo（mini.yaml 默认 confirm）加正则白名单 [M-interactive] [M-mini] | 每工具 [`ToolPolicy`][C-policy]（enabled、autoApprove）；需批准时调宿主 `requestToolApproval`，没有回调就拒绝 [C-approval]；CLI 只有显式 `--auto-approve true` 或 `--yolo` 才自动批准 [C-cli]；v3 按读、写、安全命令、全部命令、MCP 分类 [CL-auto] | [GooseMode][G-mode]：Auto（默认，全部自动批准）、Approve、SmartApprove、Chat；SmartApprove 依次看只读注解、缓存决定、LLM 判定 [G-perm] |
| S04 Hooks | 无用户 hook；`--git-commit-verify` 默认 False，提交跳过 pre-commit [A-args-git] | PreToolUse、PostToolUse、UserPromptSubmit、SessionStart、SessionEnd、Stop [O-hooktypes]；`.openhands/hooks.json` 加用户级，matcher 可写正则，默认超时 60s [O-hookcfg]；Stop hook 可否决结束并回注反馈 [O-run] | SWE-agent 有 Python 回调层（agent、env、run 三级，如 apply_patch、open_pr、SWE-bench 评测）[S-hooks]；mini 无，靠子类覆写方法 [M-default] | TaskStart/Resume/Cancel/Complete、Pre/PostToolUse、UserPromptSubmit、PreCompact 文件 hook，映射到运行时事件 [C-hookcfg] [C-hookpaths]；内部扩展也挂 `beforeTool`（plan 守卫）[C-guard] | 插件内 `hooks/hooks.json` [G-hookload]；PreToolUse、PostToolUse(Failure)、SessionStart、UserPromptSubmit、Stop 等 [G-hooks]；Stop hook 阻止结束最多 8 次 [G-stopcap] |
| S05 TodoWrite | 无 | [TaskTrackerTool][O-tracker]（view/plan，todo/in_progress/done，可写 TASKS.md）；planning 预设维护 PLAN.md [O-planning] | 无；SWE-agent 在 instance_template 里写死 5 个步骤 [S-default] | v3 [focus chain][CL-focus]：清单存在任务目录的 markdown，监视文件以同步用户的修改，用户改过就要求下次工具调用带 `task_progress`；v4 已移除，旧会话的 `task_progress` 消息被丢弃 [C-legacy] | [`todo_write`][G-todo] 整段覆盖 TODO（`GOOSE_TODO_MAX_CHARS` 限长），经 MOIM 每轮注入 [G-moim] |
| S06 Subagent | 无通用子代理，只有 architect → editor 两段 [A-arch] | [DelegateTool][O-delegate]（spawn/delegate，最多 5 个，线程并行后 join）；[TaskToolSet][O-task]（`subagent_type`、`resume`、`max_turns`，子会话持久化可续跑）[O-taskmgr]；[workflow][O-workflow] 工具让模型写 Python 编排子代理 | 无；SWE-agent [RetryAgent][S-retry] 多次尝试，由 reviewer/chooser 选优 [S-reviewer] | [`spawn_agent`][C-spawn]（parallel 模式，阻塞到子代理结束后返回文本，继承工具策略与审批回调） | [summon][G-summon] 扩展的 `load`/`delegate`：来源可为 recipe、agent 或临时指令，可覆盖 provider、model、extensions、max_turns，可 resume；子代理不能再委派 [G-nonest]；并发默认 5 [G-sm] |
| S07 Skill Loading | 无；`--read` 把 CONVENTIONS.md 等作为只读常驻文件 [A-args-read] | AgentSkills（SKILL.md）与旧 microagent；无触发器的技能全文常驻 `<REPO_CONTEXT>`，有触发器的列入 `<available_skills>`，关键词、任务、路径命中时注入 [O-skill] [O-trigger] [O-skilldirs] | 无 | `skills` 工具加多级搜索路径（含 `.agents/skills`）[C-tools-defs] [C-paths] | 全局 `~/.agents/skills`、项目 `.agents/skills` [G-skills]；SkillOperation 在流水线中处理 [G-sm] |
| S08 Context Compact | 历史超过 `max_chat_history_tokens`（输入上限 / 16，夹在 1024–8192）时，后台线程用 weak model 递归摘要较早的一半 [A-hist] [A-maxhist] | 默认 [LLMSummarizingCondenser][O-conddef]（80 个事件、保留前 4 个）[O-cond]；产出 Condensation 事件（被遗忘事件 ID、摘要、插入位置），原事件仍留在日志 [O-condevt]；上下文超限时发 CondensationRequest [O-stepcond] | SWE-agent [history processors][S-hp]：旧观察换成一行省略说明（0.7 配置保留 5 条）、删除过时窗口 [S-07]；mini 不压缩，保持线性历史 [M-readme] | 默认 agentic 策略，异常时退回确定性的 basic；输入达上限 90% 触发，目标 70%，保留最近 20k token，摘要时工具结果截到 2000 字符 [C-compact] [C-compactmain]；v3 有 condense、summarize_task 工具 [CL-handlers] | 默认 80% 触发 CompactionOperation [G-cmlib] [G-cm]；ToolPairCompaction 先把较老的工具请求/响应对换成摘要 [G-tpc] [G-cutoff]；原消息改为仅用户可见 [G-cm] |
| S09 Memory | 无；可选 `--restore-chat-history`（默认关）读回 `.aider.chat.history.md` [A-args-hist] | 两层 MEMORY.md（用户级、项目级）首轮载入提示；日记文件刻意不预载，按需读取 [O-memory] | 无 | 本次未见内建跨会话记忆工具（未核实）；依赖 rules 与 AGENTS.md [C-rules] | memory MCP 扩展（全局或项目级 remember/retrieve）[G-mem]；chatrecall 搜索历史会话 [G-recall] |
| S10 System Prompt | system（含按模型加的 lazy/overeager 提醒、平台、语言）→ 示例 → 只读文件 → repo map → 历史 → 聊天文件 → 当前消息 → reminder [A-fmt] [A-chunks] | 静态模板（preset 或 Jinja）与动态段（secret 名称、日期等）分层拼装 [O-dyn]；AgentContext 另提供技能、系统/用户消息后缀 [O-ctx] | YAML 里的 system、instance、next_step Jinja 模板 [S-default] [M-default] | [`buildClineSystemPrompt`][C-sysprompt]：按 mode 取 ACT 或 YOLO 模板，拼接 rules 与 plan/act 说明，填平台、CWD、日期、IDE | [PromptManager][G-pm] 合并扩展说明（排序、去掉 Unicode tag 字符）、hints、日期；每轮另加 turn context（时间、cwd、剩余回合预算）[G-moim] |
| S11 Error Recovery | API 错误指数退避（0.125s 起翻倍，超过 60s 停止）；输出被截断且模型支持 prefill 时续写 [A-retry] [A-retrytimeout]；编辑失败回灌 [A-apply] | LLM 重试 5 次（8–64s），可配 fallback [O-llmretry]；上下文超限先压缩再重试 [O-stepcond]；卡死检测 [O-stuck] | SWE-agent 对格式错误、黑名单命令、bash 语法错误重问最多 3 次 [S-fwh]；超时、超成本、超上下文时自动提交现有 diff [S-autosub]；模型重试 20 次（10–120s）[S-models]；mini 重试 10 次（4–60s），连续 3 次格式错误退出 [M-retry] [M-default] | provider 错误重试 3 次（1s 起，最大 15s，可中断）[C-retry]；溢出时压缩后重试 [C-loop]；重复调用 soft 3 / hard 5 [C-loopdet] | Retry、ExitOnError、EmptyResponse 等 Operation [G-sm]；ToolMonitor 限制重复调用 [G-monitor] |
| S12 Task System | 无 | 无任务依赖图；TaskManager 只跟踪子任务 RUNNING/COMPLETED/ERROR [O-taskmgr] | 无；批量模式按实例列表执行 [S-run] | 团队共享任务：pending/in_progress/blocked/completed 加 `dependsOn`，列表返回 `isReady`、`blockedBy`；claim、complete（带 summary）、block（带 reason）[C-teamtypes] [C-teamtask] | 无；recipe 可声明 sub_recipes（重复调用时可要求顺序执行）[G-recipe] |
| S13 Background Tasks | 无（历史摘要、缓存保温是内部线程）[A-hist] [A-warm] | 终端 30s 无新输出即软超时返回，进程继续，可用 `is_input` 交互 [O-termconst] [O-term]；agent-server 让会话在服务端运行 [O-server] | 无；SWE-agent 黑名单含 nohup、`tail -f` [S-filter]；mini 每条命令独立 subprocess，超时杀整个进程组 [M-local] | 队友任务 `team_run_task` 异步排队，`team_await_runs`、`team_cancel_run` 控制 [C-teamtools] [C-teamtypes] | 无通用后台任务；子代理在流水线内并发（默认 5）[G-sm] |
| S14 Cron Scheduler | 无 | SDK 无；独立服务 OpenHands/automation 负责 cron 与 webhook [O-auto] | 无 | `.cline/cron/` 下的 markdown 规格：`*.cron.md` 定时、`events/*.event.md` 事件、其余一次性；可指定 mode、模型、迭代、超时；存 cron.db，由 hub 执行 [C-cron] [C-cronpaths] | [tokio-cron-scheduler][G-sched]（5 段 cron 自动补秒位），以 recipe 为任务单元；scheduler 平台扩展让 agent 自己管日程 [G-schedtool] |
| S15 Agent Teams | 无 | 无持久团队；delegate 可同时给多个具名子代理派活 [O-delegate] | 无 | [AgentTeamsRuntime][C-multi]：队友 spawn/shutdown、共享任务、run、邮箱、mission log、outcome，共 20 余个 `team_*` 工具 [C-teamtools]；按变更增量持久化 [C-teampersist] | 无；只有一层委派 [G-nonest] |
| S16 Team Protocols | 无（architect 把自然语言方案整段交给 editor）[A-arch] | TaskObservation（task_id、subagent、status 与内容）[O-task]；workflow 脚本用 `main()` 返回值汇总 [O-workflow] | reviewer/chooser 用结构化的 ReviewSubmission、ChooserOutput [S-reviewer] | 邮件（from、to、subject、body、taskId、readAt）；mission log（kind 为 progress/handoff/blocked/decision/done/error，带 evidence、nextAction）；outcome 片段 draft/reviewed/rejected，最终 finalized [C-teamtypes] | recipe 的 `response` JSON schema 加 final_output 工具约束输出 [G-recipe] [G-final] |
| S17 Autonomous Agents | 无；watch 模式监听以 `AI!`/`AI?` 结尾的代码注释并触发 [A-watch] | `/goal`：另一个 LLM 判定是否完成，未完成就续提示，最多 10 轮 [O-goal]；配置 critic 迭代后，分数低于 0.6 最多再迭代 3 次 [O-critic] | 无（单实例自治到 submit） | 队友按 `isReady` 认领共享任务 [C-teamtask]；cron 与事件触发 [C-cron] | 无主动认领；只有定时任务 [G-sched] |
| S18 Worktree Isolation | 无，直接在当前仓库提交 | `start_child_conversation` 默认 `isolation: "worktree"`（独立 worktree 与分支），也可 shared [O-child] | 不用 worktree，用容器隔离 [S-env] | CLI `--worktree` 在 `~/.cline/worktrees/` 建 detached worktree 运行任务 [C-wtflag] [C-wt] | 无；delegate 的工作目录只能在父目录之内 [G-summon] |
| S19 MCP Tools | 无（本次源码检索不到 MCP） | `mcpServers` 配置，列工具默认超时 30s，监听 tools/list_changed，支持 OAuth [O-mcp] [O-mcplist] | 无 | 设置文件 `cline_mcp_settings.json` [C-mcppath]；工具名 `server__tool` [C-mcpname]；Agent Plugins 只从用户主目录发现，打开仓库不会激活仓库控制的 MCP [C-repomcp] | 扩展本身就是 MCP（stdio、streamable_http、builtin、platform）[G-ext]；添加扩展前查 OSV 恶意包 [G-malware] |
| S20 Comprehensive | Coder 类族 + RepoMap + GitRepo + Linter + Commands [A-arch] [A-apply] | SDK（agent、conversation、tools、workspace）+ agent-server + Canvas 前端 + automation 服务，分仓 [O-appagents] [O-auto] | YAML 驱动的 ACI + SWE-ReX + 批量评测 [S-readme]；mini 把脚手架压到最小 [M-readme] | shared → llms → agents（无状态循环）→ core（会话、存储、压缩、hub）→ apps [C-arch] | Operation 流水线 + MCP 扩展 + recipe；状态机在 goose-agent crate [G-smmod] [G-sm] |
| E1 沙箱与 OS 隔离 | 无，直接改本地仓库（另提供运行 aider 本身的 Docker 镜像）[A-docker] | [DockerWorkspace][O-docker]（agent-server 镜像，可挂卷、转发环境变量、指定网络）；[APIRemoteWorkspace][O-remote]（远程 runtime API，默认 runtime class `sysbox-runc`，资源倍数 1/2/4/8）；另有 Apptainer、cloud 等 workspace [O-wsdir] | SWE-agent 默认 SWE-ReX Docker（`python:3.11`）[S-env]；mini 支持 local、docker、singularity、bubblewrap、contree 等 [M-envs] | 本次未见 OS 级沙箱（检索 seatbelt、bubblewrap、landlock 均为 0），依靠审批与 plan 守卫 | 无 OS 沙箱；`--container` 让 stdio 与内建扩展在指定 Docker 容器里运行 [G-container] |
| E2 编辑格式与补丁应用 | whole、diff（SEARCH/REPLACE）、diff-fenced、udiff、patch、editor-*；model-settings.yml 逐模型配置（357 条，diff 289、diff-fenced 35）[A-msc] [A-msfile] | [file_editor][O-fe]：view、create、str_replace、insert、undo_edit（每文件保留 10 次历史，文件上限 10MB）[O-feimpl]；另有 apply_patch 工具 [O-toolsdir] | 0.7 用行号区间 `edit`，flake8 出现新错误就回滚 [S-lintedit]；1.x 默认 str_replace_editor（linter 可选）[S-strrep]；mini 没有编辑工具，改文件也走 bash [M-readme] | `editor` 与 `apply_patch` 工具；act 预设开 editor、关 apply_patch [C-presets] [C-tools-defs] | developer 扩展 `file_write`、`file_edit`（before/after 字符串替换）[G-edit] |
| E3 代码搜索与仓库理解 | tree-sitter 标签加 PageRank 的 [repo map][A-rm] | terminal、glob、grep 工具（另有浏览器）[O-toolsdir] | search_dir、search_file、find_file 结果过多时要求缩小范围 [S-search]；filemap 省略函数体 [S-filemap] | `search_codebase`、`read_files` [C-tools-defs] | [analyze][G-analyze] 扩展：tree-sitter 目录概览、文件结构、符号调用图 |
| E4 会话持久化、恢复、checkpoint、undo | 每次编辑自动 git 提交 [A-autocommit]；[`/undo`][A-undo] 只撤 aider 自己的提交，已推送或文件有未提交改动时拒绝 | `base_state.json` 加每事件一个 JSON 文件，可恢复 [O-events] [O-eventlog]；`fork` 复制事件，`navigate_to` 在事件树上换分支 [O-fork] | SWE-agent 轨迹 .traj 可 replay [S-run]；mini 每步写 JSON 轨迹 [M-default] | v4 用 `git stash create`（未跟踪文件经私有 index 作为第三父提交）加私有 ref `refs/cline/checkpoints/<session>/<run>` [C-ckpt] [C-ckpthook]；v3 用影子仓库 [CL-ckpt] | 会话存 SQLite `sessions.db` [G-session]；本次未见文件级 checkpoint 或 undo（未核实） |
| E5 模型与 provider 适配 | LiteLLM；ModelSettings 管编辑格式、weak/editor 模型、reminder 位置、reasoning 标签、可接受参数 [A-msc] [A-generic] | LiteLLM；`native_tool_calling`、`reasoning_effort`、`extended_thinking_budget`、fallback 策略、router [O-llmcfg] | LiteLLM；mini 有 toolcall 与纯文本两套解析，支持 /response 端点 [M-litellm] [M-readme] | `@cline/llms` 网关统一 provider 和模型目录 [C-arch] | goose-providers；toolshim 为不支持工具调用的模型做解析 [G-toolshim] |
| E6 提示缓存、成本、预算 | `--cache-prompts`（默认关）在 system/示例、repo map/只读文件、聊天文件处打断点 [A-chunk-cache]；`--cache-keepalive-pings` 保温 [A-args-cache]；显示单条与会话成本 [A-cost] | `caching_prompt`、`prompt_cache_retention` [O-llmcfg]；`max_budget_per_run` 覆盖 condenser 等全部 LLM，超限报 MaxBudgetReached [O-budget] | SWE-agent CacheControl processor 标最近 2 条；每实例与总成本上限 [S-hp] [S-models]；mini 的 AgentConfig `cost_limit` 默认 3.0，mini.yaml 也是 3 [M-default] [M-mini] | Anthropic 兼容路由保留 cache_control [C-cache]；usage 累计 totalCost [C-usage] | 会话累计 token 与 `accumulated_cost` [G-cost]；canonical_cost 估价 [G-ccost]；Anthropic provider 中未见 cache_control（未核实是否另有机制） |
| E7 工具输出管理 | 无工具输出；shell 输出经用户同意才加入对话 [A-lintloop] | 终端输出上限 30000 字符 [O-termconst]；通用截断 50000，可把全文存文件并告诉模型路径 [O-trunc] | SWE-agent 观察超过 100000 字符截断并提示 [S-trunc]；str_replace_editor 16000 [S-strrep]；mini 不少于 10000 字符时给头尾各 5000 加省略字数 [M-mini] | 压缩阶段工具结果截到 2000 字符 [C-compact]；运行时截断策略未核实 | shell 输出上限 2000 行或 50KB，超出存文件并给预览 [G-shell]；任意工具文本超过 200000 字符写临时文件 [G-large] |
| E8 人在回路与运行中干预 | code、ask、architect、help 模式切换；关键动作逐项确认 [A-modes] | `pause`、等待确认与拒绝待执行动作 [O-confirmapi]；运行中 `send_message` 排队不丢 [O-run]；`ask_agent` 旁路提问 [O-ask] | mini 运行中用 `/u` `/c` `/y` 切模式，结束前可追加新任务 [M-interactive] | Plan/Act 与 `ask_question` 工具 [C-presets]；待发消息分 queue 与 steer 两种投递 [C-pending] | [SteerOperation][G-steer] 在模型轮与工具轮之间插入排队的用户指导；Approve 模式逐个确认 [G-mode] |
| E9 完成判定与验证 | 无完成工具，一次回复即结束；lint/test 失败时询问是否修复 [A-lintloop] | FinishTool [O-finish]；Stop hook 可否决 [O-run]；critic 迭代 [O-refine]；`/goal` 判官 [O-goal] | 第一次 submit 先回显 diff 与检查清单，需再 submit [S-submit] [S-default]；mini 要求输出首行是 `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` 且退出码 0 [M-local] | 无工具调用即完成；若有待发的完成提醒，先注入提醒再继续一轮 [C-loop]；yolo 预设用 `submit_and_exit` [C-presets] | recipe 的 shell 成功检查，失败时跑 on_failure 再重试 [G-retrytypes]；final_output 工具 [G-final] |
| E10 不可信内容、注入、密钥 | 无专门机制；`.aiderignore` 排除文件 [A-args-ignore] | 输出中的 secret 值换成 `<secret-hidden>` [O-secret]；导出轨迹时剥离凭据 [O-redact]；分析器另有 GraySwan、defense_in_depth 等 [O-secdir] | 无（依赖容器） | `.clineignore` [C-ignore]；system prompt 中 git remote URL 去凭据 [C-sysprompt]；仓库内 MCP 不自动激活 [C-repomcp] | 提示注入扫描器默认关（`SECURITY_PROMPT_ENABLED` 默认 false）[G-secmod]；egress、adversary inspector；扩展说明去掉 Unicode tag 字符 [G-pm] |
| E11 可观测性与评测 | polyglot 基准（225 道 Exercism，6 种语言）与排行榜 [A-lbdoc] [A-lb] | Laminar/OTEL 追踪 [O-otel]；README 徽章 SWE-bench 77.6 [O-readme] | 轨迹、inspector、SWE-bench 评测 hook [S-run] [S-hooks]；mini 的轨迹就是消息列表 [M-readme] | OpenTelemetry 适配与 Langfuse relay [C-otel]；`evals/`（cline-bench 等）[C-evals] | otel/otlp 模块 [G-otel] |
| E12 运行形态与集成 | 交互 CLI、`--message` 一次性执行、Python 脚本调用、`--gui` [A-args-msg] [A-scripting] | Python SDK、agent-server（REST/WebSocket）[O-server]、TypeScript client、[ACPAgent][O-acp]（把 Claude Code 等 ACP server 当后端）、Agent Canvas [O-app] | `sweagent run`、`run-batch`、replay、shell [S-run]；mini CLI 与 Python [M-readme] | VS Code、CLI（交互、一次性、`--json`、headless）[C-cli]、ACP [C-acp]、hub 守护进程、桌面 [C-arch] | CLI、桌面、`goose acp`（stdio ACP server）[G-acpcli]、goose-sdk（Rust，uniffi 绑定 Python/Kotlin）[G-sdk] |
| E13 项目指令与配置层 | `.aider.conf.yml`（家目录、git 根、cwd 三处）、`.env`、`--read CONVENTIONS.md` [A-conf] [A-args-read] | AGENTS.md、agent.md、CLAUDE.md、GEMINI.md、.cursorrules 映射为常驻第三方技能 [O-thirdparty]；路径规则在触碰对应文件时注入 [O-pathrules] | YAML 配置合并 [S-default] | `.clinerules`（文件或目录）、工作区与全局 AGENTS.md、workflows [C-rules] [C-paths] | `CONTEXT_FILE_NAMES` 默认 `.goosehints` 与 AGENTS.md；全局、项目两级，子目录按需加载 [G-hints] |

## 重点机制详述

### Aider

- **仓库地图**。[`get_ranked_tags`][A-rm] 用 tree-sitter 抽取每个文件的定义（def）和引用（ref）标签，以文件为节点、"引用者 → 定义者"为边建 NetworkX 多重有向图。边权是引用次数开平方再乘系数：用户提到的标识符 ×10，长度不少于 8 的 snake/kebab/camel 名 ×10，下划线开头 ×0.1，被 5 个以上文件定义 ×0.1，引用者在聊天中 ×50 [A-rmweights]。聊天文件、被提到的文件、路径段命中标识符的文件获得 personalization，跑个性化 PageRank，再把每个节点的分数按出边权重分摊到（文件，符号）上。之后二分搜索标签数量，让渲染出的树落在 token 预算 ±15% 内 [A-rmbs]。预算默认 1024，或取模型输入上限的 1/8 并夹在 1024–4096 [A-maptok]；聊天里没有文件时放大 8 倍（不超过窗口减 4096）[A-rmbudget]。刷新策略有 auto、always、files、manual，auto 只在上次计算超过 1 秒时才用缓存 [A-rmrefresh]；标签缓存在 `.aider.tags.cache.v*` [A-rmcache]。
- **编辑格式与按模型选择**。ModelSettings 默认 `whole` [A-msc]；model-settings.yml 按模型名精确指定，357 条中 289 条用 diff、35 条用 diff-fenced，138 条把 editor 格式设为 editor-diff [A-msfile]，例如 Claude Sonnet 4 用 diff 并开 cache_control [A-ms]，Gemini 2.5 Pro 用 diff-fenced [A-msgem]。未命中时 [`apply_generic_model_settings`][A-generic] 按名称子串推断（如 gpt-4-turbo 用 udiff）。diff 的匹配链是：精确或仅空白差异、去掉首行空行、处理 `...` 省略；基于编辑距离的模糊匹配写在一个提前 `return` 之后，实际不会执行 [A-eb]。udiff 失败分"未匹配"和"不唯一"两类错误模板 [A-udiff]。解析失败抛 ValueError，错误文本作为反射消息回灌，最多 3 次 [A-apply] [A-runone]。
- **architect 与 editor 分工**。[ArchitectCoder][A-arch] 继承 AskCoder，自己不改文件；回复结束后（`--auto-accept-architect` 默认 True，否则询问）用 editor_model 和 editor_edit_format 新建一个 Coder，关掉 repo map 和提示缓存，把架构师的整段回复当用户消息执行，成本累加回主 Coder [A-args-arch]。排行榜上 o3 (high) + gpt-4.1 的 architect 组合为 78.2%、$17.55 [A-lbarch]。
- **编辑后的 lint/test 循环**。`--auto-lint` 默认开，`--auto-test` 默认关 [A-args-lint]。Python 先做 tree-sitter 语法检查，再跑只含致命错误码（E9、F821 等）的 flake8；其他语言看 tree-sitter 的 ERROR 节点，并附上出错行的语法树上下文 [A-lint]。lint 后先自动提交一次，再问用户是否修复；同意就把错误作为反射消息继续 [A-lintloop]。
- **git 自动提交与 undo**。`--auto-commits`、`--dirty-commits` 默认开，编辑前把用户已有的脏改动单独提交；提交信息先用 weak model 生成，不行再换主模型 [A-commitmodels]；默认加 Co-authored-by 尾注；`--git-commit-verify` 默认关，所以提交跳过 pre-commit hook [A-args-git] [A-commit] [A-commitmsg] [A-autocommit]。`/undo` 只处理本会话 aider 产生的提交；文件有未提交改动或提交已推送到 origin 时拒绝 [A-undo]。
- **提示缓存**。默认关。开启后在三处打 ephemeral 断点：示例（没有示例时是 system）、repo map 连同只读文件、聊天文件 [A-chunk-cache]；只对配置了 `cache_control: true` 的模型生效 [A-ms]。`--cache-keepalive-pings N` 每 5 分钟发一次请求保温 [A-args-cache] [A-warm]。
- **公开基准**。polyglot 基准是 225 道 Exercism 题，覆盖 C++、Go、Java、JavaScript、Python、Rust [A-lbdoc]。数据文件中最高为 gpt-5 (high) 88.0%（diff，$29.08，2025-08-23）[A-lb]，o3-pro (high) 84.9% [A-lbo3pro]，gemini-2.5-pro-preview-06-05（32k think）83.1%（diff-fenced）[A-lbgem]。早期 SWE-bench Lite 26.3%（2024-05-22）[A-swelite]、SWE-bench 18.9%（2024-06-02）[A-swemain]。

### OpenHands

- **事件溯源的会话状态**。会话目录由 `base_state.json`（ConversationState 快照，字段赋值即自动保存）和 `events/event-{idx:05d}-{id}.json`（每个事件一个文件）组成 [O-events] [O-statecreate]。EventLog 支持按序号索引、parent_id 树和写入守卫 [O-eventlog]。`fork()` 深拷贝事件得到新会话，`navigate_to(event_id)` 切换活跃分支 [O-fork]。送给 LLM 的是从事件流计算出的 View，其中已经应用了 Condensation [O-view]。
- **condenser**。LLMSummarizingCondenser 的类默认值是 max_size 240、keep_first 2，`default_condenser` 实际用 80 和 4；另有 max_tokens、minimum_progress 0.1、hard context reset 最多 5 次、每次缩到 0.8 [O-cond] [O-conddef]。事件数或 token 超限时压缩；LLM 报上下文超限时发 CondensationRequest 再试 [O-stepcond]。结果是一条 Condensation 事件，记录被遗忘的事件 ID、摘要和插入位置，原事件不删 [O-condevt]。
- **安全分析器与确认策略**。风险四级 [O-risk]。工具 schema 可加一个 `security_risk` 字段让模型自评，LLMSecurityAnalyzer 原样采用；没配分析器时忽略该字段，模型没填则记为 UNKNOWN [O-llmrisk] [O-confirm]。ConfirmRisky 默认阈值 HIGH，UNKNOWN 也要确认 [O-policy]。需要确认时状态变为 WAITING_FOR_CONFIRMATION，再调一次 `run()` 视为批准，`reject_pending_actions` 拒绝 [O-run] [O-confirmapi]。另有 GraySwan、ensemble、defense_in_depth（模式、策略栏、shell 语义）分析器 [O-secdir]。
- **沙箱运行时**。DockerWorkspace 启动 `ghcr.io/openhands/agent-server` 镜像，宿主经 HTTP 与容器里的 agent-server 通信 [O-docker]；APIRemoteWorkspace 向远程 runtime API 申请会话，可设 keep_alive [O-remote]。
- **委派与 task 工具**。DelegateTool 的 `spawn` 先建具名子代理（上限 5），`delegate` 给每个子代理一条任务、各开一个线程，全部 join 后合并结果 [O-delegate] [O-delegatedef]。TaskToolSet 的 task 按 `subagent_type` 选定义；迭代上限与预算优先取定义里的值，否则继承父会话；子会话持久化在父会话目录下（父会话不持久化时用临时目录），可用 task_id 续跑 [O-task] [O-taskmgr]。子代理定义来自插件、项目级 `.agents/agents/*.md` 与 `.openhands/agents`、用户级目录 [O-subload]。`start_child_conversation` 默认给子会话独立 worktree [O-child]。**workflow 工具**：模型提交 `async def main(wf)` 脚本，只能调用 `run_agent`、`map_agents`、`reduce_agent`、`pipeline`（各条目逐级前进，阶段之间不设屏障）、`flatten`；脚本自己不能读写文件或跑 shell，工程工作必须交给子代理按正常工具和安全策略完成；`max_concurrency` 默认 8（1–64）[O-workflow]。
- **卡死检测**。只看最近一条用户消息之后、最多 20 个事件。四种模式：同一动作加同一观察重复 4 次；同一动作连续报错超过 3 次；没有用户输入时 agent 连发 3 条消息；动作/观察交替重复 6 次。报错连串先插入一次提示，下一轮仍如此才判定 STUCK [O-stuck] [O-stuckth] [O-stuckcall]。
- **skills 与 microagents**。两种格式、三类触发（关键词、任务、路径）；一个技能要么路径触发、要么可被模型调用，不能兼有，同时写了 `paths:` 时以它为准 [O-skill] [O-trigger] [O-skillpaths]。目录为 `.agents/skills`（推荐）、`.openhands/skills`、`.openhands/microagents`（旧）及对应用户级目录 [O-skilldirs]；AGENTS.md 等第三方文件直接映射为常驻技能 [O-thirdparty]。
- **MCP**。DefaultMCPToolProvider 连接 `mcpServers`，默认超时 30s [O-mcp]；收到 tools/list_changed 后重建工具 [O-mcplist]；agent-server 有 MCP OAuth 存储 [O-server]。
- **其他闸门**。同批工具并行要显式调高 `tool_concurrency_limit`，同一资源的访问由资源锁串行化 [O-conc] [O-par]；每次 run 最多 500 次迭代，另可设成本预算 [O-init] [O-budget]。

### SWE-agent 与 mini-SWE-agent

- **ACI（agent-computer interface）设计**（论文 arXiv 2405.15793 [S-readme]）。0.7 配置的界面：窗口式查看器每次显示 100 行、重叠 2 行，用 open、goto、scroll_up/down 移动窗口，状态命令每步回报当前文件与位置 [S-07] [S-wininstall] [S-wincfg] [S-winfile]。按行号区间的 `edit` 前后各跑一次 flake8，出现新错误就回滚，并把"改后窗口"、"原窗口"和错误一起返回，明确要求不要重复同一个失败的编辑 [S-lintedit]。搜索命令匹配过多时只回一句让模型缩小范围 [S-search]；命令没有输出时返回固定提示句而不是空串 [S-default]；会卡住会话的交互式程序被拦截 [S-filter]。1.x 默认配置改为 Anthropic 风格的 str_replace_editor 加提交前复核；配置里的 `USE_FILEMAP` 让超过 16000 字符的 Python 文件在查看时只显示结构、省略长函数体 [S-default] [S-filemapuse] [S-filemap] [S-submit]。
- **history processors**。LastNObservations 只保留最近 n 条观察，可按 polling 分批移除以保持缓存命中，标签可强制保留或删除；ClosedWindowHistoryProcessor 把过时窗口换成一行说明；CacheControlHistoryProcessor 只给最后 2 条 user/tool 消息打断点；另有 RemoveRegex 和图片解析 [S-hp]。
- **错误处理**。`forward_with_handling` 对格式错误、被拦命令、bash 语法错误重问（`max_requeries` 3）[S-requery] [S-fwh]；成本超限、上下文超限、总执行时间超过 1800s 或连续 3 次超时，就自动提交当前 diff [S-autosub] [S-timeouts]；RetryAgent 配合 reviewer/chooser 多次尝试取最好的一次 [S-retry] [S-reviewer]。
- **mini 的 bash-only 循环与线性历史**。消息列表只追加；每次 query 前检查步数、成本、墙钟上限；动作逐个交给环境执行 [M-default]。LocalEnvironment 用 `subprocess.Popen(shell=True)`，默认 30s 超时并杀整个进程组；输出首行是哨兵串且退出码为 0 即视为提交 [M-local]。README 给出的理由：不依赖工具调用接口，任何模型可用；换成 `docker exec` 等就能进沙箱；轨迹与送给模型的消息完全一致，便于调试和微调 [M-readme]。
- **SWE-bench 结果**。SWE-agent README 新闻：1.0 + Claude 3.7 曾在 SWE-bench Verified 和 Full 上 SoTA（2 月，条目未写年份）；mini 用约 100 行在 Verified 上达到 65% [S-readme]。mini README 自称 Verified 超过 74% [M-readme]。两者都是项目自述，本次未复核排行榜。

### Cline

- **Plan 与 Act**。v4 的 AgentMode 为 act、plan、yolo、zen（zen 的语义未核实）[C-modes]。plan 预设关掉 editor 和 apply_patch，但保留 run_commands [C-presets]。源码注释写了理由：只读调查离不开命令行；提示词是第一道防线，plan 守卫是硬兜底 [C-sysprompt]。守卫作为 `beforeTool` hook 检查每条命令是否在改文件，命中就以工具错误跳过，不进入审批 [C-guard]。默认给模型 `switch_to_act_mode` 工具；VS Code 扩展不提供该工具，提示改为让用户手动切换 [C-sysprompt]。v3 用 `plan_mode_respond` 工具 [CL-handlers]。
- **checkpoint**。v3 是影子仓库：放在扩展全局存储 `checkpoints/<cwd 哈希>/.git`，`core.worktree` 指向工作区，关闭 GPG 签名，每次 `--allow-empty` 提交，恢复用 hard reset；拒绝在家目录、桌面、文档、下载目录启用 [CL-ckpt] [CL-ckptutil] [CL-ckptgit]。v4 改为直接在用户仓库执行 `git stash create`，用每会话私有的 `GIT_INDEX_FILE` 把未跟踪文件拼成第三个父提交，用 `refs/cline/checkpoints/<session>/<run>` 保活；删除会话时清理 ref，14 天未动的临时目录被回收 [C-ckpt] [C-ckpthook]。恢复走 worktree 恢复事务并裁剪消息 [C-restore]。
- **自动批准**。v3 的 AutoApprove 按动作类型分开配置（读文件与工作区外读、编辑与工作区外编辑、安全命令与全部命令、MCP），另有全局 yolo 开关 [CL-auto]。v4 统一为每工具策略加宿主审批回调 [C-policy] [C-approval]。
- **focus chain（todo 清单）**。v3 的 FocusChainManager 把清单写在任务目录的 markdown 文件里并监听变化；用户改过清单后，提示模型下一次工具调用必须带 `task_progress`，并按进度注入提醒 [CL-focus]。v4 已没有该机制 [C-legacy]，移除理由未核实。
- **上下文压缩**。v4 常量见 [C-compact]，策略与回退见 [C-compactmain]；v3 有 condense 和 summarize_task 工具 [CL-handlers]。
- **new_task**。v3 的工具要求 `context` 参数，询问用户后用这段上下文开新任务 [CL-newtask]。v4 SDK 运行时没有这个工具，`/deep-planning` 的最后一步改为展示计划、等待用户确认 [C-newtask-gone]。
- **.clinerules 与 AGENTS.md**。`.clinerules` 可以是单文件，也可以是目录（含 workflows 子目录）；工作区根目录自动加入 AGENTS.md，另有全局 AGENTS.md [C-rules]；配置目录名为 rules、workflows、skills、hooks [C-paths]。
- **hooks**。hook 文件名就是事件名 [C-hookcfg]；搜索路径包含 `~/Documents/Cline/Hooks` [C-hookpaths]。
- **MCP**。设置文件路径可用 `CLINE_MCP_SETTINGS_PATH` 覆盖 [C-mcppath]；工具名为 `server__tool` [C-mcpname]；Agent Plugins 只从用户主目录发现，注释说明这样打开仓库不会激活仓库控制的 MCP 服务 [C-repomcp]。
- **团队编排（与多 Agent 编排最相关）**。AgentTeamsRuntime 管理队友生命周期、共享任务（依赖、认领、阻塞、完成摘要）、异步 run 记录（queued、running、completed、failed、cancelled、interrupted）、邮箱、mission log、outcome 及片段审阅 [C-multi] [C-teamtypes] [C-teamtools]；持久化按变更量增量写入 [C-teampersist]；`team_task` 的 claim 会在结果里提示下一步做什么 [C-teamtask]。定时与事件触发见 [C-cron] [C-cronpaths]，worktree 见 [C-wt] [C-wtflag]。

### Goose

- **扩展即 MCP server**。ExtensionConfig 有四种：stdio、builtin、platform（进程内平台扩展，如 developer、todo、summon、scheduler、analyze）、streamable_http [G-ext] [G-platdir]；工具名带扩展前缀 [G-tools]；添加扩展前用 OSV 查恶意包 [G-malware]。
- **recipe 与 sub-recipe**。Recipe 字段包括 instructions、prompt、extensions、settings、parameters、response（JSON schema）、sub_recipes、retry [G-recipe]；SubRecipe 可传 values，可要求重复调用时顺序执行 [G-recipe]；retry 由 shell 成功检查、max_retries、on_failure 组成，超时默认 300s 和 600s [G-retrytypes]；response schema 通过 final_output 工具约束 [G-final]。
- **子代理**。summon 的 `delegate` 参数见 [G-summon]；子代理会话再调用 delegate 会被拒绝 [G-nonest]；max_turns 的取值顺序是：调用参数、recipe settings、`GOOSE_SUBAGENT_MAX_TURNS`、全局默认 [G-subturns]；并发上限 `GOOSE_MAX_CONCURRENT_SUBAGENTS` 默认 5 [G-sm]。
- **权限模式**。四种，默认 Auto [G-mode]；SmartApprove 的判定流程见 [G-perm]。
- **上下文管理**。自动压缩阈值默认 0.8 [G-cmlib] [G-cm]；工具对摘要的阈值随窗口变化（测试用例：128k 窗口为 15 对，200k 为 24 对）[G-cutoff] [G-cutofftest]；provider 自己管理上下文时跳过压缩 [G-sm]；turn context 只在窗口不少于 32k 时注入 [G-moim]。
- **.goosehints**。默认文件名 `.goosehints` 和 AGENTS.md，可用 `CONTEXT_FILE_NAMES` 改；全局文件在配置目录，项目文件逐级加载 [G-hints]。
- **lead/worker 模型设置**。v1.28.0 还有 `providers/lead_worker.rs`：前几轮用 lead 模型，之后用 worker 模型，连续失败时回退到 lead [G-lwold] [G-lwpr]。2026-03-18 合入的 PR #7989 整体删除了它（含桌面设置界面），PR 描述没有写删除理由（未核实）[G-lwpr] [G-lwcommit]。
- **调度**。基于 tokio-cron-scheduler，5 段 cron 自动补成 6 段，任务以 recipe 为单元 [G-sched]；scheduler 平台扩展让 agent 自己增删日程 [G-schedtool]。

### 刻意不做的功能（及理由）

- **mini-SWE-agent**：bash 之外没有工具，不保留 shell 会话，不压缩历史；理由见上文 README [M-readme]。SWE-agent 维护重心已转向 mini [S-readme]。
- **Cline v4**：plan 模式保留命令行（理由见上）[C-sysprompt]；不自动启用仓库内 MCP，避免打开仓库就运行仓库控制的服务 [C-repomcp]；new_task 在 SDK 运行时不可用 [C-newtask-gone]，focus chain 被移除，两者理由都未核实。
- **Goose**：禁止嵌套委派（报错信息没写理由，未核实）[G-nonest]；提示注入扫描默认关 [G-secmod]；lead/worker 删除理由未核实。
- **OpenHands**：MEMORY 目录下的日记文件不预载 [O-memory]；hook 的 ask 决策只在代码注释里列为将来功能 [O-hooktypes]；工具并行默认关（limit 为 1）[O-conc]。
- **Aider**：没有 MCP、子代理和沙箱；编辑距离模糊匹配被一个提前 return 关掉（理由未核实）[A-eb]；基于函数调用的编辑格式标为 Deprecated，报错提示需要按 get_edits/apply_edits 重构 [A-funcdep]。

## Crush 与 Letta Code

**Crush（v0.99.0）**
- LSP：edit、write、multiedit 写完文件后通知 LSP，并把诊断附在工具结果后面；另有独立 diagnostics 工具和 definition、references、symbols、call hierarchy、rename、replace symbol、restart 等 LSP 工具；`auto_lsp` 默认 true，按根目录标记自动配置 [R-edit] [R-diag] [R-lsptools] [R-autolsp]。
- 权限：判定顺序为 `--yolo` 全部放行、`allowed_tools`（工具名或"工具:动作"）、hook 预批准、会话级自动批准、已持久化的授权（会话、工具、动作、路径），最后才弹请求；请求由互斥锁串行处理 [R-perm] [R-allowed] [R-yolo]。
- 会话：SQLite `crush.db`，默认数据目录 `.crush` [R-db] [R-datadir]；Session 记录 ParentSessionID（子代理会话）、SummaryMessageID、token 与成本 [R-session]；剩余上下文不超过 20k（大窗口）或 20%（小窗口）时自动摘要 [R-summconst] [R-summ]。
- 其他：子代理 `agent` 工具只有 glob、grep、ls、view，可并行调用 [R-agenttool] [R-agentmd]；循环检测窗口 10 步、重复 5 次 [R-loop]；`crush run` 非交互执行 [R-run]。

**Letta Code（v0.34.36）**
- 记忆优先：memory block 是系统提示中可编辑的片段；非 MemFS agent 默认只有 persona、human 两块（技能类块已移出，改由 system reminder 注入）[L-blocks]；recall memory（全部消息历史）由 harness 自动保存，agent 不能改 [L-prompt]。
- MemFS：memory block 与外部记忆投影为 `$MEMORY_DIR` 下的 git 仓库，agent 用普通文件和 bash 工具修改并提交；改动要等下次编译提示才生效，不影响当前回合 [L-memfs] [L-memfsprompt]。`memory_filesystem` 块只读 [L-ro]；提交时由校验脚本强制每文件大小上限，并提示未经用户同意不得放宽 [L-constraints]。
- 反思：后台 reflection 子代理读对话转录，把可复用流程沉淀为技能、把行为失误写进提示；它不能向用户提问 [L-reflect]。提示要求记忆里不存密钥、块要精简 [L-prompt]。
- 权限模式：standard、acceptEdits、unrestricted、strict，默认 unrestricted [L-perm]；README 还列出后台子代理、cron/心跳和多消息渠道 [L-readme]。

## 对自建 harness 的启示

以下针对多 Agent 编排与 harness 整体，DevFlow 现状由另一份审计覆盖，本节不做判断。

1. **编排协议用结构化数据表达，流程交给模型决定，状态转换由运行时校验。** Cline 的团队运行时是一个现成蓝本：任务（`dependsOn` 推出 `isReady`/`blockedBy`，claim、complete 带 summary、block 带 reason）、邮件、mission log（kind + evidence + nextAction）、成果片段审阅 [C-teamtypes] [C-teamtask]。DevFlow 可以先定义任务、消息、成果三类实体和各自的状态机。
2. **给模型一个受限的编排 DSL。** OpenHands workflow 工具只暴露 run/map/reduce/pipeline，脚本本身不能碰文件和 shell，并发有上限 [O-workflow]。这样既能动态编排，也不会退化成写死的流程。
3. **子代理要可持久、可续跑，并继承预算。** OpenHands task 的子会话持久化、按 task_id 续跑，定义里没写预算和迭代上限时继承父会话 [O-taskmgr]；Goose 可以 resume 失败的委派 [G-summon]。
4. **先限制递归深度与并发，再按需放开。** Goose 禁止二级委派、并发 5 [G-nonest] [G-sm]；OpenHands delegate 上限 5，workflow 默认 8 [O-delegate] [O-workflow]。
5. **写代码的并行子代理默认隔离。** OpenHands 子会话默认独立 worktree 与分支 [O-child]，Cline CLI 有 `--worktree` [C-wtflag]；汇总放到单独的合并步骤。
6. **事件日志作为唯一事实来源。** 压缩只追加 Condensation 事件、不删原事件，fork、切分支、恢复都建立在同一份日志上 [O-condevt] [O-fork]，审计与回放也就有了依据，这一点在面试中也容易讲清楚。
7. **权限分两层：风险评估与确认策略分开；plan 模式要有硬守卫。** [O-policy] [C-guard]。模型自报的风险会受注入影响 [O-llmrisk]，应与规则或模式分析器组合使用 [O-secdir]。
8. **卡死与循环检测采用"先提示、再终止"两级。** OpenHands 四种模式加一次提示 [O-stuck]，Cline soft 3 / hard 5 [C-loopdet]，Crush 窗口 10、重复 5 次 [R-loop]。
9. **完成判定交给外部检查。** SWE-agent 提交前回显 diff 并要求二次确认 [S-submit]，Goose recipe 跑 shell 检查 [G-retrytypes]，OpenHands 有 Stop hook、critic 和 goal 判官 [O-run] [O-critic] [O-goal]，Aider 的 lint/test 反射有 3 次上限 [A-lintloop] [A-attrs]。
10. **把上下文和输出预算写成显式参数。** 压缩阈值、保留的近期 token、工具输出上限与落盘路径（OpenHands 50000 字符并存文件，Goose 50KB 与 200000 字符，mini 头尾各 5000）[O-trunc] [G-shell] [G-large] [M-mini]；编辑格式按模型配置，失败时把错误回灌给模型（Aider）[A-msfile] [A-apply]。

## 来源

版本与发布日期来自 GitHub API（`repos/<repo>/releases/latest`、`commits`，2026-10-31 查询）；提交日期取自本地浅克隆的 `git log -1`。

| 项目 | 仓库 | 记录版本 | 提交 SHA | 提交日期 |
|---|---|---|---|---|
| Aider | https://github.com/Aider-AI/aider | 主干 main（最近 release v0.86.0，2025-08-09；最新 tag v0.86.2） | 5dc9490bb35f9729ef2c95d00a19ccd30c26339c | 2026-05-22 |
| OpenHands SDK | https://github.com/OpenHands/software-agent-sdk | v1.59.0（release 2026-10-28） | ccae18cb897bef7960f210aa3f380b577a84be7c | 2026-10-28 |
| OpenHands 应用（Agent Canvas） | https://github.com/OpenHands/OpenHands | v1.34.0（release 2026-10-27） | 6c120073f5a1e1c838ba6fdd9a075c79ff997b98 | 2026-10-27 |
| OpenHands automation | https://github.com/OpenHands/automation | 主干 main（只读 README） | 407bf8a021cce90656ee8d92292bd742b550080f | 2026-10-30 |
| SWE-agent | https://github.com/SWE-agent/SWE-agent | 主干 main（最近 release v1.1.0，2025-05-22） | 3ea751c087f32b16e039a2233dd6eefecef325d5 | 2026-07-16 |
| mini-SWE-agent | https://github.com/SWE-agent/mini-swe-agent | v2.4.6（release 2026-07-23） | a83fcae82d2a08f0ee0c688f9d137b3566c097f8 | 2026-07-22 |
| Cline | https://github.com/cline/cline | v4.1.26（release 2026-10-26） | a459f1d04dea030833b558be645011ab739c463b | 2026-10-25 |
| Cline 旧版 | https://github.com/cline/cline | v3.89.2（最后一个 v3 tag） | e1bdeeff68e95734901c7a4b3a31753bae54a634 | 2026-06-11 |
| Goose | https://github.com/aaif-goose/goose（block/goose 重定向至此） | v1.57.0（release 2026-10-28） | 30bba95105e59bc3e7df624cf6b4d433690cfe12 | 2026-10-27 |
| Goose lead/worker 删除 | https://github.com/aaif-goose/goose/pull/7989 | PR #7989（合入 2026-03-18） | 6435e1a85c97caffca810fafa6b000df962416be | 2026-03-18 |
| Goose 删除前版本 | https://github.com/aaif-goose/goose | v1.28.0（仍含 lead_worker.rs） | 7b64ef1cbae8404cc9e040150d3423a300ce946d | 2026-03-18 |
| Crush | https://github.com/charmbracelet/crush | v0.99.0（release 2026-10-29） | e38655aac84ab3704a1a96928017e1d9ef1d0043 | 2026-10-29 |
| Letta Code | https://github.com/letta-ai/letta-code | v0.34.36（release 2026-10-31） | 8f72222dec142dfc2316692d68ada3ab2e439d46 | 2026-10-31 |
| 方面清单 | https://learn.shareai.run/zh/ | 本次未抓取，章节名取自任务说明 | — | — |

<!-- 以下为正文引用的行号链接定义（Markdown 参考式链接，渲染时不显示） -->

[A-lb]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_data/polyglot_leaderboard.yml#L1715-L1743
[A-lbarch]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_data/polyglot_leaderboard.yml#L1570-L1600
[A-lbo3pro]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_data/polyglot_leaderboard.yml#L1601-L1630
[A-lbgem]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_data/polyglot_leaderboard.yml#L1456-L1485
[A-lbdoc]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/leaderboards/index.md#L15
[A-swelite]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_posts/2024-05-22-swe-bench-lite.md#L11-L15
[A-swemain]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_posts/2024-06-02-main-swe-bench.md#L11-L13
[A-runone]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L924-L944
[A-attrs]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L97-L117
[A-apply]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2296-L2328
[A-shell]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2434-L2445
[A-lintloop]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1596-L1623
[A-retry]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1449-L1505
[A-retrytimeout]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L26
[A-cost]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1994-L2068
[A-chunks]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1226-L1338
[A-fmt]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1174-L1225
[A-warm]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1340-L1395
[A-autocommit]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2375-L2395
[A-chunk-cache]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/chat_chunks.py#L28-L67
[A-rm]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L365-L574
[A-rmweights]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L470-L530
[A-rmbs]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L629-L708
[A-rmbudget]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L103-L133
[A-rmrefresh]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L576-L627
[A-rmcache]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L43
[A-maptok]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L782-L789
[A-msc]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L128-L158
[A-generic]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L437-L560
[A-maxhist]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L356-L358
[A-msfile]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/resources/model-settings.yml
[A-ms]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/resources/model-settings.yml#L1612-L1622
[A-msgem]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/resources/model-settings.yml#L1460-L1466
[A-eb]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/editblock_coder.py#L157-L188
[A-udiff]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/udiff_coder.py#L16-L119
[A-arch]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/architect_coder.py#L1-L48
[A-lint]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/linter.py#L82-L160
[A-commit]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repo.py#L131-L296
[A-commitmsg]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repo.py#L326-L340
[A-undo]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py#L553-L656
[A-hist]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/history.py#L7-L125
[A-args-cache]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L233-L246
[A-args-git]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L440-L497
[A-args-lint]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L534-L559
[A-args-arch]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L172-L184
[A-args-hist]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L274-L296
[A-args-yes]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L760-L765
[A-args-read]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L736
[A-args-msg]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L639
[A-args-ignore]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L427
[A-conf]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/main.py#L464-L477
[A-watch]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/watch.py#L66-L71
[A-modes]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/usage/modes.md#L11-L18
[A-scripting]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/scripting.md#L63
[A-docker]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/docker/Dockerfile
[A-funcdep]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/wholefile_func_coder.py#L45-L48
[A-commitmodels]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L622-L623

[O-init]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L228-L245
[O-run]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L1982-L2150
[O-stuckcall]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L787-L811
[O-budget]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L762-L785
[O-fork]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L840-L1012
[O-pathrules]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L607-L684
[O-confirmapi]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L2697-L2810
[O-ask]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L2939-L2950
[O-events]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/persistence_const.py#L1-L10
[O-eventlog]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/event_store.py#L38-L300
[O-state]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/state.py#L128-L131
[O-statecreate]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/state.py#L457-L632
[O-stuck]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/stuck_detector.py#L20-L230
[O-stuckth]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/types.py#L148-L161
[O-cond]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L54-L90
[O-conddef]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L558-L566
[O-condevt]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/event/condenser.py#L11-L100
[O-view]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/context/view/view.py#L111-L143
[O-stepcond]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/agent.py#L866-L905
[O-finish]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/agent.py#L238-L268
[O-refine]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/agent.py#L382-L415
[O-confirm]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/agent.py#L1163-L1261
[O-dyn]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/agent.py#L639-L662
[O-conc]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/base.py#L302-L310
[O-par]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/parallel_executor.py#L1-L66
[O-policy]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/security/confirmation_policy.py#L9-L61
[O-risk]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/security/risk.py#L8-L38
[O-llmrisk]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/security/llm_analyzer.py#L10-L29
[O-secdir]: https://github.com/OpenHands/software-agent-sdk/tree/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/security
[O-critic]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/critic/base.py#L20-L115
[O-goal]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/goal/controller.py#L78-L130
[O-hooktypes]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/hooks/types.py#L9-L40
[O-hookcfg]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/hooks/config.py#L60-L300
[O-skill]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/skills/skill.py#L182-L231
[O-thirdparty]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/skills/skill.py#L346-L352
[O-skilldirs]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/skills/skill.py#L960-L1095
[O-trigger]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/skills/trigger.py#L13-L45
[O-skillpaths]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/skills/skill.py#L546-L575
[O-memory]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/context/memory.py#L1-L10
[O-ctx]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/context/agent_context.py#L83-L200
[O-mcp]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/mcp/utils.py#L45-L71
[O-mcplist]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/mcp/utils.py#L323-L435
[O-secret]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/conversation/secret_registry.py#L285-L320
[O-redact]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-agent-server/openhands/agent_server/_secret_redaction.py#L1-L20
[O-llmretry]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/llm/llm.py#L379-L392
[O-llmcfg]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/llm/llm.py#L534-L670
[O-otel]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/observability/laminar.py#L23-L35
[O-acp]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/agent/acp_agent.py#L1-L12
[O-server]: https://github.com/OpenHands/software-agent-sdk/tree/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-agent-server/openhands/agent_server
[O-docker]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-workspace/openhands/workspace/docker/workspace.py#L53-L125
[O-remote]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-workspace/openhands/workspace/remote_api/workspace.py#L19-L135
[O-delegate]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/delegate/impl.py#L42-L372
[O-delegatedef]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/delegate/definition.py#L13-L47
[O-task]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/task/definition.py#L48-L240
[O-taskmgr]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/task/manager.py#L100-L307
[O-child]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/child_conversation/definition.py#L36-L100
[O-workflow]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/workflow/definition.py#L24-L100
[O-subload]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/subagent/load.py#L1-L52
[O-tracker]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/task_tracker/definition.py#L29-L200
[O-planning]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/preset/planning.py#L91-L115
[O-termconst]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/terminal/constants.py#L18-L31
[O-term]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/terminal/definition.py#L102-L160
[O-trunc]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-sdk/openhands/sdk/utils/truncate.py#L12-L30
[O-fe]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/file_editor/definition.py#L26-L60
[O-feimpl]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools/file_editor/editor.py#L68-L90
[O-toolsdir]: https://github.com/OpenHands/software-agent-sdk/tree/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-tools/openhands/tools
[O-wsdir]: https://github.com/OpenHands/software-agent-sdk/tree/ccae18cb897bef7960f210aa3f380b577a84be7c/openhands-workspace/openhands/workspace
[O-readme]: https://github.com/OpenHands/software-agent-sdk/blob/ccae18cb897bef7960f210aa3f380b577a84be7c/README.md#L15
[O-app]: https://github.com/OpenHands/OpenHands/blob/6c120073f5a1e1c838ba6fdd9a075c79ff997b98/README.md#L1-L40
[O-appagents]: https://github.com/OpenHands/OpenHands/blob/6c120073f5a1e1c838ba6fdd9a075c79ff997b98/AGENTS.md
[O-auto]: https://github.com/OpenHands/automation/blob/407bf8a021cce90656ee8d92292bd742b550080f/README.md

[S-readme]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/README.md#L19-L44
[S-default]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/config/default.yaml#L1-L69
[S-07]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/config/sweagent_0_7/07.yaml#L1-L101
[S-wininstall]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/windowed/install.sh#L9-L10
[S-wincfg]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/windowed/config.yaml
[S-winfile]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/windowed/lib/windowed_file.py#L59-L150
[S-lintedit]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/windowed_edit_linting/bin/edit#L27-L120
[S-search]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/search/bin/search_dir#L18-L30
[S-filemap]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/filemap/config.yaml
[S-filemapuse]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/edit_anthropic/bin/str_replace_editor#L490-L497
[S-strrep]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/edit_anthropic/bin/str_replace_editor#L28-L51
[S-submit]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/review_on_submit_m/bin/submit#L15-L40
[S-hp]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/history_processors.py#L85-L303
[S-trunc]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py#L67-L79
[S-fwh]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py#L1062-L1180
[S-autosub]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py#L823-L870
[S-retry]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py#L188-L442
[S-requery]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/agents.py#L149-L160
[S-reviewer]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/reviewer.py#L30-L190
[S-filter]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/tools/tools.py#L29-L73
[S-timeouts]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/tools/tools.py#L139-L150
[S-models]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/models.py#L55-L108
[S-env]: https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/environment/swe_env.py#L27-L28
[S-hooks]: https://github.com/SWE-agent/SWE-agent/tree/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/run/hooks
[S-run]: https://github.com/SWE-agent/SWE-agent/tree/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/run

[M-default]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/agents/default.py#L19-L156
[M-local]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/environments/local.py#L14-L80
[M-interactive]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/agents/interactive.py#L1-L170
[M-mini]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/config/mini.yaml#L101-L126
[M-litellm]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/models/litellm_model.py#L33-L112
[M-retry]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/models/utils/retry.py#L9-L24
[M-envs]: https://github.com/SWE-agent/mini-swe-agent/tree/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/src/minisweagent/environments
[M-readme]: https://github.com/SWE-agent/mini-swe-agent/blob/a83fcae82d2a08f0ee0c688f9d137b3566c097f8/README.md#L28-L50

[C-arch]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/ARCHITECTURE.md
[C-modes]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/session/runtime-config.ts#L3
[C-presets]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/presets.ts#L20-L115
[C-guard]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/command-guard-extension.ts#L1-L85
[C-sysprompt]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/prompt/cline.ts#L15-L200
[C-loop]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/agents/src/agent-runtime.ts#L791-L1030
[C-retry]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/agents/src/agent-runtime.ts#L72-L91
[C-exec]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/agents/src/agent-runtime.ts#L2360-L2395
[C-approval]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/agents/src/agent-runtime.ts#L2490-L2560
[C-usage]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/agents/src/agent-runtime.ts#L2345-L2355
[C-policy]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/llms/tools.ts#L7-L18
[C-tools-defs]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/definitions.ts#L270-L890
[C-ckpt]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/hooks/checkpoint-hooks.ts#L10-L480
[C-ckpthook]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/hooks/checkpoint-hooks.ts#L497-L660
[C-restore]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/session/checkpoint-restore.ts#L50-L260
[C-compact]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/context/compaction-shared.ts#L15-L37
[C-compactmain]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/context/compaction.ts#L45-L575
[C-rules]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts#L125-L690
[C-hookcfg]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/hooks/hook-file-config.ts#L18-L41
[C-paths]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/storage/paths.ts#L35-L60
[C-hookpaths]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/storage/paths.ts#L480-L520
[C-mcppath]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/storage/paths.ts#L440-L455
[C-repomcp]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/storage/paths.ts#L626-L640
[C-cronpaths]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/storage/paths.ts#L260-L370
[C-mcpname]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/mcp/name-transform.ts#L24
[C-teamtypes]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/team/types.ts#L9-L170
[C-teamtools]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/team/team-tools.ts#L300-L860
[C-teamtask]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/team/team-tools.ts#L396-L500
[C-multi]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/team/multi-agent.ts#L587-L1100
[C-teampersist]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/team/multi-agent.ts#L39-L60
[C-spawn]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/extensions/tools/team/spawn-agent-tool.ts#L100-L160
[C-loopdet]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/runtime/safety/loop-detection.ts#L70-L116
[C-pending]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts#L14-L45
[C-cron]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/shared/src/cron/cron-spec-types.ts#L1-L60
[C-wt]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/cli/src/utils/worktree.ts#L1-L20
[C-wtflag]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/cli/src/commands/program.ts#L85-L86
[C-cli]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/cli/src/main.ts#L800-L990
[C-acp]: https://github.com/cline/cline/tree/a459f1d04dea030833b558be645011ab739c463b/apps/cli/src/acp
[C-newtask-gone]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/vscode/src/sdk/builtin-slash-commands.ts#L1-L14
[C-legacy]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/vscode/src/sdk/legacy-state-reader.ts#L196
[C-otel]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/core/src/services/telemetry/OpenTelemetryAdapter.ts
[C-evals]: https://github.com/cline/cline/tree/a459f1d04dea030833b558be645011ab739c463b/evals
[C-ignore]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/apps/vscode/src/core/ignore/ClineIgnoreController.ts
[C-cache]: https://github.com/cline/cline/blob/a459f1d04dea030833b558be645011ab739c463b/sdk/packages/llms/src/providers/routing/anthropic-compatible.ts#L130-L140

[CL-ckpt]: https://github.com/cline/cline/blob/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/integrations/checkpoints/CheckpointTracker.ts#L40-L370
[CL-ckptutil]: https://github.com/cline/cline/blob/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/integrations/checkpoints/CheckpointUtils.ts#L10-L66
[CL-ckptgit]: https://github.com/cline/cline/blob/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/integrations/checkpoints/CheckpointGitOperations.ts#L59-L95
[CL-focus]: https://github.com/cline/cline/blob/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/core/task/focus-chain/index.ts#L31-L235
[CL-newtask]: https://github.com/cline/cline/blob/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/core/task/tools/handlers/NewTaskHandler.ts#L18-L66
[CL-auto]: https://github.com/cline/cline/blob/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/core/task/tools/autoApprove.ts#L8-L130
[CL-handlers]: https://github.com/cline/cline/tree/e1bdeeff68e95734901c7a4b3a31753bae54a634/apps/vscode/src/core/task/tools/handlers

[G-sm]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/state_machine_builder.rs#L46-L147
[G-smmod]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/state_machine/mod.rs#L1-L6
[G-tools]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/agent.rs#L480-L500
[G-stopcap]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/agent.rs#L56
[G-maxturns]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/config/base.rs#L1339-L1341
[G-mode]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose-provider-types/src/goose_mode.rs#L22-L32
[G-perm]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/permission/permission_inspector.rs#L150-L262
[G-ext]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/extension.rs#L155-L215
[G-platdir]: https://github.com/aaif-goose/goose/tree/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions
[G-malware]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/extension_malware_check.rs
[G-summon]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/summon.rs#L450-L535
[G-nonest]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/summon.rs#L868-L876
[G-subturns]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/summon.rs#L1430-L1437
[G-recipe]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/recipe/mod.rs#L44-L130
[G-retrytypes]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/types.rs#L1-L63
[G-final]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/final_output_tool.rs
[G-cm]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/context_mgmt/mod.rs#L21-L160
[G-cutoff]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/context_mgmt/mod.rs#L383-L390
[G-cutofftest]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/context_mgmt/mod.rs#L1126-L1129
[G-tpc]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/state_machine/ops_tool_pair_compaction.rs
[G-cmlib]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose-context-management/src/lib.rs#L32
[G-hints]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/hints/load_hints.rs#L10-L300
[G-pm]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/prompt_manager.rs#L90-L126
[G-moim]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/moim.rs#L1-L30
[G-todo]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/todo.rs#L18-L170
[G-large]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/large_response_handler.rs#L5-L75
[G-shell]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/developer/shell.rs#L161-L178
[G-edit]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/developer/edit.rs#L36-L130
[G-analyze]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/analyze/mod.rs#L31-L70
[G-sched]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/scheduler/full.rs#L100-L170
[G-schedtool]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/scheduler.rs
[G-hooks]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/hooks/mod.rs#L1-L75
[G-hookload]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/hooks/mod.rs#L422-L440
[G-skills]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/skills/mod.rs#L45-L51
[G-secmod]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/security/mod.rs#L60-L82
[G-steer]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/state_machine/ops_steer.rs#L1
[G-session]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/session/session_manager.rs#L34
[G-cost]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/session/session_manager.rs#L90-L140
[G-ccost]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/providers/canonical_cost.rs#L1-L5
[G-acpcli]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose-cli/src/cli.rs#L834-L835
[G-container]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose-cli/src/cli.rs#L143-L148
[G-monitor]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/tool_monitor.rs#L35-L51
[G-mem]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose-mcp/src/memory/mod.rs#L65-L100
[G-recall]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/agents/platform_extensions/chatrecall.rs
[G-otel]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/otel/otlp.rs
[G-toolshim]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose/src/providers/toolshim.rs
[G-sdk]: https://github.com/aaif-goose/goose/blob/30bba95105e59bc3e7df624cf6b4d433690cfe12/crates/goose-sdk/Cargo.toml#L9
[G-lwpr]: https://github.com/aaif-goose/goose/pull/7989
[G-lwcommit]: https://github.com/aaif-goose/goose/commit/6435e1a85c97caffca810fafa6b000df962416be
[G-lwold]: https://github.com/aaif-goose/goose/blob/7b64ef1cbae8404cc9e040150d3423a300ce946d/crates/goose/src/providers/lead_worker.rs

[R-perm]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/permission/permission.go#L76-L300
[R-allowed]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/config/config.go#L412
[R-autolsp]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/config/config.go#L457
[R-datadir]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/config/config.go#L446-L450
[R-diag]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/tools/diagnostics.go#L27-L130
[R-edit]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/tools/edit.go#L94-L100
[R-lsptools]: https://github.com/charmbracelet/crush/tree/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/tools
[R-session]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/session/session.go#L51-L66
[R-summ]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/agent.go#L1125-L1142
[R-summconst]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/agent.go#L57-L60
[R-agenttool]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/agent_tool.go#L23-L45
[R-agentmd]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/templates/agent_tool.md
[R-loop]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/agent/loop_detection.go#L11-L13
[R-db]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/db/connect.go#L93
[R-yolo]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/cmd/root.go#L61
[R-run]: https://github.com/charmbracelet/crush/blob/e38655aac84ab3704a1a96928017e1d9ef1d0043/internal/cmd/run.go#L33-L34

[L-blocks]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/memory.ts#L1-L20
[L-ro]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/memory-constants.ts#L1
[L-constraints]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/memory-constraints.ts#L14-L122
[L-memfs]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/memory-filesystem.ts#L1-L8
[L-prompt]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/prompts/letta.md#L12-L33
[L-memfsprompt]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/prompts/letta_local_memfs.md#L44-L46
[L-reflect]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/agent/subagents/builtin/reflection-v2.md#L1-L20
[L-perm]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/src/permissions/mode.ts#L1-L23
[L-readme]: https://github.com/letta-ai/letta-code/blob/8f72222dec142dfc2316692d68ada3ab2e439d46/README.md
