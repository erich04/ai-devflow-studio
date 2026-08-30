# Module 5: 为什么 Gate 不肯放行

## Teaching Arc
- **Metaphor:** 机场登机口。手里有一张“看起来像登机牌”的纸还不够；姓名、航班、时间、状态和登机口都必须与当前旅程相符。
- **Opening hook:** AI 说“测试通过了”并不会让流程自动前进；系统只信属于当前 Run、当前 Node、最新版本且状态终结的结构化证据。
- **Key insight:** Gate 做的是 fail-closed 状态转换：缺证据、证据过期、证据作用域不匹配或最新版失败，都会明确给出 blocker，而不是猜测后继续。
- **Why should I care?:** 当按钮灰掉或流程卡住时，你能读 blocker 找缺失的不变量，也能要求 AI 修复证据链，而不是绕过检查。

## Code Snippets (pre-extracted)

File: `packages/shared/src/workflow-transition.ts` (lines 96-107)
```ts
export function evaluateWorkflowCommand(input: EvaluateWorkflowCommandInput): WorkflowCommandDecision {
  const command = input.command
  const blockers = baseBlockers(input.run, command)
  if (blockers.length > 0) {
    return { allowed: false, blockers }
  }

  const node = input.run.nodes.find((candidate) => candidate.id === command.nodeId)!
  const invariantBlocker = evaluateCurrentNodeInvariant(input.run, node)
  if (invariantBlocker) {
    return { allowed: false, blockers: [invariantBlocker] }
  }
```

File: `packages/shared/src/workflow-transition.ts` (lines 199-213)
```ts
    const testEvidence = input.evidence.testEvidence.find(
      (candidate) => candidate.id === command.evidenceId,
    )
    if (!testEvidence) {
      return blocked('test_evidence_missing', `Test evidence not found: ${command.evidenceId}`)
    }
    if (
      testEvidence.runId !== input.run.id ||
      testEvidence.projectId !== input.run.projectId ||
      testEvidence.nodeId !== node.id
    ) {
      return blocked('evidence_scope_mismatch', 'Test evidence does not belong to the current test node')
    }
    if (testEvidence.status === 'running') {
      return blocked('test_result_not_terminal', 'A running test cannot complete a workflow transition')
```

File: `packages/shared/src/workflow-transition.ts` (lines 644-659)
```ts
  if (!latestTest) {
    return [blocker('test_evidence_missing', 'Test evidence for the workflow test node is required')]
  }
  if (latestTest.status !== 'passed') {
    return [blocker('latest_test_not_passed', 'The latest matching test evidence must be passing')]
  }
  const hasMatchingTestReport = input.evidence.artifacts.some(
    (artifact) =>
      artifact.id === `artifact-${latestTest.id}` &&
      artifact.runId === input.run.id &&
      artifact.nodeId === testNode?.id &&
      artifact.kind === 'test_report' &&
      testNode?.artifactIds.includes(artifact.id),
  )
  if (!hasMatchingTestReport) {
    return [blocker('test_report_missing', 'The latest passing test report must be attached')]
```

## Interactive Elements
- [x] **Code↔English translation:** Use lines 96-107 exactly. Explain the two layers: universal blockers first, current-node invariant second; any one blocker closes the gate.
- [x] **Quiz:** Three debugging scenarios: (1) an older test passed but the newest failed; (2) a passed Test Evidence belongs to another Run; (3) the test is passed but matching report artifact is absent. Each answer chooses the correct blocker/recovery, not a filename.
- [ ] **Group chat animation**
- [ ] **Data flow animation**
- [ ] **Drag-and-drop**
- [x] **Other:** Clickable architecture diagram or evidence inspection panel with cards for Run identity, Project identity, Node identity, terminal status, latest test, attached report. A visual “Gate opens only if every seal matches” chain. Do not use a fabricated code bug.

## Required Screens
1. Boarding-gate metaphor and the difference between a claim and evidence.
2. Visual blocker pipeline: base blockers → node invariant → evidence scope → evidence status → next-node invariant.
3. Code↔English translation of the exact command evaluator.
4. Clickable evidence inspection panel grounded in exact test-evidence checks.
5. “Latest beats any” and report attachment callouts, using source-backed blocker cards.
6. End-of-module debugging quiz with three questions.

## Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks; Multiple-Choice Quizzes; Interactive Architecture Diagram; Callout Boxes; Pattern/Feature Cards; Glossary Tooltips.
- `references/design-system.md` → Color Palette; Typography; Spacing & Layout; Module Structure; Responsive Breakpoints.
- `references/content-philosophy.md` → entire file.
- `references/gotchas.md` → entire file.

## Connections
- **Previous module:** 给 Agent 装上护栏 — it bounded what an Agent could attempt.
- **Next module:** 一枚可信 Draft PR 的诞生 — it assembles coding, diff, test and approval evidence into an externally published result.
- **Tone/style notes:** Chinese, smart-friend tone. Teal accent. Module 5 uses `var(--color-bg-warm)`. Tooltip first use of Gate, fail-closed, state transition, command, blocker, invariant, evidence scope, terminal status, Test Evidence, artifact, latest test. No custom styles/scripts.
