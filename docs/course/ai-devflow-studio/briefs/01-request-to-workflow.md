# Module 1: 一句话如何变成工作流

## Teaching Arc
- **Metaphor:** 地铁线路图。用户只说目的地，系统却要把旅程拆成站点、换乘闸门和一张不能跳站的线路图。
- **Opening hook:** 你在左侧新建一个 Run，看到的不是一个聊天框，而是一条从“澄清”一直通往“验收”的可追踪路线。
- **Key insight:** AI DevFlow Studio 的核心不是“让 AI 写代码”，而是把一句模糊需求编排成有顺序、有证据、有人工闸门的交付流程。
- **Why should I care?:** 以后让 AI 改流程时，你能明确说“新增一个 stage / node / gate”，而不是笼统地要求“加一步”。

## Code Snippets (pre-extracted)

File: `packages/shared/src/workflow.ts` (lines 93-102)
```ts
  const nodeIds = {
    clarify: `${input.runId}-clarify`,
    clarifyGate: `${input.runId}-clarify-gate`,
    design: `${input.runId}-design`,
    designGate: `${input.runId}-design-gate`,
    build: `${input.runId}-build`,
    test: `${input.runId}-test`,
    pr: `${input.runId}-pr`,
    accept: `${input.runId}-accept`,
  }
```

File: `packages/shared/src/workflow.ts` (lines 199-206)
```ts
  const edges: WorkflowEdge[] = [
    { id: `${input.runId}-edge-clarify-gate`, source: nodeIds.clarify, target: nodeIds.clarifyGate, kind: 'gate' },
    { id: `${input.runId}-edge-design`, source: nodeIds.clarifyGate, target: nodeIds.design, kind: 'normal' },
    { id: `${input.runId}-edge-design-gate`, source: nodeIds.design, target: nodeIds.designGate, kind: 'gate' },
    { id: `${input.runId}-edge-build`, source: nodeIds.designGate, target: nodeIds.build, kind: 'normal' },
    { id: `${input.runId}-edge-test`, source: nodeIds.build, target: nodeIds.test, kind: 'normal' },
    { id: `${input.runId}-edge-pr`, source: nodeIds.test, target: nodeIds.pr, kind: 'normal' },
    { id: `${input.runId}-edge-accept`, source: nodeIds.pr, target: nodeIds.accept, kind: 'gate' },
```

File: `apps/desktop/src/app/useDesktopActions.ts` (lines 833-844)
```ts
    if (desktopApi) {
      try {
        const persistedRun = await desktopApi.createRun(createInput)
        const nextState = await desktopApi.loadState()
        applyLocalExecutionState(nextState)
        setRuns((previousRuns) =>
          previousRuns.some((run) => run.id === persistedRun.id)
            ? previousRuns.map((run) => (run.id === persistedRun.id ? persistedRun : run))
            : [persistedRun, ...previousRuns],
        )
        setSelectedRunId(persistedRun.id)
        setSelectedNodeId(persistedRun.currentNodeId)
```

## Interactive Elements
- [x] **Code↔English translation:** Use the `nodeIds` snippet. Preserve every visible source character; HTML escaping is fine. Explain that each property creates one named stop scoped to the current Run.
- [x] **Quiz:** Three application questions at the end: (1) where to insert a security-review stop without allowing Build to skip it; (2) why a Gate is different from another AI agent; (3) what stale UI after Create Run suggests about reloading persisted state.
- [ ] **Group chat animation**
- [ ] **Data flow animation**
- [ ] **Drag-and-drop**
- [x] **Other:** Hero screenshot at `assets/devflow-workbench.png`; a horizontal route of Clarify → Gate → Design → Gate → Build → Test → Draft PR → Accept; pattern cards distinguishing Agent, Task, Gate, Evidence.

## Required Screens
1. Product hero: what the app does, why it is interesting, and the real workbench screenshot.
2. The subway-map metaphor grounded in the eight real node IDs (six product stages plus two explicit Gates).
3. Code↔English translation of the exact `nodeIds` snippet.
4. Trace the “Create Run” click using the persisted-run snippet and three numbered cards: save, reload authoritative state, select current node.
5. End-of-module scenario quiz with three questions.

## Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks; Multiple-Choice Quizzes; Pattern/Feature Cards; Flow Diagrams; Glossary Tooltips.
- `references/design-system.md` → Color Palette; Typography; Spacing & Layout; Module Structure; Responsive Breakpoints.
- `references/content-philosophy.md` → entire file.
- `references/gotchas.md` → entire file.

## Connections
- **Previous module:** None; open from the familiar visual workbench and one concrete action.
- **Next module:** 桌面端的五位角色 — it will reveal who receives `desktopApi.createRun` and where authority lives.
- **Tone/style notes:** Chinese, smart-friend tone, zero assumed CS knowledge. Teal accent. Module 1 uses `var(--color-bg-warm)`. Technical terms must get first-use tooltips, including Run, workflow, node, edge, Gate, artifact, desktop API, persisted state. Use only existing course CSS classes and no inline `<style>`/`<script>`.
