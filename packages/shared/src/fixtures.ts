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
    version: 1,
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
title: API 健康端点规范
category: api_contract
ownerId: u-ling
tags: api, health, degraded
summary: 健康端点必须提供 ok、degraded、down 三种状态，并明确状态映射。
---

<a id="api-health-endpoint-standard"></a>

# API 健康端点规范

健康端点必须提供 \`ok\`、\`degraded\`、\`down\` 三种状态，并明确状态映射。

- 路由处理器组合服务结果；依赖检查由服务负责。
- 依赖降级必须在测试证据中可见。
- 运行时、数据库和缓存检查必须能够在部署冒烟测试期间安全调用。
`,
  },
  {
    sourcePath: 'docs/knowledge/standards/testing-evidence.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: 本地测试证据规范
category: testing_standard
ownerId: u-yu
tags: test, evidence, smoke
summary: 本地测试证据必须包含命令、退出码、耗时和脱敏输出。
---

<a id="local-test-evidence-standard"></a>

# 本地测试证据规范

本地测试证据必须包含命令、退出码、耗时和脱敏输出。

- 仅保存有长度上限的 stdout 和 stderr。
- 在持久化或同步证据前，先对 API 密钥和令牌脱敏。
- 测试失败必须对审查者可见。
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
DevFlow Studio 是一个本地优先的 AI 交付工作台：把一个需求从创建 Run、需求澄清、方案设计、编码、测试证据、PR 交付、业务验收串起来，并在关键 Gate 上加入基于知识的门禁审查（Knowledge-Grounded Gate Review）、Policy Enforcement、Budget Guard、真实/假 Agent Runtime 的可观测记录。

**核心业务模型**
- **Team Project**：团队项目，例如 \`Payments API\`。它决定 Run 归属、团队策略、远端同步和预算策略。
- **Local Project**：本地代码仓库，例如 \`ai-devflow-studio\`。它用于本地测试命令、Coding Agent worktree、diff 和 Test Evidence。
- **Run**：一次需求交付实例，例如“优化空搜索结果提示文案”。一个 Run 包含节点、artifact、review、测试、coding trace。
- **Node**：流程中的一个步骤。现在有六段：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收。
- **Artifact**：阶段产物，例如 Raw Request、Clarification Brief、Design Brief、Coding Diff、Test Report、PR Draft、Acceptance Bundle。
- **Gate**：人工/策略审批点。Gate 是否能通过由角色权限、团队 policy、门禁审查、证据状态共同决定。
- **Evidence / Event / Trace**：运行过程证据，包括 Gate Review、Test Evidence、Coding Trace、permission、tool call、cleanup、budget decision 等。

**主流程**
1. 用户点击 \`新建 Run\`，输入一个需求。
2. 系统创建六阶段 workflow，当前节点通常从“需求澄清 Agent”开始。
3. 用户点击生成澄清/设计产物，系统确定性生成对应 artifact，并推进到下一个 Gate。
4. Gate 阶段需要看团队 policy、门禁审查和治理证据是否满足。
5. 门禁审查 Agent 会以检索到的 Knowledge 与规范为依据，审查当前 Gate、门禁条件和阶段产物，生成 Gate Advisory。
6. Build 节点可以启动 Coding Agent。Coding Agent 负责在 managed worktree 中执行变更、生成 diff、跑测试、保存 Test Evidence。
7. Test 阶段归档测试结果。
8. PR 阶段生成 PR Draft / compare handoff，不自动 push 或 merge。
9. Acceptance 阶段生成验收包并完成业务验收。

**当前界面结构**
左侧是主导航：
- \`工作台\`：主流程画布和 Inspector。
- \`Team Overview\`：团队/远端同步/预算/概览。
- \`Knowledge\`：知识引用、治理检查、知识材料。
- \`Agents\`：门禁审查 Agent、Coding Agent 状态、provider 配置、trace。
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
- 提供当前节点可执行动作，例如生成澄清结果、运行门禁审查、通过 Gate、运行 Coding Agent、生成 PR Draft。
- 展示相关 artifact、agent event、trace。

**基于知识的门禁审查逻辑**
DevFlow 自己实现门禁审查 Agent 的业务逻辑：Knowledge 是审查依据，当前 Gate、门禁条件和阶段产物是审查对象；系统会检索知识、组装上下文、构造 review prompt 并解析结构化结果。模型 provider 只是推理后端。

当前支持：
- \`Deterministic Fake Provider\`：默认、无成本、可重复，用于本地开发和 CI。
- \`OpenAI-compatible / Volcengine Ark\`：你配置的豆包/火山 provider，例如 \`doubao-review\` + \`ark-code-latest\`。

这里不是 opencode 在做门禁审查。opencode 只属于 Coding Agent runtime。基于知识的门禁审查由 DevFlow 自己的 Agent 核心调用模型 provider。

**Coding Agent 逻辑**
Coding Agent 和门禁审查是两条不同链路：
- 门禁审查：以 Knowledge 与规范为依据，审查当前 Gate 条件和阶段产物。
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
- 门禁审查是否完成。
- Test Evidence 是否满足。
- 是否有 lead override。
- 是否存在 hard block。

常见状态：
- \`blocked_policy_unavailable\`：团队 policy 未缓存，需要 Pair/同步团队。
- \`missing_agent_review\`：缺门禁审查结果。
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
业务能力已经不只是 demo 壳：Run、Workflow、Artifact、门禁审查、Gate Policy、Coding Agent、Test Evidence、Budget、Pairing/Sync 都已经有真实链路。
但界面信息架构还需要整理。现在的问题主要不是“能力不存在”，而是“能力堆在一起后，用户不知道每一步该如何理解和操作”。

涉及的核心代码位置：
- [App.tsx](../../../apps/desktop/src/App.tsx)
- [workflow.ts](../../../packages/shared/src/workflow.ts)
- [main.ts](../../../apps/desktop/electron/main.ts)
- [desktop-api.ts](../../../apps/desktop/src/desktop-api.ts)
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
三列布局。左列是 Local Project + Runs，支持选择本地仓库、编辑测试命令、显示 command safety、保存测试命令、切换 Run。中间是六阶段工作流画布：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收；节点点击后刷新右侧。右侧 Inspector 根据节点类型显示 Gate Enforcement、Knowledge Governance、门禁审查、Artifacts、Agent Events 和上下文动作。Gate 通过必须受策略控制，不允许只是 UI disabled。

Team Overview：
展示团队可见的 redacted delivery health，而不是本地 raw log。包含项目列表、repository、health badge、test command、active/latest Run、Gate 状态、policy/budget/test/review rollup、成员角色、token/cost rollup、同步来源 local/remote/seed。这里要强调“团队视图只看脱敏摘要”。

Knowledge：
展示 Git Markdown Index、知识文档卡、source path、category、tags、轻量知识图谱、Run references。与工作台联动：当前 Run/Node 的 Knowledge Governance 检查在 Inspector 里展示，Knowledge 页用于深挖引用来源、score、heading path、content hash。

Agents：
分两块：基于知识的门禁审查（Knowledge-Grounded Gate Review）和 Coding Agent。门禁审查区包含 provider 选择、credential 表单、运行门禁审查按钮、review history、Gate Advisory、trace、token usage、cost source。Knowledge 是审查依据，当前 Gate、门禁条件和阶段产物是审查对象。Coding Agent 区包含 Run Coding Agent、managed worktree、permission relay、Approve once / Reject、runtime budget approval、tool timeline、diff preview、changed paths、bootstrap evidence、test evidence、Open worktree、Cancel、Delete worktree。Agents 页不是独立功能页，而是从 Inspector 的门禁审查 / Coding Agent 动作跳转过来的执行控制台。

Skills：
展示团队能力目录。每个 skill 卡片展示名称、描述、stage、enabled/disabled 状态。它说明团队有哪些标准化能力可用于 Run，但不能绕过 Gate、policy 或 evidence requirements。

MCP：
展示本机工具连接器。每个 MCP server 显示 name、command、permission、enabledLocally 状态和 Enable/Disable 操作。MCP 是本地工具能力入口，不应表现成云端集成市场；要强调权限和本地执行边界。

Tests：
展示测试计划与证据。包含测试包说明、执行本地测试按钮、进度/health bar、Test Evidence 列表。每条 evidence 显示 command、status、exit code、duration、redacted yes/no、stdout/stderr 摘要。测试失败、超时、跳过都要明确保存证据，并返回工作台影响 Gate 状态。

跨模块联动：
新建 Run 进入 Workbench；Gate 缺门禁审查结果时从 Inspector 跳到 Agents；执行测试后跳到 Tests；Knowledge Governance 引用可跳到 Knowledge；同步团队影响 Team Overview 和 Gate policy；Coding Agent 产生 diff/test/bootstrap evidence 后回写 Workbench Inspector；PR Draft 和 Acceptance Bundle 都从累积 evidence 生成。整体体验必须是“流程驱动”，不是几个孤立页面。
\`\`\`

**Result / notes**:
Second version. Covers all primary modules and the cross-module delivery flow.
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/pr-review.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: PR 审查就绪检查清单
category: review_checklist
ownerId: u-ling
tags: pr, review, gate, github-delivery
summary: PR 审查应绑定交付包、精确批准的提交、核实后的草稿 PR、证据和业务验收决定。
---

<a id="pr-review-readiness-checklist"></a>

# PR 审查就绪检查清单

拉取请求应关联设计、测试证据、审查决定和上线说明。

- 确认仅含元数据的 PR 交付包与被审查的编码来源一致。
- 确认交付意图绑定权威托管工作树、预期提交、仓库绑定、Run 版本、证据摘要和交付包摘要。
- 确认脱敏交付请求的精确修订版已有独立的签名 Web 审批。
- 确认已核实的远端分支提交等于批准的预期提交，匹配的拉取请求仍处于草稿（Draft）状态。
- 确认凭据、本地路径、原始输出、补丁和源码内容均未进入持久化证据。
- 业务验收可以引用草稿 PR 和完成证据，但不会合并、关闭、强制推送、删除分支或发布标签。
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/electron-demo-readiness.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: Electron 演示就绪检查清单
category: review_checklist
ownerId: u-erich
tags: electron, demo, smoke, local, github-delivery
summary: Electron 演示应证明 Desktop schema v26、生产权限边界、持久化运行时上下文与本地 MCP 审计恢复、受控 GitHub 交付以及凭据隔离。
---

<a id="electron-demo-readiness-checklist"></a>

# Electron 演示就绪检查清单

在使用桌面应用演示或验收前，先确认实际运行的是 Electron 链路。

- 使用 \`corepack pnpm dev:electron\` 启动应用。
- 确认窗口标题为 \`AI DevFlow Studio\` 或 \`ai-devflow-studio\`。
- 确认 Electron 启动了 \`apps/desktop\`，而非 \`default_app.asar\`。
- 确认目标桌面渲染进程监听 \`127.0.0.1:5173\`。
- 在信任演示结果前，清理 \`5173\` 上残留的 DevFlow 监听进程。
- 确认本地 SQLite 数据库报告 Desktop schema v26；运行时操作的纯元数据升级保留 v20 发件箱；迁移 v21 时不伪造检索索引行；拒绝未知的更新数据库结构版本。
- 运行打包试点版运行时探针，确认冷启动后已接受动作数仍精确为一，并保留各一条 started 和 succeeded 的本地 MCP 工具审计，绑定精确的安装修订版。
- 打开工作台并选择 Gate 节点，确认节点详情状态来自实时数据。
- 使用 \`corepack pnpm test:electron-smoke\` 自动验证 preload、主进程、SQLite 和本地执行行为。
- 对于 V1.5 GitHub 交付，从权威托管工作树和一个预期的已测试提交准备交付意图；绝不能信任渲染进程提交的来源、仓库、分支或提交数据。
- 确认独立的 Web Lead/Owner 通过签名会话批准精确的脱敏交付请求后，Electron 主进程才请求发布凭据。
- 确认 Electron 主进程不使用强制推送，且在业务验收前，权威 Run 已记录核实后的远端分支提交和一个匹配的草稿 PR。
- 验证修订（**Revise**）创建新的发布前修订版，并使原审批失效。
- 验证继续（**Resume**）延续同一次 \`recovery_required\` 尝试。
- 验证重试（**Retry**）仅在精确的前次尝试已被证明处于终态后才创建下一次尝试。
- 验证停止（**Stop**）停放精确的活动尝试，且不声称回滚了远端。
- 运行 \`corepack pnpm test:v15-github-delivery-packaged-smoke\`，覆盖打包应用的主进程/preload/渲染进程、本地模拟 API、本地裸仓库远端、崩溃/重启对账和凭据不落盘；不向外部 GitHub 写入。
- 确认 GitHub App 私钥留在 API，短期令牌只存在于 Electron 主进程内存中；不能进入渲染进程、SQLite、日志、证据或错误载荷。
- 确认 GitHub 交付和业务验收绝不能合并、强制推送、删除分支、发布标签，或以其他方式修改草稿 PR。
- 端口冲突或默认 Electron 欢迎页属于环境故障，必须在验收前解决。
- 本清单不授权付费模型冒烟测试；打包 GitHub 交付验证不发送模型提供方请求。
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/postgres-smoke-readiness.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: Postgres 冒烟测试就绪检查清单
category: review_checklist
ownerId: u-erich
tags: postgres, api, smoke, policy, github-delivery
summary: Postgres 冒烟测试应证明 Team schema v21、数据保留迁移、有界本地开发身份与原生编码摘要引擎、受控 GitHub 交付、运行时/记忆/协作投影、策略、同步与脱敏。
---

<a id="postgres-smoke-readiness-checklist"></a>

# Postgres 冒烟测试就绪检查清单

当 API、仓储层、迁移、策略、例外审批、同步、GitHub 交付或管理摘要代码变化时，使用本清单。

- 运行 Postgres 冒烟测试前，显式设置 \`DEVFLOW_DATABASE_URL\`。
- 证明可丢弃的新数据库达到 Team schema v21。
- 证明包含数据的 v11-to-v12 迁移完整保留仓库绑定、交付请求、审批、发布、恢复和审计数据。
- 证明失败的 v11-to-v12 迁移事务性回滚，显式重试后成功一次且不产生重复行。
- 证明包含数据的 v12-to-v13 迁移将每个旧版已签发凭据的契约版本保留为 \`0\`，\`provider_credential_expires_at\` 与 \`provider_expiry_observed_at\` 均为 NULL；因此在无法确认时拒绝放行，不伪造由提供方确认的过期时间。
- 证明 v13-to-v14 仅增加可空且有界的草稿 PR 提供方最早重试时间。
- 证明 v14-to-v15 增加可空的 \`source_publication_id\`，精确保留所有旧版凭据授权发布记录，并拒绝既无发布权限来源或同时有两个来源的行。
- 证明 v15-to-v16 创建空的 \`agent_runtime_summaries\` 和 \`agent_runtime_projection_audits\` 表，保留全部已有行，并拒绝未脱敏、版本不一致或终态无效的运行时摘要。
- 证明 v16-to-v17 创建空的 \`agent_memory_summaries\` 和 \`agent_memory_projection_audits\` 表，不包含本地内容或伪造的生命周期行。
- 证明 v17-to-v18 增加精确且独立的 \`quality_version\` 列与 \`(memory_id, head_version, quality_version)\` 复合审计标识；保留行使用预留版本 0 以便首次同步收敛，本地内容规则不变。
- 证明 v18-to-v19 创建空的 \`agent_coordination_summaries\` 和 \`agent_coordination_projection_audits\` 表，不伪造协作生命周期行。
- 证明 v19-to-v20 保留已有 GitHub 认证账号、接受 \`local-development\` 并拒绝所有未知认证提供方。
- 证明 v20-to-v21 保留已有编码摘要、接受 \`native\` 并继续拒绝所有未知编码引擎。
- 运行 \`DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:local-auth-postgres-smoke\`，在隔离的数据库结构中证明固定本地 Owner 登录、空团队概览、团队项目和预算写入、仅可复制一次的配对码，以及已配对桌面 Bearer 读取。
- 验证预置团队数据可经 API 仓储边界读取。
- 验证策略保存/读取和执行评估行为。
- 验证 Owner、Member 和存在利益冲突的 Lead 的例外审批请求被拒绝。
- 验证 Lead 例外审批接受后的审计行为。
- 验证过期策略版本被拒绝。
- 验证类似审批的同步摘要不能绕过 Gate 强制规则。
- 验证 Owner 可配置和撤销已核实的 GitHub App 仓库绑定，Member 或项目不匹配时不能操作。
- 验证脱敏交付请求保留系列/尝试/修订标识，且拒绝本地路径、原始输出、补丁、源码内容和凭据。
- 验证 Lead 或 Owner 的签名 Web 审批绑定精确的请求修订版；已配对桌面 Bearer 不能批准自身请求。
- 验证凭据授权的前置条件、过期时间、范围、领取者和绑定版本。GitHub App 私钥与签发令牌绝不能成为 Postgres 持久化证据。
- 验证 API 独立确认预期提交为远端分支提交后，才创建或对账一个草稿 PR。
- 验证已批准的后续尝试只能从同一系列紧邻的、草稿 PR 失败终态的前次尝试采用已核实发布证据，不增加凭据签发或推送。
- 验证撤销会阻断新的凭据授权，且重放/重启路径不会重复请求、发布、草稿 PR 或审计结果。
- 验证概览与交付请求响应保持脱敏，不暴露本地路径、原始日志、提示词、补丁、源码内容、私钥或令牌。
- 运行 \`DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:postgres-smoke\`，保留与精确候选版本绑定的结果。
- \`corepack pnpm verify\` 有意排除 Postgres 冒烟测试。
- 本清单不授权付费模型冒烟测试；Postgres 与 GitHub 交付持久化验证不需要模型提供方请求。
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/opencode-runtime-signoff.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: OpenCode 运行时验收检查清单
category: review_checklist
ownerId: u-erich
tags: opencode, coding-agent, smoke, provider
summary: 真实 OpenCode 运行时验收必须显式启动、由环境开关控制、记录权限审计并保护密钥。
---

<a id="opencode-runtime-signoff-checklist"></a>

# OpenCode 运行时验收检查清单

仅在发布契约明确要求验证真实 OpenCode 编码适配器，且已取得与候选版本绑定的单独授权后，才使用本清单。本清单本身不授予模型调用费用授权。

- 日常验证默认使用确定性模拟引擎。
- 确认本地已安装 OpenCode，且与待测适配器兼容。
- 在真实冒烟测试前运行 \`corepack pnpm --silent opencode:status\`，确认本地二进制/版本、默认模拟引擎状态、真实测试开关和模型配置状态，同时避免 pnpm 打印工作目录横幅。
- 明确设置 \`DEVFLOW_RUN_OPENCODE_SMOKE=1\`。
- 设置 \`DEVFLOW_CODING_ENGINE=opencode-http\`。
- 显式指定目标 Provider ID 和模型 ID。
- 对于 V1.4，设置 \`DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4\`；即使提供了正确的 Provider/模型/密钥三元组，缺少该选择器也必须在 OpenCode 启动前失败。
- 通过配置的环境变量设置 Provider API 密钥，绝不直接写入日志或文档。
- 对于 V1.4，运行 \`corepack pnpm --silent opencode:release-preflight\`；付费测试前必须取得其固定、无网络访问的解析配置成功摘要。
- 运行 \`corepack pnpm --silent test:opencode-smoke\`，避免 pnpm 打印本地候选路径。
- 确认测试启动 \`opencode serve\`、创建托管工作树、传递权限请求、记录脱敏差异、运行工作树测试，并清理临时测试状态。
- 确认权限请求对人可见，未回答的请求默认拒绝。
- 确认测试输出不打印 Provider 密钥。
- 将真实 OpenCode 冒烟测试排除在 \`corepack pnpm verify\` 和默认 CI 之外。
- 后续产品版本只有在自身发布契约明确要求，且已记录与候选版本绑定的单独授权时，才运行真实模型冒烟测试。
- V1.5 不要求也不授权再次进行付费模型冒烟测试。V1.4 付费测试记录继续作为不可变的 V1.4 证据保留。
`,
  },
  {
    sourcePath: 'docs/knowledge/checklists/v09-demo-readiness.md',
    updatedAt: '2026-06-20T08:00:00.000Z',
    markdown: `---
title: v0.9 演示就绪检查清单
category: review_checklist
ownerId: u-erich
tags: demo, opencode, observability, policy-aware-delivery
summary: v0.9 演示应证明策略感知交付、运行时可观测性，并如实说明真实 OpenCode 的能力边界。
---

<a id="v09-demo-readiness-checklist"></a>

# v0.9 演示就绪检查清单

展示 v0.9 真实运行时与可观测性能力前，使用本清单。

- 从 v0.8 用户指南和 v0.9 演示脚本开始。
- 运行 \`corepack pnpm release:status\`，确认仅剩明确保留的待发布事项。
- 运行 \`corepack pnpm opencode:status\`，确认本地 OpenCode 版本、默认模拟模式、真实测试开关和模型配置状态。
- \`corepack pnpm verify\` 继续使用确定性模拟引擎。
- 若要声称支持真实 OpenCode 行为，先显式设置真实调用环境变量并运行 \`corepack pnpm test:opencode-smoke\`。
- 在连贯流程中演示 Gate 强制规则、处理建议、基于知识的门禁审查、编码重试、测试和团队概览。
- 说明哪些证据来自模拟引擎，哪些来自真实 OpenCode。
- 确认团队摘要不展示 Provider 密钥、cwd、原始提示词、原始轨迹、原始日志和补丁。
- 不得声称该版本具备自动修复、MCP 运行时强制执行、RAG、打包、Windows Electron 冒烟测试或默认真实 OpenCode 验证。
`,
  },
  {
    sourcePath: 'docs/knowledge/adr/gate-governance.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: Gate 治理架构决策
category: adr
ownerId: u-erich
tags: gate, approval, governance
summary: Gate 是审查决策，必须引用证据以及审查者使用的规范。
---

<a id="gate-governance-adr"></a>

# Gate 治理架构决策

Gate 是审查决策，必须引用证据以及审查者使用的规范。
`,
  },
  {
    sourcePath: 'docs/knowledge/rules/mcp-skill-usage.md',
    updatedAt: '2026-06-16T08:00:00.000Z',
    markdown: `---
title: Skill 与 MCP 使用规则
category: mcp_rule
ownerId: u-erich
tags: skill, mcp, permission
summary: 使用工具时必须明确命令目的、权限范围和审计证据。
---

<a id="skill-and-mcp-usage-rules"></a>

# Skill 与 MCP 使用规则

使用工具时必须明确命令目的、权限范围和审计证据。
`,
  },
]

export const knowledgeIndex = indexKnowledgeSources(knowledgeSources)

export const knowledgeDocuments = knowledgeIndex.documents

export const knowledgeChunks = knowledgeIndex.chunks

export const knowledgeEntities: KnowledgeEntity[] = knowledgeIndex.entities

export const knowledgeRelations: KnowledgeRelation[] = knowledgeIndex.relations
