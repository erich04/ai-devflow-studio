# Module 2: 桌面端的五位角色

## Teaching Arc
- **Metaphor:** 剧院。Renderer 是观众看见的舞台，Preload 是只传指定口令的舞台监督，Electron Main 是后台总控，共享包是剧本规则，SQLite 是保存演出记录的档案室。
- **Opening hook:** 点击“新建 Run”后，React 界面没有资格直接碰文件、数据库或 Node.js；它必须把请求交给后台总控。
- **Key insight:** 安全边界不是靠团队“记得小心”，而是由 Electron 的进程分工和一个很窄的 `contextBridge` 接口写进结构里。
- **Why should I care?:** 当功能坏掉或 AI 把逻辑放错层时，你能判断该查 Renderer、IPC、Main、共享领域规则还是 SQLite，而不是在整个仓库里乱搜。

## Code Snippets (pre-extracted)

File: `apps/desktop/electron/preload.ts` (lines 10-18)
```ts
const desktopApi: DevFlowDesktopApi = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke(ipcChannels.loadState),
  loadDesktopPairing: () => ipcRenderer.invoke(ipcChannels.loadDesktopPairing),
  pairDesktop: (input) => ipcRenderer.invoke(ipcChannels.pairDesktop, input),
  loadRemoteSnapshot: (input) => ipcRenderer.invoke(ipcChannels.loadRemoteSnapshot, input),
  listWorkRequests: (input) => ipcRenderer.invoke(ipcChannels.listWorkRequests, input),
  materializeWorkRequest: (input) =>
    ipcRenderer.invoke(ipcChannels.materializeWorkRequest, input),
```

File: `apps/desktop/electron/preload.ts` (line 112)
```ts
contextBridge.exposeInMainWorld('aiDevFlowDesktop', desktopApi)
```

File: `apps/desktop/electron/main.ts` (lines 2131-2140)
```ts
  ipcMain.handle(ipcChannels.createRun, async (_, payload: unknown) => {
    const input = parseCreateRunInput(payload)
    const created = createWorkflowRunFromRequest({
      ...input,
      runId: `run-${randomUUID()}`,
      now: new Date().toISOString(),
    })
    const store = await getStore()
    const result = await store.createWorkflow({
      run: created.run,
```

## Interactive Elements
- [x] **Code↔English translation:** Use `preload.ts` lines 10-18. Explain `invoke` as calling a named backstage intercom channel and waiting for one reply.
- [x] **Quiz:** Three architecture/debugging questions: (1) a new “read local Git status” feature belongs behind which boundary; (2) UI says Create succeeded but nothing survives restart—where to inspect first; (3) why exposing all of `ipcRenderer` would weaken the design.
- [x] **Group chat animation:** Required course chat. Actors and order: Renderer asks Preload to create a Run → Preload forwards only the named channel → Electron Main validates payload → Shared workflow returns nodes/edges → SQLite confirms persistence → Main returns the saved Run → Renderer reloads and paints it. Unique container ID `chat-module2`; buttons use `.chat-next-btn`, `.chat-all-btn`, `.chat-reset-btn` only.
- [ ] **Data flow animation**
- [ ] **Drag-and-drop**
- [x] **Other:** Visual file tree for `apps/desktop/src`, `apps/desktop/electron`, `packages/shared`, local SQLite; clickable architecture diagram with five actor cards.

## Required Screens
1. Theater metaphor and five actor cards.
2. Annotated file tree showing where each responsibility lives.
3. Group chat animation with seven short messages and clear personalities.
4. Code↔English translation of exact Preload snippet plus the one-line bridge exposure as a badge/callout.
5. Clickable architecture diagram and the exact Main handler as a compact source panel or second translation.
6. End-of-module scenario quiz with three questions.

## Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks; Multiple-Choice Quizzes; Group Chat Animation; Interactive Architecture Diagram; Visual File Tree; Glossary Tooltips.
- `references/design-system.md` → Color Palette; Typography; Spacing & Layout; Module Structure; Responsive Breakpoints.
- `references/content-philosophy.md` → entire file.
- `references/gotchas.md` → entire file.

## Connections
- **Previous module:** 一句话如何变成工作流 — it introduced the Create Run action and the workflow graph.
- **Next module:** 数据的两条旅程 — it follows the saved Run into private local storage and redacted team sync.
- **Tone/style notes:** Chinese, smart-friend tone. Teal accent, stable actor colors across chat/diagram: Renderer actor-1, Preload actor-4, Main actor-2, Shared actor-3, SQLite actor-5. Module 2 uses `var(--color-bg)`. Tooltip first use of React, Renderer, Preload, Electron Main, Node.js, IPC, contextBridge, shared package, SQLite, process boundary, payload. Do not add styles/scripts.
