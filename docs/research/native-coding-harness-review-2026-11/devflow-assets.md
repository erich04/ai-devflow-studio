# DevFlow 做多 Agent 编排器：已有积木与阻碍

依据：无前缀路径指 main（在本机另一个工作树阅读，HEAD `56cfa7e` 与 origin/main `2fbb037` 同树）；`v3:` 指本机 v3 工作树的 `1108087`（PR #238，draft，OPEN）。缩写：`electron/` = `apps/desktop/electron/`，`shared/` = `packages/shared/src/`；`loop.ts`、`harness.ts` 指 v3 的 `electron/native-coding-loop.ts`、`electron/native-coding-harness.ts`；`live` 指 `v3: docs/evaluation/native-coding-v3-live-20261011.md`；`roadmap` 指 `docs/plans/v3.x-agent-runtime-capability-roadmap.md`；`PRD` 指 `docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md`；`guard` 指 `electron/opencode-task-guard.ts`。只读调查，没有运行测试、应用或模型。事实基线见同目录 `current-devflow.md`，本文不重复。

## 一句话结论

编排器需要的零件大多已经有了，但分在两套互不相连的实现里：V2.2 有任务图校验、租约、租户隔离和取消树，却从不调用模型；v3 有可持久恢复的模型工具循环、一层委派、隔离工作区、三方合入和根/子预算，却只在编码节点内，模型在真实任务里从没主动委派过，完成判定又只靠实现者自己跑的公开测试（r8 报告完成 5 次，独立验收全部失败）。要做的是把 v3 循环抽成通用内核，让 lead 显式规划出可校验、可改版的任务图，把人工 Gate 改成宿主强制的检查点，并加入独立验证角色；审批、预算准入、可信写入、隐私和不重放副作用必须保留，固定模板、深度 1、单运行节点和 CHECK 枚举都可以改。

## 可复用的积木

| 组件 | 位置 | 成熟度 | 限制 |
|---|---|---|---|
| 模型工具循环（编码） | `v3: electron/native-coding-loop.ts:25-331`（批次 `99-221`，执行待办调用 `223-313`）；工具与 Provider 由宿主注入（`:8-14,29`） | 草稿分支；lifecycle 11 例、session 8 例；真实模型交互 12/12（`live:64,66`） | 会话类型是编码专用（`v3: electron/native-coding-session.ts:16-64` 含 binding、revisions、acceptance）；提示词是常量，只分 root 和只读（`loop.ts:16-17`）；r8 独立验收 0/10 |
| 讨论栏原生循环与提案核对 | `electron/native-conversation.ts:72`；工具 `electron/native-conversation-tools.ts:5-11`；另起一次调用逐条核对提案（`native-conversation.ts:229`）；1–60 步、30–600 秒（`electron/investigation-policy.ts:40-50`） | 产品在用 | 只读，只能保存候选提案；不能委派 |
| Gate 审查 Agent（内置只读循环） | `electron/knowledge-review-native.ts:28-118`：≤12 步（`:56`）、≤12 次工具（`:71`）、240 秒（`:37`）；引用必须指向已读文件，审查期间仓库不能变（`:85-96`） | 产品在用 | 只给建议，是否阻断由团队策略决定；审查维度按阶段写死（`shared/agent-review.ts:1295-1325`）；每轮一个 JSON 工具请求，不是原生工具调用 |
| 阶段 Agent 插槽 | `shared/workflow-agent.ts:66-97`（`StageAgentExecutor.execute`），只读能力 `:55-64`，限额 `:47-53` | 产品在用（clarify/design） | 输出必须是阶段产物 JSON；没有持久会话；每个 Run 同时一次（`electron/stage-agent-operations.ts:3-16`） |
| 编码执行器描述符与能力选择 | `shared/coding-executor.ts:6-31,544-571`；v3 描述符 version 3（`v3: electron/native-coding-harness.ts:490`） | 产品在用 | 种类只有 opencode/native；能力描述工作区操作，不描述角色；缺能力直接拒绝，不回退 |
| V2.0 Agent Runtime 状态机 | `shared/agent-runtime.ts`（`canRunAgentRuntimeOnNode` `:176-178`）；桌面 `electron/agent-runtime-runtime.ts:332-413` | 21+21 例；只在 设置›高级（`apps/desktop/src/App.tsx:1283-1306`） | “决定”一步写死为 `workflow.evaluate`（`:349-358`），默认 1 步、1 token、费用 `Number.EPSILON`（`:528-535`）；v3 借它为每次工具调用签一次性授权与审计（`v3: electron/native-coding-tools.ts:266-330`） |
| V2.2 协调领域 | 任务图校验 `shared/agent-coordination.ts:641-769`（≤12 节点、≤24 边、无环、入口等于根、角色须已登记），硬上限 `:10-19`，交接 `:883`，租约 `:1082-1240`，会话迁移 `:1439-1939`；授权代理 `electron/specialist-task-authority.ts:111-260`；团队投影的角色是正则字符串而非枚举（`apps/api/src/db/migrations/0019_agent_coordination_team_projection.sql:20,144-147`） | 共享 92 例、授权 30 例、计划 7 例；产品只在诊断入口 | 唯一计划 `bounded-repair-v1`、3 个写死角色（`electron/agent-coordination-plan.ts:14,107-170`；`electron/specialist-runtime-registry.ts:10-55`）；面板自述“不会根据当前设计任务动态规划”（`apps/desktop/src/AgentCoordinationPanel.tsx:239`） |
| 持久会话与收据 | `v3: native-coding-session.ts:16-64`；收据只追加，终态不能复活（`:134,141`）；工具先记 started 收据再执行，失败按收据对账（`loop.ts:273,283,302`）；交付未知进入 reconciling（`:123,209`），只有人能授权新尝试（`harness.ts:435-438`）；迟到回复只记用量（`loop.ts:168,192`） | 草稿；有真实杀进程、重启场景 | 绑定单个编码节点；存本机 SQLite |
| 写者租约 | `v3: loop.ts:105-118`（epoch CAS、120 秒，先确认旧进程已停 `harness.ts:173-176`）；V2.2 资源租约单写者、≤60 秒（`shared/agent-coordination.ts:19,1044,1177`） | v3 草稿；V2.2 只在诊断入口 | 一个会话一个写者；两套租约互不相通 |
| 委派工具 | `v3: native-coding-tools.ts:50-54`；`harness.ts:189-260`：只有根能委派（`:191`）、同时 ≤3（`:193`）、子额度是子集（`:194`）、编码子任务须给可写路径（`:195`）、冻结基线和独立工作区（`:205-221`）、`await_task` 最多等 5 秒（`:239-245`）、子任务结束后用带来源标记的宿主通知唤醒父任务（`:277-283,305-307`） | 草稿；lifecycle 3 例（`v3: electron/native-coding-harness-lifecycle.test.ts:158,199,241`） | 深度 1；父任务要轮询；子任务不能批准（`harness.ts:448`） |
| 任务预算账本 | `v3: shared/model-call-budget.ts:7`（`ModelTaskBudget`），层级校验 `:69`，根/子上限 `:77-95`；API 准入 `v3: apps/api/src/repositories/model-call-budget.ts:22-23`；同项目咨询锁 `apps/api/src/repositories/postgres-team-repository.ts:1963-1965`（main 与 v3 都有） | 任务额度只在 v3（main 无 `ModelTaskBudget`）；`v3: apps/api/src/repositories/model-call-budget.test.ts:10`、`v3: scripts/model-budget-postgres.test.ts:88` | 只有两层（`:69` 要求父任务就是根）；只给编码用；不能按角色分配 |
| 受治理 Provider | `shared/governed-provider.ts:15-73`（预留、持久化、调用、结算，未知不重发），`governAgentProvider` `:75` | 产品所有入口 | 逐次准入；main 没有任务级额度 |
| 隔离工作区 | main 每次编码一个 git worktree（`electron/coding-runner.ts:118-133`）；v3 私有候选 C、交付 D、验证 V（`v3: docs/adr/0029-native-coding-harness-v3.md:13-20`；`v3: electron/coding-candidate-workspace.ts:111-160,208`） | main 产品；v3 草稿 | main 每个项目同时只有一个活动 Coding Run（`electron/coding-runtime.ts:3012-3016`） |
| 三方合入 | `v3: electron/coding-child-merge.ts:12-70`（`git merge-file`，二进制或权限冲突即停，按日志应用） | 草稿；3 例（`coding-child-merge.test.ts:21,33,40`） | 冲突交回父任务处理；文本合并，没有语义检查 |
| 只读工具集 | `shared/native-readonly-tools.ts:4-19,30,48-49`（流程、节点、产物、需求、仓库、知识、记忆等 13 个，每批 ≤16）；阶段能力 `shared/workflow-agent.ts:55-64`；v3 只读子任务过滤 `v3: native-coding-tools.ts:73`；同一组工具经 MCP 桥提供给 OpenCode（`electron/workbench-mcp-bridge.ts:60-83`） | 产品在用 | 讨论栏和编码各有一套工具，名字和语义不同 |
| OpenCode 有界子任务 | `electron/opencode-task-guard.ts:36-203`（禁嵌套 `:142`、串行 `:143`、额度在 I/O 前锁住 `:65-75`）；`docs/engineering/opencode-bounded-tasks.md:9-11` | 产品在用；契约与 Electron 测试只用合成模型（`docs/plans/issue-237-bounded-tasks-20261016.md:19`） | 同时 1 个、≤4 次委派、24 次工具、32 次模型调用；DevFlow 只看得到适配器事件（ADR 0015） |
| 记忆召回 | `electron/project-memory-recall.ts:25-33`（recall/assertCurrent 端口，供编码简报、阶段、Gate 审查、讨论栏），`:54-108`；不可用时降级，不阻断（`:70-74`） | 产品在用（Hindsight） | 低信任背景，不能作证据；v3 编码循环没有记忆工具，只用开工简报 |
| 知识检索 | `shared/native-readonly-tools.ts:12-14`（带 sourceRef/expectedDigest 回读）；宿主 `electron/main.ts:2694-2698` | 产品在用 | 只有讨论栏把它当工具；v3 只能读开工时打包的来源（`v3: harness.ts:124`；`native-coding-tools.ts:42`）；知识不是 Gate 证据（ADR 0007） |
| Gate 机制 | `shared/enforcement.ts:403,562`（按 Run 和节点评估策略与例外）；`shared/gates.ts:15-21`；审查对象快照 `shared/gate-review-subject.ts:8-39`；Web 命令由桌面用同一转换函数应用（`electron/gate-command-processor.ts:687`）；v3 节点内人工批准冻结修订（`v3: harness.ts:447-460`） | 产品在用（v3 批准在草稿） | Gate 位置与角色写在模板里（`shared/workflow.ts:130,153,198`）；只能批准 gate 或 acceptance 类节点（`shared/gates.ts:16-18`） |

## 阻碍与约束

### 必须保留的不变量

| 规则 | 位置 | 为什么必须保留 |
|---|---|---|
| Agent 不能推进节点、批准或覆盖 Gate、发布，也不能把自己的输出当证据；子任务不能批准 | `docs/adr/0014-bounded-agent-runtime.md:21`；`docs/adr/0019-bounded-multi-agent-coordination.md:25`；`v3: harness.ts:448` | 职责分离；r8 说明实现者自报的完成不可靠 |
| 推进只由宿主的确定性评估器执行，并用乐观并发提交 | ADR 0012:55；`shared/workflow-transition.ts:98,499` | lead 可以提出命令，执行前仍要逐项查证据 |
| 每次真实模型调用单独预留、持久化、结算；交付未知不自动重发 | `shared/governed-provider.ts:15-73`；`v3: loop.ts:123,209`；`v3: harness.ts:435-438` | 真实费用；多个 Agent 并发时超支和重复扣费的风险更大 |
| 子额度是父额度的子集，根与子在同一准入事务里核算 | `v3: shared/model-call-budget.ts:69,77-95`；`postgres-team-repository.ts:1963-1965` | 并发子任务会读到同一份余额 |
| 只有主进程写 Run、产物和事件；证据必须属于命令节点；原始请求与澄清修订不可改写 | `electron/ipc-contract.ts:1543-1545`；`electron/local-store.ts:3798-3840` | 证据链可信的前提 |
| 业务规则只来自已批准产物；记忆、知识、网页和子任务结论都是低信任输入 | `shared/coding-agent.ts:222-236`；`electron/project-memory-recall.ts:25`；`v3: docs/plans/native-coding-harness-v3-20261011.md:413` | 防注入和需求漂移 |
| 团队只收脱敏元数据，提示、源码、补丁和输出留在本机 | `shared/remote-sync.ts:58`；ADR 0012:136；ADR 0019:53 | 本地执行与隐私边界（ADR 0003） |
| 重启只恢复确切持久版本，不重放已接受的工具、合入和命令；取消单调，迟到结果不提交 | ADR 0019:71；`v3: loop.ts:168,192,273,302`；`electron/stage-agent-operations.ts:3-35` | 防重复写入和重复扣费 |
| 同一个可写工作区只有一个写者 | ADR 0019:59；`v3: loop.ts:105-118` | 防文件与 Git 竞争。约束对象是工作区，各自隔离再显式合入在 v3 已可行 |
| 能力只能收窄；角色和工具由宿主登记，模型不能新建权限 | ADR 0019:41；`electron/specialist-runtime-registry.ts:105-109`；`v3: native-coding-tools.ts:73` | 防混淆代理 |
| 外部引擎内部的编排不算 DevFlow 多 Agent | `docs/adr/0015-governed-coding-executor.md:99`；ADR 0019:96 | DevFlow 看不到其内部轨迹，给不出证据 |

### 可以改的设计选择

| 规则 | 位置 | 为什么可以改 | 改时守住什么 |
|---|---|---|---|
| 每个 Run 都是同一条 8 节点模板 | `shared/workflow.ts:97-215` | 节点和边已逐行存 SQLite 且无 CHECK（`electron/local-store-schema.ts:254-282`），推进沿边通用查找 | 每个 Run 的结构可复算、可审计 |
| 状态机按 stage/kind 字面值检查证据 | `shared/workflow-transition.ts:110-310,659-824` | 证据要求可以改由节点声明的契约提供 | 仍由宿主评估，lead 不能自证 |
| 同一 Run 只能有一个 running 节点 | `shared/workflow-transition.ts:432-440` | 为线性链而写；并行分支只需要求每个运行节点的祖先都成功 | 下游开始前不得有其证据 |
| 整份 Run JSON 做乐观并发 | `electron/local-store.ts:11737-11739` | 并行分支会互相判为 stale；可改成节点级版本 | 乐观并发本身 |
| 认领时要求与规范创建结果逐字节相同 | `electron/local-store.ts:3985-3996` | 这样写只因为只有一个模板；可在认领里记下模板或计划版本，再按该版本复算 | 本地 Run 必须由认领快照确定地推出 |
| Postgres CHECK 枚举（stage、kind、状态、产物、边） | `apps/api/src/db/migrations/0001_initial.sql:111-162` | 迁移即可放宽；协调投影已经用正则角色 ID（`0019_…sql:20`） | 有界允许列表 |
| 团队节点投影只有 id/stage/kind/status/requiredRole | `shared/remote-sync.ts:58` | 字段取值可以扩展 | 只传元数据 |
| 委派深度 1 | `shared/agent-coordination.ts:14`；`v3: harness.ts:191`；`v3: model-call-budget.ts:69` | v3 方案自称“待验证的默认策略，不是已证明最优的数字”（`v3: docs/plans/native-coding-harness-v3-20261011.md:399`） | 保留硬上限和总 Agent 数，终止靠共享预算保证 |
| 同时 ≤3 个子任务；OpenCode 只能串行 1 个 | `v3: harness.ts:193`；`electron/opencode-task-guard.ts:142-143` | 同上；OpenCode 串行来自上游权限继承问题 | 并发受预算和租约约束 |
| 任务图在副作用前冻结，模型不能改图 | ADR 0019:31；PRD:84 | 不能重规划就无法适应；V3.4 已计划把模型分解编译进已验证 DAG（roadmap:257） | 每版图都过 `parseAgentTaskGraph`；版本只追加；已完成节点不可改写 |
| 唯一计划、3 个写死角色、提示词是常量 | `electron/agent-coordination-plan.ts:14`；`electron/specialist-runtime-registry.ts:10-55`；`v3: loop.ts:16-17` | V3.2 `SkillPackage` 可让角色成为带版本数据（roadmap:194） | 角色由宿主登记和审查 |
| 每个项目一个活动 Coding Run；每个 Run 一次阶段生成 | `electron/coding-runtime.ts:3012-3016`；`electron/stage-agent-operations.ts:8` | 真正需要的是交付工作树单写者和提交串行化 | 单写者 |
| 固定的小额度（OpenCode 24 次工具、v2 4,096 输出上限） | `docs/engineering/opencode-bounded-tasks.md:9`；`live:48-49` | r8 中 OpenCode 10 次有 7 次卡在 24 次工具上限，v2 有 10 次卡在输出上限 | 额度来自用户授权，可以追加（v3 `extend_limits`，`harness.ts:400-404`） |

## 自己做过的尝试与教训

**V2.2 协调为什么停在诊断入口**
- 当时没有可接入的模型循环。V2.0 运行时的“决定”写死为 `workflow.evaluate`（`electron/agent-runtime-runtime.ts:349-358`）；路线图记录通用桌面路径“近似单步”，专职 Agent 要到 V3.4 才“接入运行共享循环”（roadmap:66,72），V3.0 文档从未写出（roadmap:41）。
- 范围本来就是确定性的：PRD 要求默认执行器移除模型凭据，用确定性的监督和专职决定（PRD:145），并拒绝“模型改图”（PRD:84）。
- 评估没有测到模型收益。0.5→0.75 的质量提升是数据集里手写的期望值（`scripts/fixtures/v2.2-multi-agent-evaluation.json:86-87,141-142`），`shared/agent-coordination-evaluation.ts:422,466-467` 直接取平均，付费调用为 0；计划仍标“已完成”（`docs/plans/v2.2-multi-agent-execution-tenancy.md:5`）。
- 产品只接了启动、恢复、取消，“启动任务”由人点击（`AgentCoordinationPanel.tsx:194`）；专职运行时启动后没有代码把它推进到终态，`complete` 只在测试里调用（`electron/specialist-task-authority.test.ts:766-796`）。
- v3 的委派另起一套（子任务记在 `NativeCodingSession.children`），v3 分支对协调和运行时文件没有任何改动，两套机制互不相连。
- 启示：先有会用工具的模型循环，再做编排。V2.2 的图校验、授权代理、租约、取消树和团队投影可以作为编排器的安全外壳和“编译目标”。收益必须用真实任务和独立验收来量。

**v3 r8：错误成功，以及没人用的委派**
- r8（$3 上限，650 次调用，账面 $2.6584）：v3 的 10 次执行中 5 次报告完成，宿主运行的公开测试也都通过，独立验收却全部失败（02 为 80／81，04 为 104／111，05 为 41／46），连同 r6 共 6 次错误成功（`live:47,51`）。另有 2 次用满 80 步、1 次无效回复、2 次被预算拒绝。
- 原因：文档结论是 v3 把公开测试通过当作完成依据，而公开测试覆盖不到新行为（`live:51`）。代码上，最终验证只在 V 目录运行项目保存的测试并核对内容摘要（`v3: electron/coding-evidence-v3.ts:104-111`）；验收标准只在批准时由人逐条勾选（`v3: harness.ts:455-457`），评测中由操作者代为批准（`live:25`）。没有任何环节由实现者以外的一方依据已批准需求去检查。
- 我统计了主 checkout 下被忽略的 `out/native-v3-evaluation/` 中 `model-*.json` 的工具调用：r1–r8 对照轮 1,461 次模型返回里 `delegate_task` 为 0，r8 的 10 次 v3 执行共 493 次返回也为 0。委派只出现在明确要求委派的交互场景（interactive r1–r6 每轮 2–3 次；`v3: docs/evaluation/native-coding-v3-interactive-protocol.md:16`）。
- 交互轮暴露了父子协议问题：子任务结束后父任务没收到通知，于是重复询问（`live:62`）；模型把 `await_task` 和其他工具放在同一批，导致调用配对断裂（`live:63`）。修复方式是带来源标记的宿主通知，并要求控制工具单独调用（`live:79`）。
- 启示：完成判定必须独立于实现者，验收检查应在实现前依据已批准澄清写好并冻结，交给另一个只读验证角色执行。只提供委派工具不会带来分解，分解要由 lead 的显式规划步骤产生。父子消息要有宿主定义的协议。

**OpenCode 有界子任务**
- 上游 task 只继承 deny 规则：DevFlow 的 `* deny` 会被继承，allow 不会；原生 `task_id` 也不校验归属。于是只能用私有插件先建子会话、写好最小权限再放行（`docs/engineering/opencode-bounded-tasks.md:17-23`）。
- 结果只能串行：深度 1、同时 1 个、父任务等待时不能用工具（`:9`；guard `:142-143`）。额度要在 I/O 前锁住，否则模型会把工具报错当成下一轮继续消费（`:11`；guard `:65-75`）。
- 契约测试只用合成模型；r8 中 OpenCode 没有一次独立通过，7 次撞上 24 次工具上限（`live:49`）。
- 启示：外部引擎只适合当黑盒专职执行器，编排、权限和计数要由 DevFlow 自己掌握；固定的小额度会让任务做不完。

## 编排器可以放在哪里

| 影响 | A. 整个 Run 一个 lead | B. 每个阶段一个 lead | C. 只在编码节点 |
|---|---|---|---|
| Gate | 模板里的 Gate 改为 lead 请求的检查点，需要宿主维护“必需检查点”策略 | 不变，仍在阶段之间 | 不变；节点内已有人批准冻结修订（`v3: harness.ts:447-460`） |
| 产物 | 跨阶段上下文仍只靠已批准产物；新产物 kind 要改 TS 联合类型与 CHECK | 每个阶段仍产出一份正式产物，下游契约（`shared/coding-agent.ts:222-236`）不变；专职结果作为交接或 log 引用 | 不变：diff 加测试证据 |
| 预算 | 需要 Run 级根预算；现在只有项目月额度（`shared/domain.ts:565-572`）加逐次准入，账本只有两层 | 每次阶段生成一个根预算，需要把 `ModelTaskBudget` 推广到阶段 | 现成的根/子预算 |
| 团队同步 | 节点动态化要改 CHECK、`stagePosition`、Web 标签；或者节点投影不动，lead 进度走 0019 协调投影 | 节点不变；阶段内进度走 0019 投影 | 不变 |
| 恢复 | lead 会话要跨过可能持续数天的 Gate 等待，需要 v3 式持久会话、租约和收据；等待不计活动时长（`v3: docs/adr/0029-native-coding-harness-v3.md:30`） | 阶段生成现在没有持久会话，重启会丢掉全部并行工作，要补上 | 现成：收据、租约、子任务对账（`v3: harness.ts:540-575`） |
| 改动面 | 最大：工作流核心、认领比对、迁移、Web | 中：阶段入口、持久会话、投影 | 小：把根任务改成会规划的 lead，加验证角色 |
| 能否摆脱固定流程 | 能 | 外层仍是固定流程 | 只在编码内部 |

**把人工 Gate 改成 lead 必须请求、不能跳过的检查点。** v3 已有先例：模型调用 `propose_changeset` 后会话进入 review，只有人的 approve 命令能进入应用和验证，子任务不能批准（`v3: harness.ts:447-460`；`loop.ts:322-329`）；`request_user_input` 会进入持久的 waiting_input（`loop.ts:255-261`）。做法：
1. lead 调用控制工具请求检查点（种类加确切产物修订）。宿主核对该种类在团队策略的必需清单里（组织底线见 ADR 0010），创建或激活 gate 节点，绑定审查对象快照（`shared/gate-review-subject.ts:8-39`），lead 会话进入持久等待。
2. 批准仍只走桌面 `applyWorkflowCommand` 或 Web Gate 命令（`electron/gate-command-processor.ts:687`），角色和例外沿用 `shared/enforcement.ts:403,562`。
3. 不靠 lead 自觉，由宿主把能力挂在检查点后面：没有已批准澄清就不签编码能力（现已如此，`shared/coding-agent.ts:222-236`）；没有测试证据和 PR 审批就不签交付；Run 只有在策略要求的检查点全部成功后才能完成（参照 `shared/workflow-transition.ts:784-824`）。lead 可以多请求检查点，不能少。

**建议（只供讨论，未实现）**
- 先在 C 落地，接口按 A 设计：把 `NativeCodingLoop`（工具和 Provider 已可注入）抽成通用内核，会话类型去掉编码专用字段，符合路线图“不创建第二 Agent 运行时”（roadmap:336）。
- lead 的第一步是显式规划，输出一版任务图，经 `parseAgentTaskGraph` 校验后执行，允许追加新版本重规划。专职角色是宿主登记的数据（只读调查、隔离编码、验证），复用 v3 的委派、合入和根/子预算。
- 加独立验证角色：实现开始前依据已批准澄清写好验收检查，实现者看不到，lead 不能推翻其结论。
- 验证稳定后把 lead 提到 Run 级（A），Gate 按上面的检查点方式处理；B 不必单独做。
- 每一步都按 ADR 0019:77 与 roadmap:269 和单 Agent 基线比较，并用独立验收计分；r8 的结果（0/10 通过、6 次错误成功）可以作为起点。

## 未核实的点

- 没有运行测试、应用或模型；成熟度依据测试用例数、文档记录和产品入口判断。
- `delegate_task` 次数是我从被忽略的输出目录统计的，只计 `model-*.json` 的 toolCalls；OpenCode 运行的记录格式不同，也没有核对每个目录是否完整。
- V2.2 专职运行时能否经通用 `advanceAgentRuntime` IPC 推进未核实；只确认启动恢复时排除了协调运行时（`electron/local-store.ts:6543-6557`）。
- v3 的容器执行、跨平台恢复和大改动下的三方合入没有逐行核实；PR 仍是草稿，合并时可能变化。
- 动态节点对 Web 和渲染层的影响沿用基线的估计，没有再逐处核对。
- Run 级预算、检查点控制工具和验证角色都是建议，代码里不存在。
- r8 只覆盖 10 道题，文档自述它不能代替 31 题对照。
