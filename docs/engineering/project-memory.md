# 项目记忆（Hindsight）

设计依据：[ADR 0030](../adr/0030-hindsight-project-memory.md)。本文说明当前行为、配置方法和验证入口。项目记忆是 DevFlow 唯一的记忆：未开启时没有记忆，不再使用本地 Agent 记忆。

## 当前行为

开启后，DevFlow 自动把以下内容写入项目的 Hindsight bank，由 Hindsight 抽取事实并归纳观察：

| 来源 | 文档 id | 何时写入 |
|---|---|---|
| 讨论的公开消息 | `conversation:<id>`；长讨论的后续段为 `conversation:<id>:<n>` | 最后一段在对话空闲 3 分钟后发送，之后每轮替换；写满的段只发一次 |
| 结束的 Coding Run | `coding-run:<id>` | 运行结束时（任何结果，`fake` 除外） |
| 被批准的澄清、设计、验收包 | `artifact:<id>` | 审批通过时 |
| Gate 评审结果 | `artifact:<id>` | 保存时 |
| 旧版本地 Agent 记忆 | `legacy:agent-memory` | 开启时或启动时，每个 bank 一次 |
| Git 提交信息（当前分支最近 30 天） | `commits:<日期>` | 每 10 分钟检查；当天的在最后一个提交 30 分钟后 |

旧版记忆的迁移规则见 ADR 0030「旧记忆迁移与移除」：只复制当前归属用户在本项目可见的有效记忆；忘记这个来源或清空后不会再写入；本地数据不删除。

讨论按段写入（ADR 0030「长讨论分段」）：每段不超过 46 KiB，从最早的消息开始装入，写满后不再变化。在任意一段上「忘记此来源」都会忘记整段讨论，之后新增的段也不写入。分段之前采集的长讨论只留下了最新部分，后台会把它们的分段重新排队，每个项目每次启动最多 5 段，记忆页显示还剩多少段。

编码简报、阶段 Agent、Gate 评审和讨论栏会从这个 bank 召回记忆，讨论栏还可以用 `memory_search` 主动检索，规则见 ADR 0030「召回」。编码简报另外带上知识页「每个任务都适用的约定」，补上请求里没提到的约定。

召回的排序由 Hindsight 决定，DevFlow 保持它的顺序，只按各入口的预算从前往后取。DevFlow 的 Hindsight 镜像带多语言 embedding 模型 `intfloat/multilingual-e5-small`（见 [Hindsight 接入](hindsight-integration.md)）。后台 worker 每次启动时给每个开启的 bank 写入 `enable_reranking: false` 和 `enable_graph_retrieval: false`，这一步不调用模型，也不等中继。召回顺序因此是向量检索、关键词检索和时间检索三路的倒数排名融合。

2026-10-29 在一个约 300 条记忆（200 条事实、118 条观察）的验证 bank 上，只看 Hindsight 的顺序，用 25 个调参问题和 20 个留出问题（含英文问题）比较。命中指预期记忆进入该入口的预算：讨论栏 4 条、2,000 字节，编码简报 8 条、4,000 字节。

| 配置 | 讨论栏命中（调参 / 留出） | 编码简报命中 | MRR | 召回 p50 / 1.4 KB 长查询 |
|---|---|---|---|---|
| 上游英文 embedding，无重排 | 36% / 45% | 60% / 65% | 0.32 / 0.42 | 30 ms / 0.2 s |
| 上游英文 embedding，开重排（最多 300 个候选） | 24% / 40% | 48% / 80% | 0.24 / 0.32 | 8.5 s / 30 s |
| 多语言 embedding，无重排 | 72% / 80% | 96% / 95% | 0.55 / 0.55 | 28 ms / 0.2 s |
| **多语言 embedding，无重排，关图扩展（采用）** | **100% / 95%** | **100% / 95%** | **0.87 / 0.92** | **23 ms / 0.17 s** |
| 同上，加多语言重排（前 40 个候选） | 96% / 100% | 96% / 100% | 0.96 / 0.98 | 1.8 s / 7.9 s |

多语言重排略好，但在 2 个 CPU 上每次召回多 2–8 秒，长查询超过桌面端 5 秒的召回超时，记忆会被静默降级为空，所以不用。图扩展有害的原因见 ADR 0030「召回」。此前的做法（#270：英文 embedding，关重排后用 DevFlow 自己的中文 BM25 与 Hindsight 的顺序融合，讨论栏命中 88% / 90%）已移除。一个请求里有几件事时（例如「改撤销窗口，注释按约定的语言写」），向量检索按整句的意思排序，次要那件的记忆排不进预算。现在把用户原话拆成子句分别召回，再与整句的结果轮流合并（ADR 0030「召回」）：双意图题的命中在讨论栏从 84% 升到 96%，编码简报从 92% 升到 100%，单意图题不变（[记忆优化验证](../validation/project-memory-optimization-20261031.md)）。请求里根本没提到的约定，拆分也召回不到，编码简报靠「每个任务都适用的约定」页补上（见下文）。Hindsight 默认的关键词检索不分中文词；换成上游推荐的 pgroonga 后关键词检索能匹配中文，但整体排序变差。数据与新配置的完整验证见[多语言召回验证](../validation/project-memory-multilingual-20261029.md)。

知识页的项目记忆面板可以开关、查看、编辑、删除、忘记来源和清空，还能阅读五个知识页（每个任务都适用的约定、约定与命令、决策与原因、问题与解决办法、用户偏好），规则见 ADR 0030「记忆页」；对应 IPC 为 `getProjectMemoryStatus`、`configureProjectMemory`、`listProjectMemories`、`updateProjectMemory`、`forgetProjectMemory`、`forgetProjectMemorySource`、`clearProjectMemory`、`listProjectKnowledgePages`、`refreshProjectKnowledgePage`。

Hindsight 1.0.0 只接受对原始事实（world）和经历（experience）的编辑与删除；观察（observation）随来源重新归纳。记忆面板在事实和经历上提供修改操作。编辑或忘记后，早于本次变更且尚未重写的知识页会被隐藏，直至 Hindsight 返回更新的页面。

知识页是 Hindsight 的 mental model，id 为 `devflow-<页面>`，由后台 worker 在中继运行时为每个开启的 bank 创建（每次启动检查一次）。阅读知识页不调用模型；Hindsight 归纳后改写（每页最多每 6 小时一次）和「立即整理」会调用模型并计入团队预算；2026-10-29 用 DeepSeek Flash 实测每页一次约 0.8 美分。

「每个任务都适用的约定」（`devflow-essentials`，最多 700 tokens）是唯一进入提示词的知识页：每次编码时读取（不调用模型），脱敏后按整行截到 2,500 字节放进简报，不占召回预算；页面为空、读取失败或简报放不下时不带。讨论、阶段 Agent 和 Gate 在原有记忆预算内尝试附上同一页的短版（含标题最多 600 字节，按整行截取），首条相关记忆优先。2026-10-31 在评估 bank 上写出 15 条规则、1,271 字节，编码实测见[记忆优化验证](../validation/project-memory-optimization-20261031.md)第 5 节。

代码位置：

- `packages/shared/src/project-memory.ts`：类型、限制、bank 任务说明。
- `apps/desktop/electron/project-memory-capture.ts`：文档构造和采集入口，在 LocalStore 的持久化变更里调用；`buildConversationMemoryDocuments` 分段，`backfillConversationProjectMemory` 补发分段之前的长讨论，`migrateLegacyProjectMemory` 复制旧版记忆。
- `apps/desktop/electron/project-memory-commits.ts`：读取 Git 提交历史并按天组成文档。
- `apps/desktop/electron/project-memory-store.ts`：开关和发件队列（schema 41）。
- `apps/desktop/electron/project-memory-service.ts`：后台发送、查询、删除。
- `apps/desktop/electron/memory-model-relay.ts`：Hindsight 抽取调用的预算中继。
- `apps/desktop/electron/project-memory-recall.ts`：召回、`memory_search`、回执检查和读取约定页（`conventions`）；`coding-context.ts` 的 `recallScopedMemory` 为各入口选择记忆和可选的短约定页，`recallCodingMemory` 给编码简报加上约定页，`buildWithCodingMemory` 在简报放不下时去掉它。

## 配置

前提：已用 `DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED` 启用 Hindsight 传输（见 [Hindsight 接入](hindsight-integration.md)），本地项目已配对团队项目，设置中已保存要用的 Provider（例如 DeepSeek）。

1. 启动桌面端一次，状态里的 `relay.tokenFile` 给出令牌文件位置（`<userData>/memory-relay-token`）。也可以在启动桌面端前自行设置 `DEVFLOW_MEMORY_RELAY_TOKEN`（32–200 位字母、数字、`-`、`_`）。
2. 把同一令牌写入 `deploy/hindsight/.env` 的 `DEVFLOW_MEMORY_RELAY_TOKEN`，然后 `corepack pnpm hindsight:up`。改过中继端口时，两边的 `DEVFLOW_MEMORY_RELAY_PORT` 要一致。
3. 调用 `configureProjectMemory({ projectId, enabled: true, endpoint: 'http://127.0.0.1:8890', providerId })`。

Compose 中 shell 里导出的同名变量优先于 `--env-file`；更换令牌后先确认 shell 中没有旧的 `DEVFLOW_MEMORY_RELAY_TOKEN`，再重新创建容器。

Linux Docker 的 `host.docker.internal` 指向网桥地址，访问不到只监听 `127.0.0.1` 的中继，需要设置 `DEVFLOW_MEMORY_RELAY_HOST` 为网桥地址（例如 `172.17.0.1`）。中继仍要求令牌。

中继日志只记录未完成调用的状态和原因（`memory_not_enabled`、`budget_not_ready`、`budget_unavailable` 等），不记录 bank、提示或回答。

## 与 Native Coding v3（#238）合并时

- schema 41 已用于项目记忆表；v3 的 `native_coding_sessions` 迁移需要改为 42，并更新测试里的 schema 版本断言。
- 第四期已删除旧自动学习链路、Coding Run 候选学习和本地记忆召回（`automatic-memory-local-store.test.ts`、`coding-run-memory-learning.ts` 等）；v3 分支对这些文件的改动以 main 为准。`recallScopedMemory` 只返回项目记忆。
- `native-conversation.ts`：保留 main 的 `communicationPreferences`、系统提示和记忆过时规则（`NATIVE_MEMORY_STALENESS`，在 `native-conversation-tools.ts`），同时保留 v3 抽出的 `nativeRequestBudget`。
- `coding-runtime.ts` 的简报入口：v3 仍写 `memoryContext: recalled.revisions`，main 的 `RecalledMemory` 已改为 `context`。按 main 的写法合并：给 `recallCodingMemory` 传 `intents`（用 `splitRecallIntents` 拆请求和用户指令），用 `buildWithCodingMemory` 生成简报并用它返回的记忆写回执。只换字段名的话，v3 简报不拆分召回，加上约定页放不下时也会直接失败。
- 记忆行的事实带天数（`[fact 2026-10-20，11 天前]`），各入口的说明里有过时规则；v3 新增的提示词如果带记忆，也要加同样的规则。
- 讨论栏的只读 `memory_search` 按同样的方式提供给 Native Coding v3；v3 简报通过 `recallCodingMemory` 得到项目记忆和约定页。

## 验证

```sh
corepack pnpm exec vitest run \
  apps/desktop/electron/project-memory-capture.test.ts \
  apps/desktop/electron/project-memory-local-store.test.ts \
  apps/desktop/electron/project-memory-service.test.ts \
  apps/desktop/electron/memory-model-relay.test.ts \
  apps/desktop/electron/project-memory-recall.test.ts \
  apps/desktop/src/components/ProjectMemoryPanel.test.tsx \
  apps/desktop/electron/coding-context.test.ts \
  apps/desktop/electron/hindsight-client.test.ts
corepack pnpm verify
```

这些测试使用假 Hindsight、假上游和假预算，不调用模型。

真实模型验证（合成数据、累计预算账本）：

```sh
DEVFLOW_MEMORY_LIVE_AUTHORIZED=1 DEVFLOW_MEMORY_LIVE_MAX_USD=0.8 \
DEVFLOW_MEMORY_RELAY_TOKEN=<与 Hindsight 相同的令牌> DEVFLOW_MEMORY_RELAY_PORT=8899 \
DEEPSEEK_API_KEY=<已授权的密钥，只在环境中> \
corepack pnpm exec tsx scripts/project-memory-live-validation.mts
```

脚本只在获得提供方、模型和预算授权后运行；每次运行受 `DEVFLOW_MEMORY_LIVE_MAX_USD` 和 3 美元累计账本双重限制，报告写在 `out/project-memory-validation/`，14 项检查全部通过才算通过（2026-10-31 加入约定页之前是 13 项）。它覆盖抽取、召回、知识页和真实讨论（讨论用 `deepseek-flash`，可用 `DEVFLOW_MEMORY_LIVE_CONVERSATION_MODEL` 改），一次约 4 美分；讨论调用按 1M tokens 上下文预留，`DEVFLOW_MEMORY_LIVE_MAX_USD` 至少设为 0.4。结果见[2026-10-28 验证](../validation/project-memory-live-20261028.md)和[2026-10-29 全链路验证](../validation/project-memory-live-20261029.md)。

长讨论分段依赖 Hindsight `replace` 的行为：替换后旧版本里已不存在的内容被删除，从不重发的文档保持不变。升级 Hindsight 后用下面的命令确认，它在 `chunks` 模式的临时 bank 里运行，不调用模型，结束时删除 bank：

```sh
HINDSIGHT_SMOKE_AUTHORIZED=1 HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890 \
corepack pnpm exec tsx scripts/project-memory-segments-smoke.mts
```

更大规模的验证用 `scripts/project-memory-full-validation.mts`：53 份合成文档（含真实 Git 历史），覆盖采集裁剪、Hindsight 归纳、会话和编码简报压缩、知识页，以及编码简报和真实 Native v2 编码、阶段 Agent、Gate 评审、两种讨论协议和 `memory_search` 的召回，之后是自动采集、编辑、遗忘、遗忘来源和清空。它有单独的 2 美元账本（`ledger-full.json`），各阶段可以对同一个工作目录续跑；一次完整运行约 0.5 美元，其中编辑和遗忘之后重写知识页约 0.19 美元。`DEVFLOW_MEMORY_FULL_DRY=1` 只构造文档并做不花钱的检查。结果见[2026-10-29 完整验证](../validation/project-memory-full-20261029.md)。

### 2026-10-28 无费用链路检查

用本仓库 Compose 启动固定版本 Hindsight 1.0.0（Docker Desktop，macOS），中继监听 `127.0.0.1:8899`，上游换成本机假模型（固定返回 `{"facts": []}`），预算为假实现。对一个合成 bank 调用 `configureMemoryBank` 和 `retainDocument` 后：

- Hindsight 容器经 `host.docker.internal` 带令牌访问到中继，`user` 字段是该 bank id，中继按它路由并预留预算。
- 发往上游的请求没有 `user` 字段，`max_tokens` 为 8192，`response_format` 为 `json_object`，非流式。
- retain operation 完成；之后删除测试 bank，停止服务。

这只证明链路和请求形状，不证明抽取质量。

召回（第二期）同样用固定版本 Hindsight 检查：测试 bank 用不调用模型的 `chunks` 模式写入一段中文约定，`recallMemories` 用中文问题取回该条（类型 `world`，带来源文档和日期，约 0.2 秒），之后删除测试 bank 并停止服务。这证明请求与响应解析，不证明抽取或观察归纳的质量。

另用真实 Electron（隔离数据目录、打开 Hindsight 传输闸门、不启动 Hindsight、无模型流量）检查：中继在指定端口启动，令牌文件权限 0600；错误令牌返回 401，未知 bank 返回 403；未配对项目开启记忆被拒绝并提示先配对；退出后端口关闭。
