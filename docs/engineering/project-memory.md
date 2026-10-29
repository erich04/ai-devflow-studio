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

旧版记忆的迁移规则见 ADR 0030「旧记忆迁移与移除」：只复制当前归属用户在本项目可见的有效记忆；忘记这个来源或清空后不会再写入；本地数据不删除。

编码简报、阶段 Agent、Gate 评审和讨论栏会从这个 bank 召回记忆，讨论栏还可以用 `memory_search` 主动检索，规则见 ADR 0030「召回」。知识页的项目记忆面板可以开关、查看、编辑、删除、忘记来源和清空，还能阅读四个知识页（约定与命令、决策与原因、问题与解决办法、用户偏好），规则见 ADR 0030「记忆页」；对应 IPC 为 `getProjectMemoryStatus`、`configureProjectMemory`、`listProjectMemories`、`updateProjectMemory`、`forgetProjectMemory`、`forgetProjectMemorySource`、`clearProjectMemory`、`listProjectKnowledgePages`、`refreshProjectKnowledgePage`。

知识页是 Hindsight 的 mental model，id 为 `devflow-<页面>`，由后台 worker 在中继运行时为每个开启的 bank 创建（每次启动检查一次）。阅读知识页不调用模型；Hindsight 归纳后改写（每页最多每小时一次）和「立即整理」会调用模型并计入团队预算。

代码位置：

- `packages/shared/src/project-memory.ts`：类型、限制、bank 任务说明。
- `apps/desktop/electron/project-memory-capture.ts`：文档构造和采集入口，在 LocalStore 的持久化变更里调用；`migrateLegacyProjectMemory` 复制旧版记忆。
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

脚本只在获得提供方、模型和预算授权后运行；每次运行受 `DEVFLOW_MEMORY_LIVE_MAX_USD` 和 3 美元累计账本双重限制，报告写在 `out/project-memory-validation/`。结果见[2026-10-28 验证](../validation/project-memory-live-20261028.md)。

### 2026-10-28 无费用链路检查

用本仓库 Compose 启动固定版本 Hindsight 1.0.0（Docker Desktop，macOS），中继监听 `127.0.0.1:8899`，上游换成本机假模型（固定返回 `{"facts": []}`），预算为假实现。对一个合成 bank 调用 `configureMemoryBank` 和 `retainDocument` 后：

- Hindsight 容器经 `host.docker.internal` 带令牌访问到中继，`user` 字段是该 bank id，中继按它路由并预留预算。
- 发往上游的请求没有 `user` 字段，`max_tokens` 为 8192，`response_format` 为 `json_object`，非流式。
- retain operation 完成；之后删除测试 bank，停止服务。

这只证明链路和请求形状，不证明抽取质量。

召回（第二期）同样用固定版本 Hindsight 检查：测试 bank 用不调用模型的 `chunks` 模式写入一段中文约定，`recallMemories` 用中文问题取回该条（类型 `world`，带来源文档和日期，约 0.2 秒），之后删除测试 bank 并停止服务。这证明请求与响应解析，不证明抽取或观察归纳的质量。

另用真实 Electron（隔离数据目录、打开 Hindsight 传输闸门、不启动 Hindsight、无模型流量）检查：中继在指定端口启动，令牌文件权限 0600；错误令牌返回 401，未知 bank 返回 403；未配对项目开启记忆被拒绝并提示先配对；退出后端口关闭。
