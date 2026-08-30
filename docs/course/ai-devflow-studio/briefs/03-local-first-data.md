# Module 3: 数据的两条旅程

## Teaching Arc
- **Metaphor:** 机场海关。行李箱里的原件留在本地，只有经过检查、遮住敏感信息的申报单才能进入团队系统；如果网络断了，申报单先进入可靠的待发队列。
- **Opening hook:** 同一个 Run 同时服务两种需求：桌面端要保留足够详细的证据，团队 Web 又只应该看到安全、可协作的摘要。
- **Key insight:** “本地优先”不是“永不联网”，而是先明确哪份数据是本地权威，再通过脱敏和 durable outbox 有控制地同步副本。
- **Why should I care?:** 你能要求 AI 把原始日志留在本机、把摘要同步给团队，并判断“页面没更新”究竟是存储、脱敏、排队还是远端接收的问题。

## Code Snippets (pre-extracted)

File: `apps/desktop/electron/local-store-workflow.ts` (lines 58-67)
```ts
function writeWorkflowRunEnvelope(db: Database, run: WorkflowRun): void {
  const envelope = workflowRunEnvelope(run)
  db.run(
    `
    insert into workflow_runs (id, json, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [run.id, JSON.stringify(envelope), run.createdAt, run.updatedAt],
  )
```

File: `packages/shared/src/redaction.ts` (lines 135-140)
```ts
  for (const { label, pattern } of secretPatterns) {
    value = value.replace(pattern, () => {
      matches.push(label)
      replacementCount += 1
      return `[REDACTED:${label}]`
    })
```

File: `packages/shared/src/remote-sync-outbox.ts` (lines 125-132)
```ts
  return {
    id: input.id,
    ...metadata,
    idempotencyKey: createRemoteSyncIdempotencyKey(metadata),
    status: 'pending',
    generation: 1,
    attemptCount: 0,
    nextAttemptAt: input.createdAt,
```

## Interactive Elements
- [x] **Code↔English translation:** Use the redaction loop; six code lines must visibly match the source exactly. Translate pattern match → count → canonical marker.
- [x] **Quiz:** Three application questions: (1) raw test log contains a token—what may sync; (2) network drops after request is accepted—why the idempotency key matters; (3) local Run exists but Web is stale—what chain to inspect in order.
- [ ] **Group chat animation**
- [x] **Data flow animation:** Required course flow. Actors: Local SQLite → Redaction → Outbox → API → Team Postgres/Web. Steps: store private evidence locally; create redacted summary; enqueue idempotent operation; transmit; persist team-safe record; render team view. IDs must be globally unique: `flow-module3-local`, `flow-module3-redaction`, `flow-module3-outbox`, `flow-module3-api`, `flow-module3-team`; `data-steps` uses matching suffixes without `flow-`. Avoid apostrophes/single quotes inside labels.
- [ ] **Drag-and-drop**
- [x] **Other:** Layer toggle contrasting “本地原件” and “团队摘要.” Wire buttons exactly as `showLayer('module3-layer-local', this)` and `showLayer('module3-layer-team', this)`; layer IDs must match. Use cards for retryable/recovery/terminal failure classes.

## Required Screens
1. Customs metaphor with side-by-side local/private and team/redacted cards.
2. Layer toggle: what fields/evidence stay local versus what crosses the boundary.
3. Code↔English translation of exact redaction snippet, with aggressive tooltips.
4. Step-by-step animated data flow from SQLite to the team Web.
5. Durable outbox explanation using the exact idempotency snippet and three failure-disposition cards.
6. End-of-module scenario quiz with three questions.

## Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks; Multiple-Choice Quizzes; Message Flow / Data Flow Animation; Layer Toggle Demo; Pattern/Feature Cards; Glossary Tooltips.
- `references/design-system.md` → Color Palette; Typography; Spacing & Layout; Animations & Transitions; Module Structure; Responsive Breakpoints.
- `references/content-philosophy.md` → entire file.
- `references/gotchas.md` → entire file.

## Connections
- **Previous module:** 桌面端的五位角色 — SQLite was introduced as the local archive and Main as its owner.
- **Next module:** 给 Agent 装上护栏 — it asks what an agent may do inside that local authority boundary.
- **Tone/style notes:** Chinese, smart-friend tone. Teal accent. Module 3 uses `var(--color-bg-warm)`. Tooltip first use of local-first, authoritative copy, SQLite, raw evidence, redaction, secret, durable outbox, API, Postgres, idempotency key, retryable, terminal. No styles/scripts; use only existing classes.
