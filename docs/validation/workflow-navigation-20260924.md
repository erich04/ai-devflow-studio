# Workflow stage navigation and conversation-only header

## Scope

Fixes #169 and the follow-up request to connect horizontal stage selection with the node/detail region. The selected stage has a matching accent and pointer, the node strip identifies the viewed stage, and the reader repeats its stage context. The real current node remains separately labeled; “返回当前进度” navigates without executing anything.

Progress connectors have a thin muted remainder and thicker accent completion. Completion counts successful/skipped nodes including Gates. The user's clarification task is complete but its requirement Gate is pending, so stage 01 has a half-filled connector. Future prepared nodes cannot move progress past the Run's current stage.

The right side of the split workspace now contains only conversations. Legacy combined inspector layouts keep their node-details tab. Chat tabs, menus, closing, new/history, drafts and independent navigation remain supported.

## Validation

- Desktop typecheck and production build passed.
- `WorkbenchWorkspace.test.tsx`, `WorkflowStageNavigation.test.tsx`, and `App.test.tsx`: 3 files, 169 tests passed. Final focused rerun: 2 files, 18 tests passed.
- Tests cover current versus viewed stages, pending/blocked Gate partial completion, approved-stage completion, future prepared nodes, empty stages, return-to-current navigation, closing the last conversation, history recovery and draft preservation.
- Isolated browser: stage changes preserved chat/draft; connector geometry remained stable; close/history recovery worked; both themes and a 1265px CSS viewport were inspected; console warnings/errors were empty.
- Native Electron: the updated renderer is visible under the original profile, including the selected design stage, actual requirement Gate, half-filled first connector and chat-only header.
- Visual comparison and evidence paths: [design-qa.md](../../design-qa.md).

The first Windows CI attempt passed 4,126 tests but hit the pre-existing one-second `vi.waitFor` default while creating a real Git worktree for dependency-approval testing. Cleanup then encountered the still-active directory. The approval/rejection fixture waits now allow ten seconds on Windows, within the existing thirty-second test deadline; their assertions and product execution limits are unchanged. The two dependency-approval tests are rerun locally and the final candidate is rechecked in CI.

The first macOS E2E attempt caught the project menu's transparent hit area intercepting the repositioned view switch. Its width is now bounded with explicit room for the switch. Unforced mouse clicks across compact/flow/list modes passed in the isolated browser at 1180px and 1834px in both themes; console errors remained empty. Existing E2E view-switch tests are retained to guard this regression.

## Original-profile recovery

Before rollout, backed up the complete desktop profile, registry, installed renderer, manifest and a consistent SQLite snapshot. The 66 SQLite tables were compared by row count and stable row digest after restart. All 65 non-conversation tables are identical. The five-conversation table differs only in `version`/`updatedAt` metadata for the opened conversation; messages, drafts and remaining fields are identical. Counts remain 1 Run, 8 nodes, 4 artifacts and 5 conversations. Workflow state, budget, Provider credentials and pairing did not change.

Only renderer files were replaced. The Electron main/preload files match the previously installed version byte-for-byte. A menu reload initially produced a blank window; normal quit and restart using the same executable, environment and data profile restored the application successfully. API and Web processes were retained and both `/ready` endpoints returned HTTP 200 using direct localhost connections. No live model request, approval, migration, data reset or test fixture was applied to the user's profile.

## Remaining issue

#135 already has its asynchronous credential-handling fix merged through #149. It remains open for the previously agreed Developer ID signed-install validation. The machine reports no valid code-signing identities, so an unsigned application's successful restart is not recorded as that missing signoff.
