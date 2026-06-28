# Workflow Node Semantics

This document defines how DevFlow Studio should describe Workflow Nodes and their related resources
in product language and UI. It is the source of truth for Board card summaries and Inspector
information architecture.

## Core Principle

A Workflow Node is the main flow object. Artifact, Evidence, Trace, and Decision are related
resources attached to a Run or Node; they are not separate Board nodes.

Storage and contracts can stay uniform, but UI language should change by Node type:

- Data layer: keep durable resources linked by `runId` and `nodeId`.
- Board layer: show a compact, type-aware summary for the Node.
- Inspector layer: expand the details, actions, blockers, and evidence chain for the selected Node.

## Related Resource Terms

| Term | Product Meaning | Typical Examples |
|---|---|---|
| Artifact | A durable work product or report produced by work on a Run or Node. | Raw Request, Clarification Brief, Design Brief, Coding Diff, PR Draft, Acceptance Bundle, Gate Report |
| Evidence | Durable proof used to support a Gate or delivery decision. | Passing test evidence, Knowledge Review result, policy check, budget approval, redacted team summary |
| Trace | Time-ordered execution or audit history explaining how something happened. | Agent events, tool calls, permission relay, runtime steps, cleanup events |
| Decision | A formal outcome that changes whether the Run may continue. | Gate approved, Gate blocked, override accepted, override rejected, budget approved |

Evidence can reference Artifacts, Trace, and Decisions. A Gate Decision may also have a durable
Artifact form, such as a Gate Report. In the UI, prefer the business name `结论`, `审批`, `阻断`,
`Override`, or `Gate Report` instead of the generic label `产物` when the user is looking at a Gate.

## Board Summary Rules

Board summaries should translate technical resources into the language of the selected Node type.
Do not force every Node card to show the same `产物 / 证据 / 轨迹` set.

| Node Product Type | Current Domain Shape | Main User Question | Preferred Card Summary |
|---|---|---|---|
| Clarification Task | `kind=agent`, `stage=clarify` | What did the clarification step produce? | `产物` / `轨迹` / `Gate影响` |
| Design Review | `kind=agent`, `stage=design` when used as review | What did review find and cite? | `Review` / `引用` / `证据` |
| Gate | `kind=gate` | Can the Run continue, and why or why not? | `条件` / `证据` / `结论` |
| Runtime Build | `kind=task` or build-stage runtime task | What changed and how was it executed? | `Diff` / `测试` / `轨迹` |
| Test | `kind=test` | What test result is available? | `测试结果` / `证据` / `轨迹` |
| PR Delivery | `kind=pr` | What will be handed off to code review? | `PR Draft` / `证据` / `Handoff` |
| Acceptance | `kind=acceptance` | Is the delivery accepted by the business flow? | `验收包` / `证据` / `结论` |

When a preferred summary item has no data and is not central to the Node type, the card may hide or
de-emphasize it. When the item is central, show the empty state clearly.

Examples:

- A Gate with no required review should still show a `条件` state.
- A Test node with no test evidence should show missing `测试结果` or `证据`.
- A Runtime Build node can show `Diff 0` if no implementation artifact exists yet.
- A Clarification Task does not need to emphasize `证据 0` unless a Gate requires it.

## Gate Semantics

Gate nodes are decision points, not execution tasks. A Gate can still produce an Artifact, but the
important product object is the decision conclusion.

Gate cards should answer:

1. What conditions are required?
2. Which evidence supports or blocks approval?
3. What is the current conclusion?
4. Is there an override, and who is allowed to use it?

Recommended Gate summary labels:

- `条件 3/4`
- `证据 2`
- `结论 blocked`
- `审批 approved`
- `Override pending`

Avoid a Gate card that only says `产物 1 / 证据 2 / 轨迹 3`; that hides the most important meaning of
the Gate. If a Gate Report exists, show it as `结论` or `Gate Report`, not as a generic work artifact.

## Inspector Rules

Inspector tabs should follow Node semantics rather than a single universal layout.

| Node Product Type | Recommended Inspector Focus |
|---|---|
| Task | Status, produced Artifacts, Trace, Gate impact |
| Gate | Status, Gate conditions, Evidence, Decision, Remediation |
| Review | Status, Knowledge Review, References, Evidence, Trace |
| Runtime Build | Status, Coding Agent state, Diff, Test Evidence, Trace |
| Test | Status, test command, Test Evidence, failure details, rerun action |
| PR Delivery | Status, PR Draft, accumulated Evidence, Handoff |
| Acceptance | Status, Acceptance Bundle, Evidence, final Decision |

The Board should stay compact. Detailed blockers, policy rules, raw trace, and remediation actions
belong in Inspector.

## Implementation Boundary

This is a product and UI semantics document. It does not require changing `WorkflowNode` itself.

Preferred implementation direction:

- Keep `WorkflowNode` as a simple flow unit.
- Keep related resources in separate collections or tables linked by `runId` and `nodeId`.
- Add renderer view-model logic that maps Node type and related resources into card summaries.
- Keep shared contracts, IPC payloads, and persistence schemas stable unless a product requirement
cannot be expressed with the existing links.

