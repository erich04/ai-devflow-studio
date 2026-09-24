# Populated, full-window README screenshots — September 24, 2026

These are direct screenshots of the current application, with a populated Payments API demonstration.
Every image preserves the complete application viewport and navigation. Some views scroll the
existing reader or page to its relevant content. No image is an element crop, a composited mockup,
or an AI-generated product design. Click the images for full resolution.

The first four images were captured at [`98985a5`](https://github.com/erich04/ai-devflow-studio/commit/98985a50a19b1c9ae61f27b137bee58e0197444d).
The eight additional stage/control-console images were captured at
[`bea4384`](https://github.com/erich04/ai-devflow-studio/commit/bea4384ebe800f63d33d185f525a862ed7f6a062).
Both checkouts have unchanged application code from [`9895c34`](https://github.com/erich04/ai-devflow-studio/commit/9895c34cc4512a24c2ed9947f57e3dd2b829f64b),
the source used for the Desktop production build. The [manifest](manifest.json) records source
commits, capture dimensions, hashes, and fixture scope.

| Image | Full viewport | What is visible |
| --- | --- | --- |
| [Desktop workbench](desktop-workbench.png) | 1920 × 1280 | Four completed stages, PR delivery as the current step, three passing test-result cards, token/cost estimates, and a populated conversation with evidence links. |
| [Workflow overview](desktop-workflow-overview.png) | 2560 × 1600 | All six stage columns, Task/Gate/Test/Delivery/Acceptance cards, completion colors, artifact/trace counts, test results, and the independent conversation pane. |
| [Design Gate review](desktop-gate-review.png) | 1920 × 1280 | Another Run awaiting its design Gate, partial stage progress, readiness counts, policy/review checks, the explicit approval control, and a discussion of design risks. |
| [Clarification](desktop-clarification.png) | 1920 × 1280 | Original request, expanded goals, acceptance criteria, non-goals, completed-stage navigation, and the saved delivery conversation. |
| [Design](desktop-design.png) | 1920 × 1280 | Idempotency design with component responsibilities, database/cache tradeoffs, test plan, and release-order questions beside the review conversation. |
| [Implementation](desktop-implementation.png) | 1920 × 1280 | Changed-file table and the actual sample repository's Git patch, with stage progress and test/delivery discussion. |
| [PR preparation](desktop-pr-preparation.png) | 1920 × 1280 | An authored PR-material preview: changed files, actual sample-test results, and unchecked delivery prerequisites. No real PR was published. |
| [Web team overview](web-team-overview.png) | 1920 × 1200 | Four team members, estimated project cost, several Runs in different stages, and the three redacted test summaries. |
| [Web work requests](web-work-requests.png) | 1920 × 1080 | Three saved requests, a filled but unsent fourth request, project/Run selection, and Desktop pairing controls. |
| [Web evidence and review](web-evidence-review.png) | 1920 × 1200 | Delivery metrics, all eight workflow nodes, 38% completion, review summary, and an unsent human decision comment. |
| [Web budget governance](web-budget-governance.png) | 1920 × 1200 | Saved monthly limit and warning threshold, illustrative spend, two demo approvals, and a filled approval draft. |
| [Web team policy](web-team-policy.png) | 1920 × 1600 | Saved policy v2, built-in Recommended rule actions, minimum requirements, repair guidance, and effective project policy. |

All captures use the dark theme and preserve the complete application viewport. Content can be
scrolled within the application's existing panes; the workflow overview scrolls the node reader to
the evidence section. The Web review capture scrolls the page to the delivery metrics and evidence
chain while retaining the full viewport and persistent navigation. The stage gallery expands the
artifact's existing disclosure controls. The previous empty Desktop crops and sparse Web capture
were replaced. There are now seven Electron and five Web screenshots.

## Demonstration data

The Desktop uses a disposable Git repository, separate SQLite database, and isolated data-profile
registry. Its records were inserted through the production LocalStore API as explicit sample
history, then read by the unmodified Electron application:

- **Health API:** clarification, design, implementation, and testing are illustrated as complete;
  the current step is preparing PR delivery. Three test-evidence records contain actual output
  from 14 passing tests in the small sample repository.
- **Payment idempotency:** the design is ready for review; the human Gate remains unapproved.
- **Refund audit:** the Run is at implementation.
- **Reconciliation export:** the Run is at design.

The first batch has 15 artifacts; the stage gallery adds a PR-material preview for a total of 16.
There are 3 review records, 7 stage-usage records, and 2 saved conversations. Workflow
statuses, prior approvals, design/review prose, usage estimates, and assistant replies are authored
fixtures for demonstrating existing UI. They are not evidence of live model execution, real
spending, or completed production delivery. Conversation notices identify the example replies.
The sample Health API tests do not establish production readiness; the conversation explicitly
identifies the design's unimplemented timeout requirement. The implementation image includes the
actual `git diff --cached` of those sample files. The PR preview remains authored demonstration
content; it has no approved Delivery Intent and is not a publishable, commit-bound delivery package.

The Desktop remains in local, unpaired mode, as shown in its header. Sample sync-outbox entries
created while importing history were removed only from this disposable fixture database. There
is no claim that this capture exercised Desktop pairing or end-to-end synchronization.

Web runs the current Next.js application against the API's explicit in-memory demo repository.
For the first overview image, the four sample Run summaries, three test summaries, and three review
summaries were uploaded through normal authenticated API endpoints using an isolated demo identity.
For the additional Web images, a separate launcher adds complete eight-node Run graphs, artifact
summaries, events, and illustrative usage to the in-memory seed arrays before starting the unchanged
API server. Test and review summaries still use the normal sync endpoints. This demonstrates the
Web renderer with populated history; it does not establish full-history Desktop sync coverage.

Normal API endpoints create three Work Requests, a $200 monthly/$150 warning budget policy, and
two bounded demo approvals ($10 and $5). The Web editor then saves its built-in Recommended policy
as v2. These records exist only in the isolated demo API; no approval funds or invokes a real model.
The fourth request, review comment, and $8 approval form are unsent drafts. The policy screenshot is
later than the review screenshot, which still uses the default policy. Web also includes the original
`run-health-001` example and its estimated usage. Displayed identities belong to the demo repository,
not real GitHub OAuth logins. The current settings shell displays `NO RUN SELECTED`/`Waiting for sync`
because settings does not load a selected Run; the budget and policy records shown are populated.

No existing user workspace/profile, paid-provider call, production record, or real GitHub delivery
was used. No application source, DOM text, CSS, or screenshot pixels were changed for presentation.
The Next.js development indicator was hidden using its own **Preferences → Hide** control.

## Capture procedure

1. Install the pinned dependencies and build Desktop with
   `corepack pnpm --filter @ai-devflow/desktop build`.
2. Use a disposable committed Git repository and separate `DEVFLOW_USER_DATA_DIR` and
   `DEVFLOW_DATA_PROFILE_REGISTRY_PATH` paths. Import the sample history described above into
   that profile with `createLocalStore`; create valid workflow shapes with
   `createWorkflowRunFromRequest`. Use the LocalStore artifact, review, usage, test-evidence,
   and conversation methods. Do not use a personal profile for demonstration seeding.
3. Run the three sample-project test commands and preserve their stdout, exit status, and
   duration in `TestEvidence`. Keep invented history and actually executed checks distinct.
4. Launch the built Electron app with demo/fake runtimes enabled. Use its real stage controls,
   conversation Tabs, reader tabs, and scroll panes to select the illustrated views.
5. Start an isolated API with `DEVFLOW_ENABLE_DEMO_DATA=true` and `DEV_AUTH_ENABLED=true`, with
   database connection variables unset. Start Web with the same demo flag and that API URL.
   For the first overview, upload allowlisted sample Run/test/review summaries. For the stage
   gallery, initialize complete demonstration graphs in the process's fixture arrays before server
   startup, then upload `/api/sync/test-evidence-summary` and `/api/sync/agent-review-summary`.
   Preserve this distinction instead of treating seeded graphs as a sync test.
6. Populate `/api/team/projects/p-payments/work-requests`, `/api/runtime/budget-policy`, and
   `/api/runtime/budget-approvals` with the bounded examples above. Browse the workbench, team,
   budget, and policy views. Save Recommended policy through its preview/confirm UI. Use the
   product's theme selector and hide the development indicator through its own preferences.
7. Attach Playwright CLI to Electron over CDP and use its Chromium session for Web. Set the
   viewport dimensions above and capture the viewport without an element target or clipping.
   Inspect every PNG before replacing the documentation assets.

## Verification scope

The Desktop production build and the previous README refresh's seven documentation/UI test files
passed (52 tests). Four README/guide test files were rerun for this image refresh (33 tests passed). The screenshots
were inspected at full-window dimensions; hashes and Markdown image links were checked separately.
GitHub Markdown rendering was also checked: all 12 images and three disclosure galleries render.
The 14 additional sample-project tests are demonstration evidence, not DevFlow's regression suite.

The existing conversation Electron smoke script still has its previously recorded obsolete
`节点详情` Tab assertion; this screenshot refresh does not report that script as passing. See
[navigation validation](../../../validation/workflow-navigation-20260924.md) for the current split
reader layout. These images are not a full release signoff or a live-provider acceptance run.
