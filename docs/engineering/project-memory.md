# 项目记忆（Hindsight）

设计依据：[ADR 0030](../adr/0030-hindsight-project-memory.md)。本文说明当前行为、配置方法和验证入口。项目记忆是 DevFlow 唯一的记忆：未开启时没有记忆，不再使用本地 Agent 记忆。

## 当前行为

开启后，DevFlow 自动把以下内容写入项目的 Hindsight bank，由 Hindsight 抽取事实并归纳观察：

| 来源 | 文档 id | 何时写入 |
|---|---|---|
| 讨论的公开消息 | `conversation:<id>` | 对话空闲 3 分钟后；之后每轮替换 |
| 结束的 Coding Run | `coding-run:<id>` | 运行结束时（任何结果，`fake` 除外） |
| 被批准的澄清、设计、验收包 | `artifact:<id>` | 审批通过时 |
| Gate 评审结果 | `artifact:<id>` | 保存时 |
| 旧版本地 Agent 记忆 | `legacy:agent-memory` | 开启时或启动时，每个 bank 一次 |
| Git 提交信息（当前分支最近 30 天） | `commits:<日期>` | 每 10 分钟检查；当天的在最后一个提交 30 分钟后 |

旧版记忆的迁移规则见 ADR 0030「旧记忆迁移与移除」：只复制当前归属用户在本项目可见的有效记忆；忘记这个来源或清空后不会再写入；本地数据不删除。

编码简报、阶段 Agent、Gate 评审和讨论栏会从这个 bank 召回记忆，讨论栏还可以用 `memory_search` 主动检索，规则见 ADR 0030「召回」。

召回的排序由 Hindsight 决定，DevFlow 保持它的顺序，只按各入口的预算从前往后取。DevFlow 的 Hindsight 镜像带多语言 embedding 模型 `intfloat/multilingual-e5-small`（见 [Hindsight 接入](hindsight-integration.md)）。后台 worker 每次启动时给每个开启的 bank 写入 `enable_reranking: false` 和 `enable_graph_retrieval: false`，这一步不调用模型，也不等中继。召回顺序因此是向量检索、关键词检索和时间检索三路的倒数排名融合。

2026-10-29 在一个约 300 条记忆（200 条事实、118 条观察）的验证 bank 上，只看 Hindsight 的顺序，用 25 个调参问题和 20 个留出问题（含英文问题）比较。命中指预期记忆进入该入口的预算：讨论栏 4 条、2,000 字节，编码简报 8 条、4,000 字节。

| 配置 | 讨论栏命中（调参 / 留出） | 编码简报命中 | MRR | 召回 p50 / 1.4 KB 长查询 |
|---|---|---|---|---|
| 上游英文 embedding，无重排 | 36% / 45% | 60% / 65% | 0.32 / 0.42 | 30 ms / 0.2 s |
| 上游英文 embedding，开重排（最多 300 个候选） | 24% / 40% | 48% / 80% | 0.24 / 0.32 | 8.5 s / 30 s |
| 多语言 embedding，无重排 | 72% / 80% | 96% / 95% | 0.55 / 0.55 | 28 ms / 0.2 s |
| **多语言 embedding，无重排，关图扩展（采用）** | **100% / 95%** | **100% / 95%** | **0.87 / 0.92** | **23 ms / 0.17 s** |
| 同上，加多语言重排（前 40 个候选） | 96% / 100% | 96% / 100% | 0.96 / 0.98 | 1.8 s / 7.9 s |

多语言重排略好，但在 2 个 CPU 上每次召回多 2–8 秒，长查询超过桌面端 5 秒的召回超时，记忆会被静默降级为空，所以不用。图扩展有害的原因见 ADR 0030「召回」。此前的做法（#270：英文 embedding，关重排后用 DevFlow 自己的中文 BM25 与 Hindsight 的顺序融合，讨论栏命中 88% / 90%）已移除。已知局限：一个请求里有两件事时（例如「改撤销窗口，注释按约定的语言写」），向量检索按整句的意思排序，次要那件的记忆可能排不进预算。Hindsight 默认的关键词检索不分中文词；换成上游推荐的 pgroonga 后关键词检索能匹配中文，但整体排序变差，也没有解决这个问题。数据与新配置的完整验证见[多语言召回验证](../validation/project-memory-multilingual-20261029.md)。

知识页的项目记忆面板可以开关、查看、编辑、删除、忘记来源和清空，还能阅读四个知识页（约定与命令、决策与原因、问题与解决办法、用户偏好），规则见 ADR 0030「记忆页」；对应 IPC 为 `getProjectMemoryStatus`、`configureProjectMemory`、`listProjectMemories`、`updateProjectMemory`、`forgetProjectMemory`、`forgetProjectMemorySource`、`clearProjectMemory`、`listProjectKnowledgePages`、`refreshProjectKnowledgePage`。

知识页是 Hindsight 的 mental model，id 为 `devflow-<页面>`，由后台 worker 在中继运行时为每个开启的 bank 创建（每次启动检查一次）。阅读知识页不调用模型；Hindsight 归纳后改写（每页最多每 6 小时一次）和「立即整理」会调用模型并计入团队预算；2026-10-29 用 DeepSeek Flash 实测每页一次约 0.8 美分。

代码位置：

- `packages/shared/src/project-memory.ts`：类型、限制、bank 任务说明。
- `apps/desktop/electron/project-memory-capture.ts`：文档构造和采集入口，在 LocalStore 的持久化变更里调用；`migrateLegacyProjectMemory` 复制旧版记忆。
- `apps/desktop/electron/project-memory-commits.ts`：读取 Git 提交历史并按天组成文档。
- `apps/desktop/electron/project-memory-store.ts`：开关和发件队列（schema 41）。
- `apps/desktop/electron/project-memory-service.ts`：后台发送、查询、删除。
- `apps/desktop/electron/memory-model-relay.ts`：Hindsight 抽取调用的预算中继。
- `apps/desktop/electron/project-memory-recall.ts`：召回、`memory_search` 和回执检查；`coding-context.ts` 的 `recallScopedMemory` 只用它召回。

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
- `native-conversation.ts`：保留 main 的 `communicationPreferences` 和系统提示，同时保留 v3 抽出的 `nativeRequestBudget`。
- 讨论栏的只读 `memory_search` 按同样的方式提供给 Native Coding v3；v3 简报已通过 `recallCodingMemory` 得到项目记忆。

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

脚本只在获得提供方、模型和预算授权后运行；每次运行受 `DEVFLOW_MEMORY_LIVE_MAX_USD` 和 3 美元累计账本双重限制，报告写在 `out/project-memory-validation/`，13 项检查全部通过才算通过。它覆盖抽取、召回、知识页和真实讨论（讨论用 `deepseek-flash`，可用 `DEVFLOW_MEMORY_LIVE_CONVERSATION_MODEL` 改），一次约 4 美分；讨论调用按 1M tokens 上下文预留，`DEVFLOW_MEMORY_LIVE_MAX_USD` 至少设为 0.4。结果见[2026-10-28 验证](../validation/project-memory-live-20261028.md)和[2026-10-29 全链路验证](../validation/project-memory-live-20261029.md)。

更大规模的验证用 `scripts/project-memory-full-validation.mts`：53 份合成文档（含真实 Git 历史），覆盖采集裁剪、Hindsight 归纳、会话和编码简报压缩、知识页，以及编码简报和真实 Native v2 编码、阶段 Agent、Gate 评审、两种讨论协议和 `memory_search` 的召回，之后是自动采集、编辑、遗忘、遗忘来源和清空。它有单独的 2 美元账本（`ledger-full.json`），各阶段可以对同一个工作目录续跑；一次完整运行约 0.5 美元，其中编辑和遗忘之后重写知识页约 0.19 美元。`DEVFLOW_MEMORY_FULL_DRY=1` 只构造文档并做不花钱的检查。结果见[2026-10-29 完整验证](../validation/project-memory-full-20261029.md)。

### 2026-10-28 无费用链路检查

用本仓库 Compose 启动固定版本 Hindsight 1.0.0（Docker Desktop，macOS），中继监听 `127.0.0.1:8899`，上游换成本机假模型（固定返回 `{"facts": []}`），预算为假实现。对一个合成 bank 调用 `configureMemoryBank` 和 `retainDocument` 后：

- Hindsight 容器经 `host.docker.internal` 带令牌访问到中继，`user` 字段是该 bank id，中继按它路由并预留预算。
- 发往上游的请求没有 `user` 字段，`max_tokens` 为 8192，`response_format` 为 `json_object`，非流式。
- retain operation 完成；之后删除测试 bank，停止服务。

这只证明链路和请求形状，不证明抽取质量。

召回（第二期）同样用固定版本 Hindsight 检查：测试 bank 用不调用模型的 `chunks` 模式写入一段中文约定，`recallMemories` 用中文问题取回该条（类型 `world`，带来源文档和日期，约 0.2 秒），之后删除测试 bank 并停止服务。这证明请求与响应解析，不证明抽取或观察归纳的质量。

另用真实 Electron（隔离数据目录、打开 Hindsight 传输闸门、不启动 Hindsight、无模型流量）检查：中继在指定端口启动，令牌文件权限 0600；错误令牌返回 401，未知 bank 返回 403；未配对项目开启记忆被拒绝并提示先配对；退出后端口关闭。
