import type {
  AgentEvent,
  Artifact,
  KnowledgeEntity,
  KnowledgeSourceFile,
  KnowledgeRelation,
  McpServerDefinition,
  Project,
  SkillDefinition,
  TeamMember,
  TokenUsage,
  WorkflowRun,
} from './domain'
import { indexKnowledgeSources } from './knowledge'

export const members: TeamMember[] = [
  { id: 'u-erich', name: 'Erich', role: 'owner', avatarInitials: 'ER', focus: 'Platform' },
  { id: 'u-ling', name: 'Ling', role: 'lead', avatarInitials: 'LG', focus: 'Architecture' },
  { id: 'u-wang', name: '小王', role: 'member', avatarInitials: '王', focus: 'Backend' },
  { id: 'u-yu', name: 'Yu', role: 'member', avatarInitials: 'YU', focus: 'QA' },
]

export const projects: Project[] = [
  {
    id: 'p-payments',
    name: 'Payments API',
    slug: 'payments-api',
    description: 'API service for payment workflow delivery.',
    repository: 'erich/payments-api',
    defaultBranch: 'main',
    health: 'at_risk',
    knowledgeBasePath: 'docs/payments/',
    testCommand: 'pnpm test && pnpm typecheck',
  },
  {
    id: 'p-admin',
    name: 'Internal Admin Console',
    slug: 'internal-admin-console',
    description: 'Internal console for operational workflow visibility.',
    repository: 'erich/internal-admin-console',
    defaultBranch: 'main',
    health: 'on_track',
    knowledgeBasePath: 'docs/context/',
    testCommand: 'npm run test',
  },
]

export const runs: WorkflowRun[] = [
  {
    id: 'run-health-001',
    title: '为 Payments API 增加 /health 端点',
    request: '给 API 增加一个返回 db/redis/runtime 状态的 health endpoint，并补齐测试。',
    projectId: 'p-payments',
    creatorId: 'u-wang',
    status: 'paused_at_gate',
    currentNodeId: 'n-design-gate',
    branchName: 'ai/health-endpoint',
    createdAt: '2026-06-15T14:20:00.000Z',
    updatedAt: '2026-06-15T15:01:00.000Z',
    nodes: [
      {
        id: 'n-clarify',
        stage: 'clarify',
        title: '需求澄清',
        subtitle: '补齐验收口径与非目标',
        kind: 'agent',
        status: 'success',
        ownerId: 'u-wang',
        retryCount: 0,
        tokenUsageId: 'tok-1',
        artifactIds: ['art-clarify'],
      },
      {
        id: 'n-clarify-gate',
        stage: 'clarify',
        title: '需求确认 Gate',
        subtitle: 'Member 确认需求表达',
        kind: 'gate',
        status: 'success',
        ownerId: 'u-wang',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: ['art-clarify'],
      },
      {
        id: 'n-design',
        stage: 'design',
        title: '方案设计',
        subtitle: '接口、错误模型与测试策略',
        kind: 'agent',
        status: 'success',
        ownerId: 'u-ling',
        retryCount: 0,
        tokenUsageId: 'tok-2',
        artifactIds: ['art-design'],
      },
      {
        id: 'n-design-gate',
        stage: 'design',
        title: '方案评审 Gate',
        subtitle: 'Lead 审批方案后进入实现',
        kind: 'gate',
        status: 'blocked',
        ownerId: 'u-ling',
        requiredRole: 'lead',
        retryCount: 0,
        artifactIds: ['art-design'],
      },
      {
        id: 'n-build',
        stage: 'build',
        title: '本地实现',
        subtitle: '本地执行代理应用代码变更',
        kind: 'task',
        status: 'pending',
        ownerId: 'u-wang',
        retryCount: 0,
        artifactIds: ['art-diff'],
      },
      {
        id: 'n-test',
        stage: 'test',
        title: '开发自测',
        subtitle: '执行单测与 API smoke',
        kind: 'test',
        status: 'pending',
        ownerId: 'u-yu',
        retryCount: 0,
        artifactIds: ['art-test'],
      },
      {
        id: 'n-pr',
        stage: 'pr',
        title: '创建 PR',
        subtitle: '生成描述并关联证据',
        kind: 'pr',
        status: 'pending',
        ownerId: 'u-wang',
        retryCount: 0,
        artifactIds: ['art-pr'],
      },
      {
        id: 'n-accept',
        stage: 'accept',
        title: '业务验收',
        subtitle: 'Lead/Owner 终审',
        kind: 'acceptance',
        status: 'pending',
        ownerId: 'u-ling',
        requiredRole: 'lead',
        retryCount: 0,
        artifactIds: ['art-accept'],
      },
    ],
    edges: [
      { id: 'e1', source: 'n-clarify', target: 'n-clarify-gate', kind: 'gate' },
      { id: 'e2', source: 'n-clarify-gate', target: 'n-design', kind: 'normal' },
      { id: 'e3', source: 'n-design', target: 'n-design-gate', kind: 'gate' },
      { id: 'e4', source: 'n-design-gate', target: 'n-build', kind: 'normal' },
      { id: 'e5', source: 'n-build', target: 'n-test', kind: 'normal' },
      { id: 'e6', source: 'n-test', target: 'n-pr', kind: 'normal' },
      { id: 'e7', source: 'n-pr', target: 'n-accept', kind: 'gate' },
    ],
  },
]

export const artifacts: Artifact[] = [
  {
    id: 'art-clarify',
    runId: 'run-health-001',
    nodeId: 'n-clarify',
    kind: 'clarification',
    title: '需求澄清结果',
    summary: '明确 health endpoint 返回 db、redis、runtime 三类状态，不做鉴权改造。',
    content: '目标：新增 GET /health。非目标：不改现有 auth middleware。验收：db/redis 不可用时返回 degraded。',
    redacted: false,
    updatedAt: '2026-06-15T14:29:00.000Z',
  },
  {
    id: 'art-design',
    runId: 'run-health-001',
    nodeId: 'n-design',
    kind: 'design',
    title: '方案设计',
    summary: '新增 health service，API route 只做组合与状态码映射。',
    content: '方案：healthService.check() 并行探测 db/redis/runtime。200=ok，207=degraded，503=down。',
    redacted: false,
    updatedAt: '2026-06-15T14:57:00.000Z',
  },
  {
    id: 'art-diff',
    runId: 'run-health-001',
    nodeId: 'n-build',
    kind: 'diff',
    title: '预计代码变更',
    summary: '新增 route、service、unit test、API smoke fixture。',
    content: 'packages/api/src/routes/health.ts\npackages/api/src/services/health-service.ts\npackages/api/src/services/health-service.test.ts',
    redacted: false,
    updatedAt: '2026-06-15T15:00:00.000Z',
  },
  {
    id: 'art-test',
    runId: 'run-health-001',
    nodeId: 'n-test',
    kind: 'test_report',
    title: '测试计划',
    summary: '覆盖 ok/degraded/down 和 Redis timeout。',
    content: 'Unit: 6 cases. Smoke: curl /health. Evidence: logs + coverage summary.',
    redacted: false,
    updatedAt: '2026-06-15T15:00:00.000Z',
  },
  {
    id: 'art-pr',
    runId: 'run-health-001',
    nodeId: 'n-pr',
    kind: 'pr',
    title: 'PR 元数据',
    summary: 'PR 生成后写入 GitHub 链接、checks 状态与 review 摘要。',
    content: 'Pending PR creation.',
    redacted: false,
    updatedAt: '2026-06-15T15:00:00.000Z',
  },
  {
    id: 'art-accept',
    runId: 'run-health-001',
    nodeId: 'n-accept',
    kind: 'acceptance',
    title: '验收清单',
    summary: '业务确认健康检查可用于部署前 smoke。',
    content: '- [ ] ok 状态\n- [ ] degraded 状态\n- [ ] down 状态\n- [ ] 日志可追踪',
    redacted: false,
    updatedAt: '2026-06-15T15:00:00.000Z',
  },
]

export const tokenUsage: TokenUsage[] = [
  {
    id: 'tok-1',
    runId: 'run-health-001',
    nodeId: 'n-clarify',
    userId: 'u-wang',
    projectId: 'p-payments',
    provider: 'dashscope',
    model: 'qwen3-coder-plus',
    inputTokens: 9320,
    outputTokens: 2240,
    cacheReadTokens: 1800,
    costUsd: 0.042,
    timestamp: '2026-06-15T14:29:00.000Z',
  },
  {
    id: 'tok-2',
    runId: 'run-health-001',
    nodeId: 'n-design',
    userId: 'u-ling',
    projectId: 'p-payments',
    provider: 'dashscope',
    model: 'qwen3-coder-plus',
    inputTokens: 12880,
    outputTokens: 3340,
    cacheReadTokens: 2400,
    costUsd: 0.067,
    timestamp: '2026-06-15T14:57:00.000Z',
  },
]

export const events: AgentEvent[] = [
  {
    id: 'ev-1',
    runId: 'run-health-001',
    nodeId: 'n-clarify',
    sequence: 1,
    kind: 'thinking',
    message: '识别到需求缺少 degraded 状态定义，生成澄清问题。',
    timestamp: '2026-06-15T14:23:10.000Z',
  },
  {
    id: 'ev-2',
    runId: 'run-health-001',
    nodeId: 'n-design',
    sequence: 2,
    kind: 'tool_call',
    message: '读取 task-lifecycle-kb/standards/api-design-guidelines.md',
    timestamp: '2026-06-15T14:39:44.000Z',
  },
  {
    id: 'ev-3',
    runId: 'run-health-001',
    nodeId: 'n-design-gate',
    sequence: 3,
    kind: 'approval',
    message: '等待 Lead 审批方案评审 Gate。',
    timestamp: '2026-06-15T15:01:00.000Z',
  },
]

export const skills: SkillDefinition[] = [
  {
    id: 'skill-design-review',
    name: '方案评审',
    stage: 'design',
    description: '检查目标、边界、数据、接口、安全、测试和交付风险。',
    version: '0.1.0',
    enabled: true,
    source: 'team',
  },
  {
    id: 'skill-test-plan',
    name: '测试准备',
    stage: 'test',
    description: '根据方案生成单元、集成、smoke 和验收测试计划。',
    version: '0.1.0',
    enabled: true,
    source: 'team',
  },
  {
    id: 'skill-knowledge-sync',
    name: '知识沉淀',
    stage: 'all',
    description: '从 Run artifact 中提取可复用术语、决策和模板候选。',
    version: '0.1.0',
    enabled: false,
    source: 'project',
  },
]

export const mcpServers: McpServerDefinition[] = [
  {
    id: 'mcp-filesystem',
    name: 'Filesystem',
    command: 'mcp-server-filesystem ~/workspace',
    permission: 'write',
    enabledLocally: true,
    lastAuditEvent: '读取仓库文件并生成方案上下文',
  },
  {
    id: 'mcp-github',
    name: 'GitHub',
    command: 'mcp-server-github',
    permission: 'network',
    enabledLocally: true,
    lastAuditEvent: '查询 PR checks 状态',
  },
  {
    id: 'mcp-browser',
    name: 'Browser QA',
    command: 'mcp-server-browser',
    permission: 'network',
    enabledLocally: false,
    lastAuditEvent: '未启用',
  },
]

export const knowledgeSources: KnowledgeSourceFile[] = [
  {
    sourcePath: 'docs/knowledge/standards/api-health.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: API Health Endpoint Standard
category: api_contract
ownerId: u-ling
tags: api, health, degraded
summary: Health endpoints must expose ok, degraded, and down states with explicit status mapping.
---

# API Health Endpoint Standard

Health endpoints must expose ok, degraded, and down states with explicit status mapping.

- Route handlers compose service results; services own dependency checks.
- Degraded dependencies must remain observable in test evidence.
- Runtime, database, and cache checks must be safe to call during deploy smoke.
`,
  },
  {
    sourcePath: 'docs/knowledge/standards/testing-evidence.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: Local Test Evidence Standard
category: testing_standard
ownerId: u-yu
tags: test, evidence, smoke
summary: Local test evidence needs command, exit code, duration, and redacted output.
---

# Local Test Evidence Standard

Local test evidence needs command, exit code, duration, and redacted output.

- Store only bounded stdout and stderr.
- Redact API keys and tokens before evidence is persisted or synchronized.
- Failed tests must remain visible to reviewers.
`,
  },
  {
    sourcePath: 'docs/knowledge/prompts/opendesign-design-prompts.md',
    updatedAt: '2026-06-23T08:00:00.000Z',
    markdown: `# OpenDesign Design Prompts

This file stores reusable prompts for design work with OpenDesign.

## Usage Rules

- Keep prompts reusable and product-agnostic when possible.
- Record the design goal, target surface, constraints, and expected output.
- Prefer prompts that produce concrete UI states, not broad visual exploration only.
- When a prompt works well, add the date and the result it helped produce.

## Prompt Entry Template

\`\`\`md
### YYYY-MM-DD - Short Prompt Name

**Use case**:

**Prompt**:

\`\`\`text
Paste the exact OpenDesign prompt here.
\`\`\`

**Result / notes**:
\`\`\`

## Core Prompt Templates

### Product Surface Redesign

\`\`\`text
Design a production-grade interface for [product/surface].

Audience:
- [target users]

Primary job:
- [what the user needs to accomplish]

Context:
- [business/product context]

Required UI states:
- Default state
- Empty state
- Loading state
- Error or blocked state
- Success/completed state

Constraints:
- Keep the interface work-focused and suitable for repeated daily use.
- Prioritize scanability, clear hierarchy, and low-friction workflows.
- Avoid decorative landing-page composition.
- Preserve existing product terminology unless a better label is clearly justified.

Output:
- One complete screen design.
- Include realistic data.
- Include key controls and navigation needed for the workflow.
\`\`\`

### Existing Screen Refactor

\`\`\`text
Refactor this existing screen into a clearer and more scalable interface.

Do not change:
- Core workflow semantics
- Domain terminology
- Required actions

Improve:
- Information hierarchy
- Navigation clarity
- Density and scanability
- Empty/loading/error states
- Repeated-use ergonomics

Keep the result suitable for an operational desktop/web app, not a marketing page.
\`\`\`

### Design Direction Exploration

\`\`\`text
Create 3 distinct visual directions for [surface/product].

All directions must support:
- [workflow 1]
- [workflow 2]
- [workflow 3]

Each direction should vary:
- Layout structure
- Density
- Navigation model
- Visual tone

Do not use decorative-only hero sections. Show real product state and realistic data.
\`\`\`

## Saved Prompts

Add proven prompts below this line.

### 2026-06-23 - DevFlow Studio Current Product Summary V1

**Use case**:
OpenDesign prompt/source context for the current DevFlow Studio Electron app state before the full-module V2 product interface prompt.

**Prompt**:

\`\`\`text
以下是当前本地 Electron 应用的最新文字总结，按你正在体验的 \`AI DevFlow Studio\` 工作树状态来描述。注意：这是**当前开发态**，不是已正式 release 的稳定版说明。

**一句话定位**
DevFlow Studio 是一个本地优先的 AI 交付工作台：把一个需求从创建 Run、需求澄清、方案设计、编码、测试证据、PR 交付、业务验收串起来，并在关键 Gate 上加入 Knowledge Review、Policy Enforcement、Budget Guard、真实/假 Agent Runtime 的可观测记录。

**核心业务模型**
- **Team Project**：团队项目，例如 \`Payments API\`。它决定 Run 归属、团队策略、远端同步和预算策略。
- **Local Project**：本地代码仓库，例如 \`ai-devflow-studio\`。它用于本地测试命令、Coding Agent worktree、diff 和 Test Evidence。
- **Run**：一次需求交付实例，例如“优化空搜索结果提示文案”。一个 Run 包含节点、artifact、review、测试、coding trace。
- **Node**：流程中的一个步骤。现在有六段：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收。
- **Artifact**：阶段产物，例如 Raw Request、Clarification Brief、Design Brief、Coding Diff、Test Report、PR Draft、Acceptance Bundle。
- **Gate**：人工/策略审批点。Gate 是否能通过由角色权限、团队 policy、Knowledge Review、证据状态共同决定。
- **Evidence / Event / Trace**：运行过程证据，包括 Agent Review、Test Evidence、Coding Trace、permission、tool call、cleanup、budget decision 等。

**主流程**
1. 用户点击 \`新建 Run\`，输入一个需求。
2. 系统创建六阶段 workflow，当前节点通常从“需求澄清 Agent”开始。
3. 用户点击生成澄清/设计产物，系统确定性生成对应 artifact，并推进到下一个 Gate。
4. Gate 阶段需要看团队 policy、Knowledge Review、治理证据是否满足。
5. Knowledge Review Agent 会检索知识库、组装 review prompt、调用 fake 或真实模型 provider，生成 Gate Advisory。
6. Build 节点可以启动 Coding Agent。Coding Agent 负责在 managed worktree 中执行变更、生成 diff、跑测试、保存 Test Evidence。
7. Test 阶段归档测试结果。
8. PR 阶段生成 PR Draft / compare handoff，不自动 push 或 merge。
9. Acceptance 阶段生成验收包并完成业务验收。

**当前界面结构**
左侧是主导航：
- \`工作台\`：主流程画布和 Inspector。
- \`Team Overview\`：团队/远端同步/预算/概览。
- \`Knowledge\`：知识引用、治理检查、知识材料。
- \`Agents\`：Knowledge Review Agent、Coding Agent 状态、provider 配置、trace。
- \`Skills\`：技能/能力展示。
- \`MCP\`：MCP server 配置和状态。
- \`测试\`：本地测试命令和 Test Evidence。

顶部栏包含：
- 当前 Team Project 显示，例如 \`Payments API\`。
- 搜索框：搜索当前加载的 Run、Artifact、Knowledge/Event，不是直接搜索本地文件系统 markdown。
- 主题切换。
- Pairing code / Pair：桌面端和团队后端配对。
- \`同步团队\`：拉取团队策略/远端状态。
- \`Redaction\`：脱敏检查。
- \`新建 Run\`。
- 当前用户标识。

工作台中间是 workflow board：
- 横向分为六个阶段。
- 每个阶段下有 agent/gate/task/test/pr/acceptance 节点卡片。
- 点击节点后，右侧 Inspector 显示该节点的状态、可执行动作和阻断原因。

右侧 Inspector 负责：
- 展示当前节点标题、阶段、说明。
- 显示 Gate Enforcement 状态。
- 显示 Knowledge Governance 缺口。
- 提供当前节点可执行动作，例如生成澄清结果、运行 Knowledge Review、通过 Gate、运行 Coding Agent、生成 PR Draft。
- 展示相关 artifact、agent event、trace。

**Knowledge Review 逻辑**
DevFlow 自己实现 Review Agent 的业务逻辑：检索知识、组装上下文、构造 review prompt、解析结构化结果。模型 provider 只是推理后端。

当前支持：
- \`Deterministic Fake Provider\`：默认、无成本、可重复，用于本地开发和 CI。
- \`OpenAI-compatible / Volcengine Ark\`：你配置的豆包/火山 provider，例如 \`doubao-review\` + \`ark-code-latest\`。

这里不是 opencode 在做 review。opencode 只属于 Coding Agent runtime。Knowledge Review 是 DevFlow 自己的 Agent 核心调用模型 provider。

**Coding Agent 逻辑**
Coding Agent 和 Knowledge Review 是两条不同链路：
- Knowledge Review：评审需求/证据/知识治理。
- Coding Agent：执行代码修改。

Coding Agent 可走：
- fake engine：默认验证路径，稳定、无成本。
- real opencode runtime：release-only / 手动 smoke，用真实 provider，可能消耗 token。

Coding Agent 会：
- 创建 managed worktree。
- 生成 coding brief。
- 处理 permission request/reply。
- 产出 diff。
- 跑本地测试命令。
- 保存 Test Evidence。
- 记录 tool/skill/coding trace、cleanup、timeout/cancel 状态。

**Gate Enforcement 逻辑**
Gate 不只是按钮审批。它会综合：
- 角色权限。
- 当前节点是否真的到 Gate。
- 团队 policy 是否可用。
- Knowledge Review 是否完成。
- Test Evidence 是否满足。
- 是否有 lead override。
- 是否存在 hard block。

常见状态：
- \`blocked_policy_unavailable\`：团队 policy 未缓存，需要 Pair/同步团队。
- \`missing_agent_review\`：缺 Knowledge Review。
- \`warn\`：有缺口但不阻止审批。
- \`blocked\`：阻止审批，需要补证据或 override。
- \`hard_blocked\`：不可 override，只能按 remediation 修复。

**Budget / Cost 逻辑**
应用已经有 runtime cost 与 budget guard：
- 统计 token/cost。
- 可阻止超预算 runtime 在 \`engine.start\` 前调用真实 provider。
- 支持 approvalId 形式的 over-budget approval。
- UI 中会显示 Token Cost、provider usage source、latest cost。

**当前体验上明显的问题**
- 顶部 \`Project\` 看起来像项目选择器，但实际更像当前 Run 的 Team Project 显示，容易误解。
- \`Team Project\` 和 \`Local Project\` 两个概念视觉上没有充分分离。
- Workbench 和 Agents 页都能影响当前 Run，职责边界对用户不够清晰。
- Inspector 信息密度偏高，Gate Enforcement、Knowledge Governance、Review、Coding Trace 混在一条长侧栏里。
- 当前流程虽已能走，但“下一步该点哪里”还不够强提示。
- 搜索框当前不是全局文件搜索，输入 \`markdown\` 搜不到本地 markdown 是符合当前实现的，但文案会误导。

**当前状态判断**
业务能力已经不只是 demo 壳：Run、Workflow、Artifact、Knowledge Review、Gate Policy、Coding Agent、Test Evidence、Budget、Pairing/Sync 都已经有真实链路。  
但界面信息架构还需要整理。现在的问题主要不是“能力不存在”，而是“能力堆在一起后，用户不知道每一步该如何理解和操作”。

涉及的核心代码位置：
- [App.tsx](/Users/erich/File/claude/10-showcase/ai-devflow-studio/apps/desktop/src/App.tsx)
- [workflow.ts](/Users/erich/File/claude/10-showcase/ai-devflow-studio/packages/shared/src/workflow.ts)
- [main.ts](/Users/erich/File/claude/10-showcase/ai-devflow-studio/apps/desktop/electron/main.ts)
- [desktop-api.ts](/Users/erich/File/claude/10-showcase/ai-devflow-studio/apps/desktop/src/desktop-api.ts)
\`\`\`

**Result / notes**:
First version. Captures the current development-state product model, flow, UI structure, agent/runtime boundaries, and known information-architecture issues.

### 2026-06-23 - DevFlow Studio Full Product Interface V2

**Use case**:
OpenDesign prompt for a complete DevFlow Studio Electron desktop product interface covering all primary modules and cross-module delivery-flow linkage.

**Prompt**:

\`\`\`text
请设计 DevFlow Studio Electron 桌面端完整产品界面，包含入口、工作台、Team Overview、Knowledge、Agents、Skills、MCP、Tests 七个主板块，并让它们围绕同一个 Run delivery flow 联动。

全局 Shell：
左侧固定导航：工作台、Team Overview、Knowledge、Agents、Skills、MCP、测试。顶部包含项目选择器、全局搜索、主题切换、Desktop pairing code、同步团队、Redaction、新建 Run、用户头像。顶部状态条显示 Active Runs、Pending Gates、Token Cost、Tests Today、同步/策略错误。所有页面共享搜索、toast、loading、empty、blocked、failed 状态。

入口 / 新建 Run：
入口不是营销页，而是创建交付流的操作入口。点击“新建 Run”打开 modal，输入标题和一句话需求，点击“创建并开始澄清”后生成 raw request artifact，左侧 Run 列表新增并选中，中间画布高亮需求澄清节点，右侧 Inspector 显示当前节点动作。

工作台 Workbench：
三列布局。左列是 Local Project + Runs，支持选择本地仓库、编辑测试命令、显示 command safety、保存测试命令、切换 Run。中间是六阶段工作流画布：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收；节点点击后刷新右侧。右侧 Inspector 根据节点类型显示 Gate Enforcement、Knowledge Governance、Agent Review、Artifacts、Agent Events 和上下文动作。Gate 通过必须受策略控制，不允许只是 UI disabled。

Team Overview：
展示团队可见的 redacted delivery health，而不是本地 raw log。包含项目列表、repository、health badge、test command、active/latest Run、Gate 状态、policy/budget/test/review rollup、成员角色、token/cost rollup、同步来源 local/remote/seed。这里要强调“团队视图只看脱敏摘要”。

Knowledge：
展示 Git Markdown Index、知识文档卡、source path、category、tags、轻量知识图谱、Run references。与工作台联动：当前 Run/Node 的 Knowledge Governance 检查在 Inspector 里展示，Knowledge 页用于深挖引用来源、score、heading path、content hash。

Agents：
分两块：Knowledge Review Agent 和 Coding Agent。Knowledge Review 区包含 provider 选择、credential 表单、Run Review 按钮、review history、Gate Advisory、trace、token usage、cost source。Coding Agent 区包含 Run Coding Agent、managed worktree、permission relay、Approve once / Reject、runtime budget approval、tool timeline、diff preview、changed paths、bootstrap evidence、test evidence、Open worktree、Cancel、Delete worktree。Agents 页不是独立功能页，而是从 Inspector 的 Agent Review / Coding Agent 动作跳转过来的执行控制台。

Skills：
展示团队能力目录。每个 skill 卡片展示名称、描述、stage、enabled/disabled 状态。它说明团队有哪些标准化能力可用于 Run，但不能绕过 Gate、policy 或 evidence requirements。

MCP：
展示本机工具连接器。每个 MCP server 显示 name、command、permission、enabledLocally 状态和 Enable/Disable 操作。MCP 是本地工具能力入口，不应表现成云端集成市场；要强调权限和本地执行边界。

Tests：
展示测试计划与证据。包含测试包说明、执行本地测试按钮、进度/health bar、Test Evidence 列表。每条 evidence 显示 command、status、exit code、duration、redacted yes/no、stdout/stderr 摘要。测试失败、超时、跳过都要明确保存证据，并返回工作台影响 Gate 状态。

跨模块联动：
新建 Run 进入 Workbench；Gate 缺 Agent Review 时从 Inspector 跳到 Agents；执行测试后跳到 Tests；Knowledge Governance 引用可跳到 Knowledge；同步团队影响 Team Overview 和 Gate policy；Coding Agent 产生 diff/test/bootstrap evidence 后回写 Workbench Inspector；PR Draft 和 Acceptance Bundle 都从累积 evidence 生成。整体体验必须是“流程驱动”，不是几个孤立页面。
\`\`\`

**Result / notes**:
Second version. Covers all primary modules and the cross-module delivery flow.
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/pr-review.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: PR Review Readiness Checklist
category: review_checklist
ownerId: u-ling
tags: pr, review, gate
summary: Pull requests should link design, test evidence, reviewer decisions, and rollout notes.
---

# PR Review Readiness Checklist

Pull requests should link design, test evidence, reviewer decisions, and rollout notes.
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/electron-demo-readiness.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: Electron Demo Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: electron, demo, smoke, local
summary: Electron demos should prove the real DevFlow app path, expected renderer port, preload boundary, and local persistence path.
---

# Electron Demo Readiness Checklist

Before using the desktop app for a demo or signoff, confirm the real Electron path is active.

- Start the app with \`corepack pnpm dev:electron\`.
- Confirm the window title is \`AI DevFlow Studio\` or \`ai-devflow-studio\`.
- Confirm Electron launched \`apps/desktop\`, not \`default_app.asar\`.
- Confirm the intended desktop renderer is listening on \`127.0.0.1:5173\`.
- Clear stale DevFlow listeners on \`5173\` before trusting a demo run.
- Open the Workbench and select a Gate node to confirm Inspector state is live.
- Use \`corepack pnpm test:electron-smoke\` for automated signoff of preload, main process, SQLite, and local execution behavior.
- Treat port conflicts or a default Electron welcome page as environment failures that must be fixed before signoff.
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/postgres-smoke-readiness.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: Postgres Smoke Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: postgres, api, smoke, policy
summary: Postgres smoke should run against an explicit clean database and cover migration, policy, override, sync, and redacted overview behavior.
---

# Postgres Smoke Readiness Checklist

Use this checklist when API, repository, migration, policy, override, sync, or manager summary code
changes.

- Set \`DEVFLOW_DATABASE_URL\` explicitly before running Postgres smoke.
- Prefer a disposable clean database for release-style signoff.
- Run the migration/setup path before smoke if the database is new.
- Verify seeded team data can be read through the API repository boundary.
- Verify policy save/read and enforcement evaluation behavior.
- Verify override rejection for owner, member, and conflicted lead cases.
- Verify accepted lead override audit behavior.
- Verify stale policy version rejection.
- Verify approval-like sync summaries are rejected as a Gate enforcement bypass.
- Verify overview responses remain redacted and do not expose local paths, raw logs, prompts, patches, or secrets.
- Remember that \`corepack pnpm verify\` intentionally excludes Postgres smoke.
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/opencode-runtime-signoff.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: opencode Runtime Signoff Checklist
category: review_checklist
ownerId: u-erich
tags: opencode, coding-agent, smoke, provider
summary: Real opencode runtime signoff must be explicit, env-gated, permission-audited, and secret-safe.
---

# opencode Runtime Signoff Checklist

Use this checklist only when intentionally validating the real opencode coding adapter.

- Keep the deterministic fake engine as the default daily verification path.
- Confirm local opencode is installed and compatible with the adapter under test.
- Run \`corepack pnpm opencode:status\` before live smoke to confirm the local binary/version, default fake-engine posture, live-smoke gate, and provider profile state.
- Set \`DEVFLOW_RUN_OPENCODE_SMOKE=1\` intentionally.
- Set \`DEVFLOW_CODING_ENGINE=opencode-http\`.
- Set the intended provider ID and model ID explicitly.
- Set the provider API key through the configured env var, never inline in logs or documentation.
- Run \`corepack pnpm test:opencode-smoke\`.
- Confirm the smoke starts \`opencode serve\`, creates a managed worktree, relays permissions, captures a redacted diff, runs worktree tests, and cleans up temporary smoke state.
- Confirm permission requests are human-visible and unanswered requests reject by default.
- Confirm smoke output does not print provider secrets.
- Keep live opencode smoke out of \`corepack pnpm verify\` and default CI.
- For every future product release, run the live provider smoke once before the release tag and record
  the evidence in the release signoff note. Use \`docs/plans/release-only-real-opencode-smoke.md\` as
  the required evidence template.
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/v09-demo-readiness.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: v0.9 Demo Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: demo, opencode, observability, policy-aware-delivery
summary: v0.9 demos should prove policy-aware delivery, runtime observability, and honest real-opencode boundaries.
---

# v0.9 Demo Readiness Checklist

Use this checklist before presenting the v0.9 real runtime and observability story.

- Start from the v0.8 user guide and the v0.9 demo script.
- Run \`corepack pnpm release:status\` and confirm only intentional release-pending items remain.
- Run \`corepack pnpm opencode:status\` and confirm local opencode version, fake-by-default posture, live-smoke gate, and provider profile state.
- Keep \`corepack pnpm verify\` on the deterministic fake engine.
- If claiming real opencode behavior, run \`corepack pnpm test:opencode-smoke\` with explicit live env vars first.
- Demonstrate Gate Enforcement, Remediation Plan, Knowledge Review, Retry Coding, Tests, and Team Overview in one coherent flow.
- Show which evidence came from fake engine versus real opencode.
- Confirm provider secrets, cwd, raw prompts, raw traces, raw logs, and patches are not shown in team summaries.
- Do not claim automatic repair, MCP runtime enforcement, RAG, packaging, Windows Electron smoke, or default real-opencode verification.
`,
  },
  {
    sourcePath: 'docs/knowledge/adr/gate-governance.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: Gate Governance ADR
category: adr
ownerId: u-erich
tags: gate, approval, governance
summary: Gates are review decisions that must cite evidence and the standards used by reviewers.
---

# Gate Governance ADR

Gates are review decisions that must cite evidence and the standards used by reviewers.
`,
  },
  {
    sourcePath: 'docs/knowledge/rules/mcp-skill-usage.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: Skill and MCP Usage Rules
category: mcp_rule
ownerId: u-erich
tags: skill, mcp, permission
summary: Tool usage must show command intent, permission scope, and audit evidence.
---

# Skill and MCP Usage Rules

Tool usage must show command intent, permission scope, and audit evidence.
`,
  },
]

export const knowledgeIndex = indexKnowledgeSources(knowledgeSources)

export const knowledgeDocuments = knowledgeIndex.documents

export const knowledgeChunks = knowledgeIndex.chunks

export const knowledgeEntities: KnowledgeEntity[] = knowledgeIndex.entities

export const knowledgeRelations: KnowledgeRelation[] = knowledgeIndex.relations
