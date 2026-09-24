# Populated, full-window README screenshots — September 24, 2026

These are direct screenshots of the current application, with a populated Payments API demonstration.
Every image includes the application's header, navigation, and content area. No image is an element
crop, a composited mockup, or an AI-generated product design. Click the images for full resolution.

The checkout is [`98985a5`](https://github.com/erich04/ai-devflow-studio/commit/98985a50a19b1c9ae61f27b137bee58e0197444d).
Its application code is unchanged from [`9895c34`](https://github.com/erich04/ai-devflow-studio/commit/9895c34cc4512a24c2ed9947f57e3dd2b829f64b),
the source used for the Desktop production build. The [manifest](manifest.json) records source
commits, capture dimensions, hashes, and fixture scope.

| Image | Full viewport | What is visible |
| --- | --- | --- |
| [Desktop workbench](desktop-workbench.png) | 1920 × 1280 | Four completed stages, PR delivery as the current step, three passing test-result cards, token/cost estimates, and a populated conversation with evidence links. |
| [Workflow overview](desktop-workflow-overview.png) | 2560 × 1600 | All six stage columns, Task/Gate/Test/Delivery/Acceptance cards, completion colors, artifact/trace counts, test results, and the independent conversation pane. |
| [Design Gate review](desktop-gate-review.png) | 1920 × 1280 | Another Run awaiting its design Gate, partial stage progress, readiness counts, policy/review checks, the explicit approval control, and a discussion of design risks. |
| [Web team overview](web-team-overview.png) | 1920 × 1200 | Four team members, estimated project cost, several Runs in different stages, and the three redacted test summaries. |

All captures use the dark theme and preserve the complete application viewport. Content can be
scrolled within the application's existing panes; the workflow overview scrolls the node reader to
the evidence section. The previous empty-draft Desktop crops and sparse Web capture were replaced.

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

There are 15 artifacts, 3 review records, 7 stage-usage records, and 2 saved conversations. Workflow
statuses, prior approvals, design/review prose, usage estimates, and assistant replies are authored
fixtures for demonstrating existing UI. They are not evidence of live model execution, real
spending, or completed production delivery. Conversation notices identify the example replies.
The sample Health API tests do not establish production readiness; the conversation explicitly
identifies the design's unimplemented timeout requirement.

The Desktop remains in local, unpaired mode, as shown in its header. Sample sync-outbox entries
created while importing history were removed only from this disposable fixture database. There
is no claim that this capture exercised Desktop pairing or end-to-end synchronization.

Web runs the current Next.js application against the API's explicit in-memory demo repository.
The same four sample Runs, three test summaries, and three review summaries were uploaded through
the normal authenticated API endpoints using an isolated demo identity. The Web overview also
includes the repository's original `run-health-001` example and its estimated usage. Its displayed
identity belongs to the demo repository, not a real GitHub OAuth login.

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
   Upload allowlisted sample summaries to `/api/sync/run-summary`,
   `/api/sync/test-evidence-summary`, and `/api/sync/agent-review-summary`.
6. Open `/?view=team&projectId=p-payments&runId=showcase-health` in Web. Use the product's theme
   selector and hide the development indicator through its own preferences.
7. Attach Playwright CLI to Electron over CDP and use its Chromium session for Web. Set the
   viewport dimensions above and capture the viewport without an element target or clipping.
   Inspect every PNG before replacing the documentation assets.

## Verification scope

The Desktop production build and the previous README refresh's seven documentation/UI test files
passed (52 tests). Four README/guide test files were rerun for this image refresh (33 tests passed). The screenshots
were inspected at full-window dimensions; hashes and Markdown image links were checked separately.
The 14 additional sample-project tests are demonstration evidence, not DevFlow's regression suite.

The existing conversation Electron smoke script still has its previously recorded obsolete
`节点详情` Tab assertion; this screenshot refresh does not report that script as passing. See
[navigation validation](../../../validation/workflow-navigation-20260924.md) for the current split
reader layout. These images are not a full release signoff or a live-provider acceptance run.
