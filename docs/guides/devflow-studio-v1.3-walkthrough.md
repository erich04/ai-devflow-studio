# DevFlow Studio v1.3 手动 Walkthrough 指南

更新时间：2026-06-21  
适用版本：`v1.3 delivery-flow candidate`

这份指南用于人工验证 DevFlow Studio 的端到端交付流程：从需求创建，到澄清/设计 Gate，
再到 Coding、测试、PR Draft、验收证据包。默认路径不调用真实付费模型。

## 你会验证什么

- 从真实用户需求创建 Workflow Run，而不是克隆 seed run。
- `clarify -> design -> build -> test -> pr -> accept` 六阶段在画布中可见。
- Gate approval 会沿 workflow edge 推进 `currentNodeId`，不会再把所有 Gate 都硬编码成
  `building`。
- PR 阶段可以生成本地 `PR Draft` artifact。
- Acceptance 阶段可以生成 `Acceptance Bundle` artifact。
- Coding、Test Evidence、Gate Enforcement、Agent Review、Budget、Tool / Skill Trace 仍保持
  v1.2 行为。

## 0. 启动前检查

```bash
cd /Users/erich/File/claude/10-showcase/ai-devflow-studio
corepack pnpm install
corepack pnpm release:status
corepack pnpm verify
```

如果只是人工体验，可以先运行真实 Electron：

```bash
corepack pnpm dev:electron
```

通过标准：

- 打开的是真实 `AI DevFlow Studio`，不是 Electron default app。
- 左侧能看到 Workbench、Team Overview、Knowledge、Agents、Skills、MCP、Tests。
- 当前 walkthrough 默认使用 fake provider / fake coding engine，不产生真实模型费用。

![Electron Workbench](./screenshots/14-electron-current-userdata-workbench.png)

## 1. 选择本地仓库

在 Workbench 的 `Local Project` 面板中选择当前仓库：

```text
/Users/erich/File/claude/10-showcase/ai-devflow-studio
```

通过标准：

- 本地项目名称和路径显示出来。
- 测试命令可以保存。
- 危险命令会被 command safety 阻断。

## 2. 从需求创建 Run

点击顶部 `新建 Run`。

填写：

- 标题：`修复 webhook retry 失败边界`
- 一句话需求：`请澄清 webhook retry 的失败边界，设计最小实现方案，完成本地实现、测试、PR handoff 和验收证据。`

点击 `创建并开始澄清`。

通过标准：

- Run 列表出现新标题。
- 新 Run 的状态是 `clarifying`。
- 画布出现六个阶段：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收。
- 澄清节点 Inspector 中出现 `Raw request` artifact，内容是你输入的需求。

## 3. Gate 推进

选择需求确认 Gate，点击 `通过 Gate`。

通过标准：

- 当前节点推进到 Design 阶段。
- Run 状态变成 `designing`。
- toast 显示 Gate 已通过或流程已推进。
- 不应出现旧行为：所有 Gate approval 都把 Run 强行改成 `building`。

继续选择方案评审 Gate，点击 `通过 Gate`。

通过标准：

- 当前节点推进到 Build task。
- Run 状态变成 `building`。
- Build task 才显示 `Coding Agent` 操作。

![Workbench Gate Enforcement](./screenshots/01-workbench-gate-enforcement.png)

## 4. Coding Agent 与 Test Evidence

选择 Build task，点击 `Coding Agent`。

默认 fake path：

- 创建 managed worktree。
- 产生 permission request。
- 在 Agents 视图批准 permission。
- 生成 redacted diff artifact。
- 生成 bootstrap / test evidence。

通过标准：

- Coding Agent 只从 `stage: build` 且 `kind: task` 的节点启动。
- 主仓库不被直接修改。
- Agents 中能看到 permission、Tool / Skill Timeline、diff、cleanup、terminal state。

![Coding Node](./screenshots/09-coding-node.png)

选择 Test 节点或 Tests 视图运行测试。

通过标准：

- 测试证据显示 command/status/exit code/duration。
- 输出经过 redaction，不应暴露 secret 或完整本地敏感路径。

![Tests Evidence](./screenshots/05-tests-evidence.png)

## 5. 生成 PR Draft

选择 PR 节点，点击 `生成 PR Draft`。

通过标准：

- Inspector 的 Artifacts 中出现 `PR Draft:`。
- 内容包含：
  - Request；
  - changed paths；
  - Test Evidence；
  - Policy；
  - Budget；
  - Agent Review；
  - safe compare URL，若仓库映射不安全则显示 unavailable。
- PR Draft 不包含 raw patch body、raw stdout/stderr、provider secret 或完整本地 cwd。

当前 v1.3 只生成 PR handoff artifact，不创建真实 GitHub PR。

## 6. 生成验收证据包

选择 Acceptance 节点，点击 `生成验收证据包`。

通过标准：

- Inspector 的 Artifacts 中出现 `Acceptance Bundle:`。
- 内容引用：
  - Raw Request；
  - PR Draft；
  - changed paths；
  - Tests；
  - Policy；
  - Budget；
  - Agent Review。
- Acceptance approval 仍走 Gate Enforcement 写路径，不因生成 bundle 自动通过。

## 7. Final Acceptance Gate

在 Acceptance 节点点击 `通过 Gate`。

通过标准：

- Run 状态变成 `completed`。
- 这是业务验收完成，不是自动 merge 或自动发布。
- 如果 Gate Enforcement 阻断，必须先补证据或走合法 override。

## 8. Team / Budget / Sync 回归检查

打开 Team Overview 和 Web Team Console。

通过标准：

- Web/API/Postgres 自托管路径仍可显示 redacted Run/Evidence/Review/Coding/Cost summary。
- Runtime Budget policy / approval UI 仍可用。
- Desktop pairing 和 `同步团队` 仍通过 Bearer token 工作。

![Web Team Overview](./screenshots/08-team-overview.png)

## 9. Release-only 真实 opencode + 豆包/Volcengine Smoke

这一步会消耗真实 provider 配额，不属于默认 walkthrough。

```bash
corepack pnpm opencode:status

DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ARK_API_KEY \
corepack pnpm test:opencode-smoke
```

通过标准：

- 真实 opencode permission relay 通过。
- 捕获 redacted diff。
- 保存 fixture Test Evidence。
- 记录 Tool / Skill Timeline。
- process/worktree cleanup 完成。
- 不泄露 provider key、raw cwd、raw stdout/stderr、raw prompt、完整 patch。

## 10. 人工 Walkthrough 核对表

| 步骤 | 入口 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| Release status | Terminal | `corepack pnpm release:status` | package/tag/docs/git state 正常；manual walkthrough 可 pending |
| Desktop launch | Terminal | `corepack pnpm dev:electron` | 打开 AI DevFlow Studio，不是 default app |
| Request intake | Workbench | 新建 Run 并输入需求 | 创建 raw_request artifact；Run 从 `clarifying` 开始 |
| Workflow advance | Gate Inspector | 通过需求确认 / 方案评审 Gate | `currentNodeId` 推进；Run status 对应下一阶段 |
| Coding | Build task | 点击 Coding Agent 并 approve permission | managed worktree + diff + test evidence |
| PR Draft | PR node | 点击 `生成 PR Draft` | PR draft artifact 出现，含 diff/test/policy/budget/review 摘要 |
| Acceptance Bundle | Acceptance node | 点击 `生成验收证据包` | Acceptance bundle artifact 出现，引用 PR draft 和证据 |
| Acceptance Signoff | Acceptance node | 点击 `通过 Gate` | Run completed 或被 Gate Enforcement 合法阻断 |
| Team Sync | Desktop/Web | Pair + 同步团队 | Web 只看到 redacted summary |
| Real opencode | Terminal | env-gated `test:opencode-smoke` | 仅在接受真实费用时执行 |

## 当前不要宣称

- 不要说 v1.3 已创建真实 GitHub PR。
- 不要说系统会自动 push、merge 或自动通过 Gate。
- 不要说真实 opencode 是默认 CI/verify 路径。
- 不要说 MCP 真执行 / MCP policy enforcement 已完成。
- 不要说 RAG/vector retrieval 已接入。
- 不要说 Windows Electron full smoke 已完成。
