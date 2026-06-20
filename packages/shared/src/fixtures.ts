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
        title: '方案澄清',
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
        title: '澄清 Gate',
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
        title: '架构 Gate',
        subtitle: 'Lead 审批后进入实现',
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
    title: '澄清结果',
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
    message: '等待 Lead 审批架构 Gate。',
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
- Do not add live opencode smoke to \`corepack pnpm verify\` until the project intentionally promotes it to release validation.
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
