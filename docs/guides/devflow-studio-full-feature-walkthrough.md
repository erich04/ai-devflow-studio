# DevFlow Studio 全量基础功能体验指南

更新时间：2026-06-21  
适用版本：`v1.3 delivery-flow candidate`

这份指南用于体验 DevFlow Studio 已经落地的基础能力。它不是某一个版本的 release
walkthrough，而是按当前产品入口把 v0.2 到 v1.3 的核心能力串起来：本地仓库、Run/Gate、
Knowledge、Agent Review、Coding Agent、测试证据、Team/Web、Pairing、Budget、Tool / Skill
Trace、PR Draft 和 Acceptance Bundle。

默认路径不调用真实付费模型。真实 `opencode` + 豆包/Volcengine provider smoke 是 release-only
验证项，放在最后单独执行。

## 0. 启动环境

在项目根目录运行：

```bash
cd /Users/erich/File/claude/10-showcase/ai-devflow-studio

DEVFLOW_API_BASE_URL=http://127.0.0.1:4310 \
NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310 \
corepack pnpm dev:api
```

另开一个终端：

```bash
DEVFLOW_API_BASE_URL=http://127.0.0.1:4310 \
NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310 \
corepack pnpm dev:web
```

另开一个终端：

```bash
DEVFLOW_API_BASE_URL=http://127.0.0.1:4310 \
NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310 \
corepack pnpm dev:electron
```

通过标准：

- API health 可访问：`http://127.0.0.1:4310/health`。
- Web Console 可访问：`http://127.0.0.1:4311`。
- Electron 窗口标题是 `AI DevFlow Studio`，不是 Electron default app。
- 左侧能看到 `工作台`、`Team Overview`、`Knowledge`、`Agents`、`Skills`、`MCP`、`测试`。

![Electron Workbench](./screenshots/14-electron-current-userdata-workbench.png)

## 1. Workbench：本地仓库与六阶段 Run

入口：左侧 `工作台`

要体验：

- 选择本地仓库。
- 保存测试命令。
- 搜索 Run / Artifact / Knowledge。
- 新建 Run，输入真实需求。
- 查看六阶段：`clarify -> design -> build -> test -> pr -> accept`。

建议输入：

- 标题：`修复 webhook retry 失败边界`
- 需求：`请澄清 webhook retry 的失败边界，设计最小实现方案，完成本地实现、测试、PR handoff 和验收证据。`

通过标准：

- 新 Run 从 `clarifying` 开始。
- Inspector 能看到 `Raw request` artifact。
- Gate approval 会推进 `currentNodeId`，不会把所有 Gate 硬编码成 `building`。
- Build task 才显示 `Coding Agent`。
- PR 节点显示 `生成 PR Draft`。
- Acceptance 节点显示 `生成验收证据包`。

![Workbench Gate Enforcement](./screenshots/01-workbench-gate-enforcement.png)

## 2. Gate Enforcement：策略、阻断、补救

入口：Workbench Inspector 的 `GATE ENFORCEMENT`

要体验：

- 选中 Gate 节点。
- 查看 policy source、version、syncedAt。
- 查看 blocking/warning reason。
- 查看 Remediation Plan。
- 尝试在未满足策略时 approve Gate。

通过标准：

- blocked Gate 不会只靠 renderer 禁用按钮；Electron main 写路径也会拒绝。
- `blocked_policy_unavailable` 只阻止 Gate approve，不阻止 Knowledge Review、测试、Coding 等本地工作。
- hard-block 时应显示 remediation，不显示 override 逃生口。
- confirmed override 和 provisional/rejected override 的 UI 语义不同。

## 3. Knowledge：知识治理与引用

入口：左侧 `Knowledge`

要体验：

- Markdown knowledge documents。
- Knowledge Governance checks。
- Knowledge Graph。
- Retrieval/reference 命中。
- 搜索 `api`、`test`、`security` 等关键词。

通过标准：

- 能看到 standards/checklists/ADR-like knowledge。
- Governance checks 是 evidence-driven；retrieval-only reference 不会自动满足 evidence。
- Inspector 里能看到当前节点关联的 Knowledge Governance 状态。

![Knowledge](./screenshots/12-electron-knowledge.png)

## 4. Knowledge Review Agent：审查、trace、finding

入口：Workbench Inspector 的 `Agent Review` 或左侧 `Agents`

默认路径使用 `Deterministic Fake Provider`，不花模型钱。它适合本地 walkthrough 和 CI，但不代表真实模型审查。

如果要让 DevFlow Review Agent 调用豆包/Volcengine Ark：

1. 打开左侧 `Agents`。
2. 在 `Review Model Credential` 中确认：
   - Provider ID：`doubao-review`
   - Base URL：`https://ark.cn-beijing.volces.com/api/coding/v3`
   - Model：`ark-code-latest`
3. 输入 API Key，点击 `Save Credential`。
4. 在 `Review Model Provider` 下拉框选择保存后的 live provider，再运行 `Run Knowledge Review`。

边界说明：豆包/Volcengine 只提供 OpenAI-compatible 模型 API；DevFlow 自己负责组装 review prompt、检索 Knowledge、运行治理检查，并解析结构化 review。Knowledge Review Agent 不由 `opencode` 执行；`opencode` 只用于 Coding Agent。

要体验：

- 选中一个 Gate 或 Build 节点。
- 点击 `Agent Review`。
- 打开 `Agents` 查看 review history。
- 查看 trace、token/cost、Agent Policy Finding、warning/blocking advisory。

通过标准：

- Knowledge Review 生成可审计结果和 artifact。
- Provider 显示能区分 fake/no-cost 与 live/may spend tokens。
- Agent finding 默认不会 hard-block。
- Gate Advisory 是否阻断由 policy evaluation 决定，不由 Agent core 直接决定。

![Agent Workbench](./screenshots/04-agent-workbench.png)

## 5. Coding Agent：fake 默认路径、permission relay、diff、worktree

入口：Build task 的 `Coding Agent`，然后左侧 `Agents`

要体验：

- 在 Build task 点击 `Coding Agent`。
- 在 Agents 视图查看 permission request。
- 点击 approve。
- 查看 fake diff、managed worktree、bootstrap/test evidence、terminal state。

通过标准：

- Coding Agent 只允许从 `stage: build` 且 `kind: task` 启动。
- renderer 不传 prompt；coding brief 由 main/shared 从 Run、Node、Artifact、Knowledge、Policy、
  Remediation、Test Evidence 组装。
- 主仓库不被直接修改。
- diff artifact 只保存 redacted/reviewable 内容。
- cleanup 状态可见。

![Coding Node](./screenshots/09-coding-node.png)

## 6. Tool / Skill Timeline：可观测性

入口：左侧 `Agents`

要体验：

- 查看 permission timeline。
- 查看 `Tool / Skill Timeline`。
- 查看 `tool_call` / `tool_result`。
- 查看 source：`opencode_metadata`、`inferred` 或未来的 `opencode_event_stream`。

通过标准：

- fake engine 不应被误导成真实 opencode Skill 调用。
- 如果缺少 skillName，UI 显示 `Unknown skill` 或 inferred 标记。
- 本地 event metadata 也必须脱敏，不保存 raw stdout/stderr、raw prompt、provider secret、
  完整 cwd 或完整 patch body。
- 当前不能保证还原 opencode 内部私有 Skill 调用栈。

## 7. Tests：本地测试证据

入口：左侧 `测试`

要体验：

- 查看 Local test evidence。
- 运行保存的测试命令。
- 尝试保存危险命令，例如 `rm -rf /`。

通过标准：

- 安全命令可以执行并生成 Test Evidence。
- 危险命令被 command safety 阻断。
- Evidence 显示 command/status/exit code/duration。
- stdout/stderr summary 经过 redaction。

![Tests Evidence](./screenshots/05-tests-evidence.png)

## 8. Remediation / Retry Coding

入口：被 policy/finding 阻断的节点 Inspector

要体验：

- 让 Gate Enforcement 或 Agent finding 产生 Remediation Plan。
- 查看 remediation candidates。
- 点击 retry/coding 相关 action。
- 在 Agents 里批准新的 permission。

通过标准：

- Retry 是 human-approved，不自动绕过 Gate。
- Retry Attempt 有记录。
- Coding Brief 带 remediation context。
- Team/Web 只接收 redacted delivery summary。

## 9. PR Draft 与 Acceptance Bundle

入口：Workbench 的 PR 节点和 Acceptance 节点

要体验：

- 在 PR 节点点击 `生成 PR Draft`。
- 在 Acceptance 节点点击 `生成验收证据包`。
- 最后通过 Acceptance Gate。

通过标准：

- PR Draft 包含 request、changed paths、Test Evidence、Policy、Budget、Agent Review、safe
  compare URL。
- Acceptance Bundle 引用 Raw Request、PR Draft、diff、tests、policy、budget、review。
- 当前 v1.3 只生成 PR handoff artifact，不创建真实 GitHub PR。
- 系统不会自动 push、merge 或自动通过 Gate。

## 10. Team Overview：团队视角与 redacted sync

入口：左侧 `Team Overview`，以及浏览器 `http://127.0.0.1:4311`

要体验：

- Desktop Team Overview。
- Web Team Console。
- 点击 Desktop 的 `同步团队`。
- 查看 Web 是否出现 redacted Run/Test/Review/Coding/Cost summary。

通过标准：

- Web 只显示 redacted summary，不显示 raw prompt、raw logs、cwd、patch、provider secret。
- Team Overview 能展示项目、成员、成本、风险、delivery summary。
- API seed mode 可以用于本地 demo；Postgres/Docker 是独立显式路径。

![Team Overview](./screenshots/11-electron-team-overview.png)

![Web Team Overview](./screenshots/08-team-overview.png)

## 11. Runtime Budget：成本、策略、approval retry

入口：Web Team Console 的 `Runtime Budget`，以及 Desktop Agents/Inspector 的 budget trace

要体验：

- Web 查看 Runtime Budget policy。
- Web 创建 Budget Approval。
- Desktop 在 Coding Agent 被 budget guard 阻断时查看 projected/current/limit cost。
- 输入 approval id 后 retry。

通过标准：

- paid provider 调用前先过 budget guard。
- over-budget 且无有效 approval 时，必须在 `engine.start(...)` 前阻断。
- Desktop 传 approval id，runtime/team boundary 解析完整 approval record。
- fake/default path 不花模型钱。

## 12. Desktop Pairing 与 self-hosted pilot

入口：

- Web Console 项目卡片：`Create desktop pairing code`
- Desktop 顶栏：`Pairing code` + `Pair`
- 自托管指南：[devflow-studio-self-hosted-pilot.md](./devflow-studio-self-hosted-pilot.md)

要体验：

- Web 创建 pairing code。
- Desktop 输入 pairing code 并 pair。
- Pair 后点击 `同步团队`。

通过标准：

- Desktop sync 使用 Bearer token，不回退 demo headers。
- renderer 不接收明文 bearer token。
- pairing code 是 copy-once / short-lived。
- Docker Compose 路径通过 `corepack pnpm test:docker-smoke` 验证，不属于默认 `verify`。

## 13. Skills 与 MCP

入口：左侧 `Skills`、`MCP`

要体验：

- 查看 Skill catalog。
- 查看 MCP server 定义。
- enable/disable MCP server。

通过标准：

- Skill/MCP 当前是管理壳和未来 runtime 扩展位置。
- MCP 开关本地持久化。
- 当前不启动真实 MCP 进程。
- 当前不要宣称 MCP 真执行或 MCP policy enforcement 已完成。

![MCP](./screenshots/07-mcp-management.png)

## 14. Release-only 真实 opencode + 豆包/Volcengine

这一步会产生真实模型调用，不属于默认体验。

Knowledge Review 的真实模型 smoke 走 OpenAI-compatible provider：

```bash
DEVFLOW_AGENT_OPENAI_API_KEY=... \
DEVFLOW_AGENT_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3 \
DEVFLOW_AGENT_OPENAI_MODEL=ark-code-latest \
corepack pnpm test:agent-live
```

这条 smoke 验证 DevFlow Review Agent 能用真实豆包/Volcengine 模型返回结构化 review。它不验证 `opencode`。

先检查本机 runtime：

```bash
corepack pnpm opencode:status
```

确认要花真实 provider 配额后，再运行：

```bash
DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN \
corepack pnpm test:opencode-smoke
```

通过标准：

- `opencode serve` 启动。
- permission relay 可见。
- diff capture 可见。
- fixture Test Evidence 通过。
- process/worktree cleanup 完成。
- 不打印 provider secret。

## 15. 全量体验核对表

| 模块 | 入口 | 必看点 | 通过标准 |
| --- | --- | --- | --- |
| Desktop launch | `corepack pnpm dev:electron` | AI DevFlow Studio | 不是 Electron default app |
| Workbench | 工作台 | 六阶段 Run | request 创建 Run，Gate 可推进 |
| Local project | 工作台 | 仓库选择/测试命令 | command safety 阻断危险命令 |
| Gate Enforcement | Inspector | policy/reason/remediation | 写路径不能绕过 blocking |
| Knowledge | Knowledge | docs/graph/reference/check | retrieval 不等于 evidence |
| Agent Review | Inspector/Agents | review artifact/trace/finding | finding 不 hard-block |
| Coding Agent | Build task/Agents | permission/diff/worktree | fake path 可重复、主仓不改 |
| Tool / Skill Timeline | Agents | tool_call/tool_result/source | skill 缺失时显示 unknown/inferred |
| Tests | 测试 | Test Evidence | redacted status/command/duration |
| Remediation Retry | Inspector/Agents | Retry Attempt | human-approved，不自动绕 Gate |
| PR Draft | PR 节点 | PR handoff artifact | 不创建真实 GitHub PR |
| Acceptance Bundle | Acceptance 节点 | 验收证据包 | final Gate 仍受 policy 约束 |
| Team Overview | Desktop/Web | redacted summaries | 不上传 raw repo/log/prompt/patch |
| Runtime Budget | Web/Desktop | policy/approval/retry | paid run 前阻断超预算 |
| Pairing | Web/Desktop | pairing code/token sync | bearer token 不进 renderer |
| Skills/MCP | Skills/MCP | catalog/server toggles | 不宣称真实 MCP 执行 |
| Real opencode | Terminal | release-only smoke | 只在接受费用时执行 |

## 当前不要宣称

- 不要说真实 opencode 是默认 CI/verify 路径。
- 不要说 fake engine 是真实 provider 行为。
- 不要说当前能还原 opencode 内部私有 Skill 调用栈。
- 不要说 v1.3 已创建真实 GitHub PR。
- 不要说系统会自动 push、merge 或自动通过 Gate。
- 不要说 MCP 真执行 / MCP policy enforcement 已完成。
- 不要说 RAG/vector retrieval 已接入。
- 不要说 Windows Electron full smoke 已完成。
