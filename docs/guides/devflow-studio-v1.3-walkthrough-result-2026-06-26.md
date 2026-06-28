# DevFlow Studio v1.3 Walkthrough Result - 2026-06-26

本报告按 `docs/guides/devflow-studio-v1.3-walkthrough.md` 和
`docs/guides/devflow-studio-full-feature-walkthrough.md` 做真实用户路径验收。

本轮重点使用 Computer Use 操作 Electron / Web UI；终端只用于健康检查、API 证据和自动交叉检查。
默认路径未调用真实付费 provider，Knowledge Review 与 Coding Agent 均使用 fake/no-cost 路径。

## Environment

| Item | Result | Evidence |
| --- | --- | --- |
| Branch | pass | `codex/airbnb-iii-pixel-port` |
| Existing working tree | note | 本轮开始前已有 `apps/desktop/src/App.tsx`、`apps/desktop/src/useGateEnforcement.ts`、`apps/desktop/src/App.test.tsx` 未提交改动 |
| Docker services | pass | `postgres` healthy, `api` on `4310`, `web` on `4311` |
| API health | pass | `GET http://127.0.0.1:4310/health` returned `status: ok` |
| Web console | pass | `http://127.0.0.1:4311/` returned 200 and rendered in Chrome |
| Desktop | pass | Electron window title `AI DevFlow Studio`, URL `127.0.0.1:5173/` |
| Navigation | pass | Computer Use read Workbench, Team, Knowledge, Agents, Skills, MCP, Tests |

## Desktop Walkthrough

| Step | Result | Evidence |
| --- | --- | --- |
| Initial desktop state | pass | Electron started in `seed fallback` before local repo selection |
| Select local repository | pass | Selected `/Users/erich/File/claude/10-showcase/ai-devflow-studio`; UI showed `ai-devflow-studio`, `connected`, `package script`, `corepack pnpm test` |
| Create QA Run | pass | Created `QA 手动验收 2026-06-26`; run entered local SQLite / local persisted mode |
| Raw request artifact | pass | Inspector showed raw request matching the walkthrough webhook retry text |
| Clarification | pass | `生成需求澄清` created clarification artifact; Stage 01 task became `success` |
| Policy unavailable Gate | pass | Before sync, Demand Confirmation Gate was blocked by unavailable Team policy |
| Team sync before approval | pass | Sync loaded `remote_cache v1`; policy snapshot appeared; local QA Run remained visible at that moment |
| Demand Gate approval | pass | Gate approval advanced run to `designing`; old hard-coded `building` behavior was not observed for this Gate |
| Design artifact | pass | `生成设计方案` created design artifact; design Review card ART/TRC changed from 0 to 1 |
| Design Gate review | pass | Inspector -> Agents opened correct target `方案评审 Gate`; fake review ran with 18 knowledge refs, trace, cost `$0.00` |
| Design Gate approval | pass | Gate approval advanced run to `building` and Build task became ready |
| Coding Agent | pass | Build task launched fake coding engine; permission relay appeared for `devflow-fake-change.txt` |
| Permission approval | pass | Approved once; managed worktree completed, changed paths 1, fake diff archived, coding trace recorded |
| Tests page | pass | Inspector -> Tests opened target `Run tests`; command `corepack pnpm test` was safe and saved |
| Local test execution | pass with issue | Tests completed with exit 0 and duration 6786ms; Evidence local runs increased from 1 to 2 |
| PR Draft | partial | PR Draft artifact generated with compare URL, changed path, test evidence, policy, budget, agent review; no real GitHub PR was created |
| Acceptance Bundle | partial | Acceptance bundle artifact generated with raw request, PR draft, changed path, tests, policy, budget, agent review |
| Final Acceptance | partial | Acceptance Gate approval marked run `completed`, but board/current-node state stayed inconsistent |

## Team / Web / Pairing

| Step | Result | Evidence |
| --- | --- | --- |
| Desktop sync after completion | fail | Sync changed status strip to `0 local · 2 remote`; QA Run became `remote`; board collapsed into remote summary nodes |
| Remote API run presence | pass | `GET /api/runs?organizationId=org-1` included QA Run with status `completed` |
| Remote run detail | fail | Remote QA Run only had 3 summary nodes; artifacts/events arrays were empty for that run |
| Desktop after remote merge | fail | Electron showed `Run node not found` while evaluating Gate after sync |
| Pairing code | pass | API created copy-once pairing code shape |
| Desktop token exchange | pass | API exchanged pairing code for desktop token shape |
| Token/code leakage | pass | `GET /api/team/overview` did not include pairing code or desktop token |
| Web Console via Chrome | partial | Web loaded with Computer Use, but showed seed `为 Payments API 增加 /health 端点`; synced QA Run was not visible in the primary view |

## Boundary / Negative Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Dangerous command safety | pass by code/test coverage | `validateTestCommandSafety()` blocks `rm -rf`, `sudo`, `curl | sh`, recursive chmod, protected-path redirects, Windows destructive commands |
| Real paid provider | not tested | No API key entered; fake provider only |
| Real opencode smoke | not tested | Requires explicit approval and live provider setup |
| Real GitHub PR | not tested | PR Draft only; no push/PR creation |
| Real MCP execution | not tested | MCP page/shell boundary only, no real MCP execution validation |

## Automated Checks

| Command | Result | Notes |
| --- | --- | --- |
| `corepack pnpm --filter @ai-devflow/desktop typecheck` | pass | `tsc --noEmit` passed |
| `corepack pnpm test -- apps/desktop/src/App.test.tsx` | pass | 41 tests passed |
| `corepack pnpm test:electron-smoke` | blocked | Smoke requires clean ports; current manual environment was using `4310`, `4311`, `5173` |
| `corepack pnpm test:docker-smoke` | pass | Built isolated compose project; API/Web health, pairing, token exchange, redacted overview leak checks passed |

## Findings

### P1 - Team sync corrupts the local completed run view

After completing the QA Run and clicking `同步团队`, the desktop UI changed from local persisted state to:

- `remote snapshot + local merge`
- `Active Runs 2`
- `Run Sources 0 local · 2 remote`
- QA Run source badge changed to `remote`

The board no longer showed the full local six-stage run. It rendered remote summary nodes instead, and Electron displayed:

```text
Error invoking remote method 'devflow:enforcement:gate:evaluate':
Error: Run node not found: run-eaaf83ba-cc08-49aa-9a91-64cb331ee488:run-eaaf83ba-cc08-49aa-9a91-64cb331ee488-test
```

This violates the walkthrough requirement that sync must preserve local runs and not hide or destroy local workflow context.

### P1 - Remote summary loses artifacts/events and full workflow structure

The API did contain the QA Run after sync, but `/api/runs?organizationId=org-1` returned only 3 summary nodes for the QA Run and no artifacts/events:

- `Knowledge Review Target` for design Gate
- `Knowledge Review Target` for acceptance
- `Test Evidence`
- `artifacts: []`
- `events: []`

The local run had full clarify/design/build/test/pr/accept cards, artifacts, review, coding diff, test evidence, PR draft, and acceptance bundle. That detail did not survive the remote summary round trip.

### P1 - Test evidence output leaks full local path

The Tests page recorded `corepack pnpm test` as passed, but the artifact content exposed the full local cwd and stdout path:

```text
CWD: /Users/erich/File/claude/10-showcase/ai-devflow-studio
> ai-devflow-studio@1.2.0 test /Users/erich/File/claude/10-showcase/ai-devflow-studio
RUN v3.2.6 /Users/erich/File/claude/10-showcase/ai-devflow-studio
```

The UI also showed `Redacted no`. This fails the guide's requirement that stdout/stderr summaries be redacted and not expose full local sensitive paths.

### P2 - Run completion leaves board/current-node state inconsistent

The run eventually became `completed`, and Acceptance signoff became `success`, but the board state was inconsistent:

- Summary still said `当前卡点: 测试证据 · Run tests`
- Build card still showed `ready` after Coding Agent completed
- PR card still showed `waiting` after PR Draft was generated
- Final toast said `Acceptance signoff 已通过，Run 进入本地实现阶段`, which is the wrong phase copy for final acceptance

This makes the workflow hard to trust even though the actions produced artifacts.

### P2 - Web Console does not surface the synced QA Run in the primary view

Chrome/Computer Use loaded `http://127.0.0.1:4311/`, but the page still focused on the seed run:

```text
为 Payments API 增加 /health 端点
RUN-RUN-HEAL
```

The API overview had two runs and included the QA Run, so the issue appears to be Web selection/display behavior rather than API absence.

### P2 - Source labels become contradictory after sync

After sync, the left Workbench panel still visually labels `Local Project + Runs local only`, while the status strip says `0 local · 2 remote` and the QA Run badge says `remote`. This creates ambiguity about whether the user is inspecting local SQLite state or remote snapshot state.

## Recommended Fix Order

1. Fix desktop sync merge so local persisted runs remain local and visible after remote snapshot refresh.
2. Fix remote summary contract or desktop merge adapter so full local run context is not replaced by lossy remote summary nodes.
3. Redact test output paths and cwd before storing/displaying Test Evidence.
4. Align node state transitions after Coding Agent, PR Draft, Acceptance Bundle, and final Gate.
5. Fix toast phase copy for Gate approvals, especially final Acceptance.
6. Update Web Console selection/display so the newly synced QA Run is discoverable in the primary run view.
7. Add regression coverage for the exact completed-run sync path used in this walkthrough.

## Not Tested

- Real paid Knowledge Review provider.
- Real opencode provider smoke.
- Real GitHub PR creation, push, merge, or publish.
- Real MCP tool execution.
- RAG/vector retrieval.
- Windows full smoke.

