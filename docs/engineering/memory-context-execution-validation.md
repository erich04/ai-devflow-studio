<a id="memory--context--compact-execution-validation"></a>

# 记忆、上下文与压缩的执行验证

实现分支：`codex/memory-context-execution-20260915`，基于 main `ff51b991`。本工作不改变已发布的 v2.3.0 安装包。

<a id="what-changed"></a>

## 变更内容

```text
本地 SQLite 中已提升的记忆
  → 既有作用域 / 生命周期过滤
  → 有边界的相关性选择
  → 通用编码简报 + 抽取式压缩 + 本地回执
  → Native Coding 或 OpenCode
  → 受管差异 + 实际执行的已保存测试
  → workflow.evaluate 证据检查
```

继续执行前会再次检查来源是否仍然有效。记忆提供背景，不能代替权限、测试或业务验收。参见 [ADR 0021](../adr/0021-coding-memory-context-and-evidence-evaluation.md)。

<a id="reproduced-failures-before-the-fix"></a>

## 修复前复现的故障

1. 捕获的 Native v2 服务商输入缺少已提升的项目记忆陈述。
2. 一份 61 KB 的历史简报超出目标预算，下游截取可能丢弃当前指令或尾部约束。
3. 独立运行时的评估输入被固定，因此没有任务证据也能成功。

每个复现都在实现前失败，在变更后代码上通过。额外回归覆盖配对操作者/仓库隔离、配对变化、审批前记忆删除/过期、付费调用期间记忆修订、重启、OpenCode 发送消息前的有效性检查，以及评估检查点保存后证据变化。

<a id="real-deepseek-acceptance"></a>

## 真实 DeepSeek 验收

付费验证程序为 `scripts/memory-context-live-smoke.ts`。它使用真实 LocalStore、常规编码运行时、Native v2、隔离 Git 工作树及实际执行的 `npm test` 命令。不模拟服务商，也不手工写入任务要求的输出文件。

相同请求只修改 `src/greeting.js` 中的问候语；存在项目记忆时使用其文案，否则使用指定默认值。初始仓库保持不变。下表英文问候语是实际生成的测试输出，按原样保留。

| 场景 | 实际生成的问候语 | 两次服务商提示中均包含记忆 | 已保存测试 |
| --- | --- | --- | --- |
| 无记忆 | Standard greeting | 否 | 通过 |
| 已提升/修订的项目记忆 | Welcome to the remembered workspace | 是 | 通过 |
| 明确删除记忆后 | Standard greeting | 否 | 通过 |

记忆从首次运行真实差异/测试的已接受评估中提升，再通过与桌面端相同的人工操作服务修订。提供的长设计历史使每个场景都触发压缩。首次真实验收完成于 2026-09-16T04:40:57.974Z：六次真实 DeepSeek `deepseek-v4-flash` 调用，6,473 Token，记录费用 USD 0.001287552；94,485–94,721 字节简报压缩为 1,868–2,103 字节，同时保留当前请求和尾部验收约束。费用采用已有定价快照及服务商返回用量。

2026-09-16T05:04:49.501Z 的第二次付费运行还验证了三个场景的编码完成自动评估：六次调用，6,415 Token，记录费用 USD 0.000961596。编码 Run ID 分别为 `coding-run-a6ac472e-8d43-4160-8317-15fe1e5ee460`、`coding-run-6e0b6609-2539-4994-8df1-4040591172d7` 和 `coding-run-c2194607-f8df-46fd-838c-af9b673156de`。

脱敏后的[机器可读证据](evidence/memory-context-live-20260916.json)已入库。收紧关联测试来源检查后，最终评估器在 2026-09-16T05:14:56.248Z 重新读取真实运行数据库的副本。三个场景均通过，归档证据摘要完全相同，无需额外付费服务商调用。

已完成的本地验证：

- 最终 `corepack pnpm verify`：276 个测试文件 / 3,889 项测试，类型检查和跨平台检查通过。
- 来源及审批期间记忆删除专项回归通过。
- `corepack pnpm build`：通过。
- `corepack pnpm test:e2e`：全部 41 项浏览器测试通过，包括为真实 `workflow.evaluate` 工具更新的高级区可见性检查。
- `corepack pnpm test:electron-smoke`：使用隔离桌面配置，通过。
- `build:desktop-pilot` 与 `test:desktop-pilot-smoke`：通过。安装包 IPC 检查先拒绝无证据的新 Run，经阶段服务归档澄清，发起进一步修订以保留正在运行任务的权限，再检查已归档证据。还验证精确的记忆提升/修订/删除及重启持久化。这验证的是澄清产物完整性，不是批准尚待处理的修订或 Gate。
- `corepack pnpm test:native-coding-electron-smoke`：通过，使用真实 Electron 主进程、受控本地模型服务、精确变更批准、工作树编辑、实际测试、差异和费用证据。
- 默认 `test:memory-context-live` 显式启用机制：未启用时跳过，不联系服务商。
- v2.0 运行时、v2.1 检索/记忆和 v2.2 多 Agent 离线评估器在干净候选版本 `b0ca895d544124e766c9b810b3ac7ae78373a412` 上通过。

这些结果验证了依赖记忆的实现、作用域内召回、删除、压缩及真实本地证据。它们不代表新的云端接入/部署测试、OpenCode 付费服务商验收，也不意味着所有业务需求均能自动评估。OpenCode 简报传递和有效性检查由确定性 HTTP 适配器测试覆盖。

安装包覆盖还验证：注入的 Local MCP 注册表同时包含原生 `workflow.evaluate` 注册项和离线 MCP 测试项。组合能力摘要包含 MCP 安装身份和原生评估器定义。Native v2 Git/npm 测试项目沿用 Native v1/OpenCode 的 Windows 调度预算，禁用无关的 npm audit/funding 请求，并对临时目录清理锁进行重试。

真实验证程序在检查独立评估器和既有人工操作的记忆提升/修订服务时，保持开发节点为 running，不安装界面的工作流完成回调。因此这是服务层记忆生命周期验收，不意味着界面推进到测试或 Gate 后仍能执行同样的开发后交互。编码现在会自动使用已有记忆，但新持久记忆仍需人工明确提升/修订。本阶段未实现任务完成后的自动学习。高级独立运行时仍要求任务正在运行；常规编码完成时，直接将证据评估记录到编码轨迹。

<a id="run-it-again"></a>

## 再次运行

使用尚未占用的输出目录。验证程序拒绝覆盖已有报告/仓库。通过本地环境提供凭据，不将 API 密钥放进命令参数或提交到仓库。明确执行付费运行时需要以下变量：

- `DEVFLOW_MEMORY_LIVE=1`
- `DEVFLOW_AGENT_OPENAI_API_KEY`
- `DEVFLOW_AGENT_OPENAI_BASE_URL`
- `DEVFLOW_AGENT_OPENAI_MODEL`
- 可选 `DEVFLOW_MEMORY_LIVE_OUTPUT`；不提供时在 `out/` 下创建新的时间戳目录。

运行 `corepack pnpm test:memory-context-live`。没有启用标志时报告跳过，不加载凭据，也不联系服务商。脱敏报告包含各场景编码 Run ID、提示内容存在性检查、上下文回执、自动与按需证据检查、Token 结算及断言，不包含 API 密钥或完整服务商请求。

<a id="cursor-consultation"></a>

## Cursor 咨询记录

使用 `cursor-grok-4.6-high` 对 Cursor 进行了只读咨询，会话为 `2a4ab5c4-d000-4cef-af28-d928292422ff`。Codex 独立检查了每项建议：

| 建议 | 处理结果 |
| --- | --- |
| 复用既有记忆生命周期；将陈述注入编码简报 | 采纳，并通过真实服务商行为验证 |
| 保留 SHA-256(brief) 语义及不可变恢复 | 采纳 |
| 外部动作前重新检查记忆；保留不重复执行行为 | 采纳，覆盖删除/修订/重启回归 |
| 区分离线测试评估与真实任务评估 | 采纳 |
| 将压缩延后到未来阶段 | 未采纳：用户明确要求可工作的压缩，已实现有边界的抽取式压缩 |
| 保留固定输入的独立运行时演示 | 默认运行时未采纳：用户要求真实输入；离线测试仍保留固定样例 |
| 扩展向量检索或 Specialist 记忆路由 | 延后；证明本阶段执行能力不需要这两项 |

同一 Cursor 会话随后进行了聚焦实现审阅，只读且不执行测试。它没有报告阻断性反例，但提出两项非阻断风险，两项均已处理：OpenCode 在发送已批准权限回复前立即重验有效性，审批期间记忆删除则终止；真实证据评估要求编码 Run 自己关联的测试通过，后续已保存测试失败仍会使评估失败。对应竞态和证据来源回归均通过。删除前已经获授权并正在进行的 OpenCode 工作无法追溯撤销。
