# README screenshots — September 24, 2026

These are native screenshots of the product running from source commit
[`9895c34`](https://github.com/erich04/ai-devflow-studio/commit/9895c34cc4512a24c2ed9947f57e3dd2b829f64b).
They replace the older image in the root README. Historical walkthrough images remain with their original guides.

The [manifest](manifest.json) records capture areas, dimensions, file hashes, source commit, and demo-data scope.

| File | What is visible |
| --- | --- |
| [Desktop workbench](desktop-workbench.png) | Current six-stage navigation, a completed clarification and pending requirement Gate, separate node reader and conversation, and an unsent chat draft. Dark theme; the actual `main` element is captured. |
| [Gate reader](desktop-gate-review.png) | The same Gate's current clarification, source tabs, acceptance criteria, and approval control. Light theme; the node-reader element is captured. |
| [Web workbench](web-workbench.png) | The current Web shell's evidence chain and human Gate for the built-in Payments API example. Dark theme; the viewport is scrolled to the evidence chain. |

## Data and execution

Desktop was built with `corepack pnpm --filter @ai-devflow/desktop build` and launched in real
Electron 42.11.6, with a disposable Git repository and independent SQLite/data-profile registry.
The normal preload IPC selected that repository, created a Run, generated clarification through
`fake-knowledge-review`, and ran the deterministic Gate Review. The requirement Gate was left
pending. A conversation was created through the UI; its draft was not sent to a model.

Web ran Next.js 15.5.24 against the API's explicit in-memory demo repository. The selected example
is `p-payments` / `run-health-001`. The Desktop and Web screenshots demonstrate separate local
fixtures, not an end-to-end synchronized delivery.

No real model credentials, user workspaces, existing Desktop profiles, paid-provider requests, or
production records were used. Displayed costs, tokens, reviews, and workflow records belong to
these deterministic fixtures. Screenshots were captured directly; no UI text or pixels were edited.

## Reproduce the views

1. Check out the source commit above, install the pinned dependencies, and build Desktop.
2. Create a disposable committed Git repository and use separate `DEVFLOW_USER_DATA_DIR` and
   `DEVFLOW_DATA_PROFILE_REGISTRY_PATH` values. Enable `DEVFLOW_ENABLE_FAKE_RUNTIME=true` and
   `DEVFLOW_CODING_ENGINE=fake` for this local demonstration.
3. Select the repository, choose **Deterministic Fake Provider**, and create a Run requesting a
   clear-completed-tasks button. Generate clarification and run Gate Review; leave the Gate pending.
4. Use compact stage navigation, create a Direct Provider conversation, and leave its question as
   an unsent draft. Capture the workbench's `main` element in dark theme. Switch to light theme
   and capture `[aria-label="当前查看的节点详情"]` for the Gate close-up.
5. Start an isolated API with `DEVFLOW_ENABLE_DEMO_DATA=true` and `DEV_AUTH_ENABLED=true`, with
   database connection variables unset. Start Web with the same demo flag and that API's URL.
6. Open `/?projectId=p-payments&runId=run-health-001#evidence-chain`, choose dark theme, and capture
   a 1600 × 1200 CSS-pixel browser viewport. Desktop was captured from an 1800 × 1100 native window;
   its element sizes are recorded in the manifest.

Playwright CLI was used for navigation, theme selection, live DOM snapshots, and screenshots.
Source analysis used `explore-codebase` / Code Review Graph against the same commit (690 parsed
files), followed by direct inspection of the implementation, package commands, ADRs, and GitHub
release metadata. The old September 9 domain index was not treated as current evidence.

## Validation and limitations

- Desktop production build passed.
- Seven existing documentation/UI test files passed: 52 tests covering README contracts,
  historical guide links, workbench conversations, stage navigation, and the legacy URL redirect.
- Live Electron navigation preserved the unsent conversation draft and the real current Gate
  while viewing Design and returning to Clarify. Both desktop themes were inspected.
- The Web workbench, team overview, and settings were opened in the current shell.
- The pre-existing `scripts/workbench-conversation-electron-smoke.mjs` stopped at its old
  `节点详情` Tab assertion. Current split layout deliberately has a separate reader instead of that
  Tab (see [navigation validation](../../../validation/workflow-navigation-20260924.md)). That
  script is not recorded as passing and was not modified by this documentation refresh.
- No full release signoff, production deployment, live OpenCode run, or paid model acceptance is
  claimed by these screenshots. Electron emitted its development security warning; the Web
  development server's missing favicon returned 404.
