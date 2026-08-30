# Module 4: 给 Agent 装上护栏

## Teaching Arc
- **Metaphor:** 登山队出发许可。队员拿到指定路线、有效证件、氧气与时间预算，还要按检查点回报；“有能力爬山”不等于“可以走任何路线”。
- **Opening hook:** Coding Agent 不是在你的仓库里无限自由地“自己想办法”，它运行在一个绑定 Run、Node、策略版本和受管工作区的任务合同里。
- **Key insight:** 可靠 Agent = 明确 scope + 可核对 authority + 硬 bounds + 短时 capability + 可恢复 checkpoint，而不是更长的 prompt。
- **Why should I care?:** 你能把“让 Agent 安全一点”改写成可实现的要求：限制资源范围、工具权限、并发、成本、超时和停止原因。

## Code Snippets (pre-extracted)

File: `packages/shared/src/agent-runtime.ts` (lines 45-53)
```ts
export type AgentRuntimeBounds = {
  maxSteps: number
  maxWallTimeMs: number
  maxToolCalls: number
  maxToolResultBytes: number
  maxTrajectoryMetadataBytes: number
  maxCheckpointBytes: number
  maxTokens: number
  maxCostUsd: number
}
```

File: `apps/desktop/electron/agent-coordination-plan.ts` (lines 54-68)
```ts
const coordinationBounds: CoordinationBounds = {
  maxSpecialists: 3,
  maxTaskNodes: 3,
  maxDependencyEdges: 2,
  maxDelegationDepth: 1,
  maxParallelSpecialists: 2,
  maxAcceptedHandoffs: 4,
  maxSpecialistRetries: 1,
  maxHandoffSummaryBytes: 4_096,
  maxSteps: supervisorBounds.maxSteps,
  maxWallTimeMs: supervisorBounds.maxWallTimeMs,
  maxToolCalls: supervisorBounds.maxToolCalls,
  maxTokens: supervisorBounds.maxTokens,
  maxCostUsd: supervisorBounds.maxCostUsd,
}
```

File: `apps/desktop/electron/native-tool-registry.ts` (lines 48-61)
```ts
export type NativeToolCapabilityGrantRecord = {
  stateVersion: 1
  id: string
  runtimeId: string
  capabilityId: string
  capabilityVersion: number
  requestDigest: string
  permissionClass: NativeToolPermissionClass
  resourceKind: NativeToolResourceScope['kind']
  resourceId: string
  status: 'active' | 'consumed' | 'denied' | 'expired' | 'cancelled'
  grantedAt: string
  expiresAt: string
  settledAt: string | null
}
```

## Interactive Elements
- [x] **Code↔English translation:** Use `AgentRuntimeBounds` exactly. Translate each hard maximum into “how the expedition is stopped before it runs away.”
- [x] **Quiz:** Three end scenarios: (1) a tool call targets another workspace despite remaining token budget; (2) a specialist times out waiting for permission; (3) an AI proposes recursive delegation because work is large. Answers must apply scope/deny-by-default/bounded graph principles.
- [ ] **Group chat animation**
- [ ] **Data flow animation**
- [x] **Drag-and-drop:** Four chips `Scope`, `Authority`, `Bounds`, `Capability Grant` matched to route boundary, exact Run/Node/version, resource budget, and short-lived tool permission. Unique ID `dnd-module4`; buttons must call `checkDnD('dnd-module4')` and `resetDnD('dnd-module4')` with the container ID.
- [x] **Other:** Clickable architecture diagram: Supervisor → two read specialists in parallel → one bounded implementer → checkpoint/evaluation. Permission badges for read, managed workspace edit, saved test, deterministic evaluation. Pattern cards for explicit stop reasons.

## Required Screens
1. Mountain-expedition metaphor grounded in Scope / Authority / Bounds / Capability / Checkpoint.
2. Code↔English translation of exact bounds type.
3. Drag-and-drop exercise matching the four guardrails to their jobs.
4. Clickable bounded-coordination diagram and the real limits (3 specialists, 2 parallel, depth 1, one retry).
5. Capability-grant lifecycle and explicit stop-reason cards.
6. End-of-module scenario quiz with three questions.

## Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks; Multiple-Choice Quizzes; Drag-and-Drop Matching; Interactive Architecture Diagram; Permission/Config Badges; Pattern/Feature Cards; Glossary Tooltips.
- `references/design-system.md` → Color Palette; Typography; Spacing & Layout; Module Structure; Responsive Breakpoints.
- `references/content-philosophy.md` → entire file.
- `references/gotchas.md` → entire file.

## Connections
- **Previous module:** 数据的两条旅程 — it established local authority and the boundary around private evidence.
- **Next module:** 为什么 Gate 不肯放行 — it shows that even a completed Agent cannot move the workflow without correctly scoped evidence.
- **Tone/style notes:** Chinese, smart-friend tone. Teal accent. Module 4 uses `var(--color-bg)`. Tooltip first use of Agent runtime, scope, authority, version, bound, capability grant, digest, token, checkpoint, delegation depth, supervisor, specialist, permission. No custom styles/scripts.
