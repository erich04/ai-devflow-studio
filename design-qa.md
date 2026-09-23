# Gate reader and independent conversation — visual QA

final result: passed

## Target and comparison

The user selected `codex-clipboard-77be0ebc-4c2f-41ae-9f6e-76147c94bce7.png`: horizontal six-stage navigation, a wide document reader, and a conversation beside it. Their second image, `codex-clipboard-38079782-61e5-4298-b51e-838d62bd8a53.png`, replaces the concept's “项目对话” title with the existing compact node/conversation/new/history header. Existing product tokens, real saved documents and functional controls take precedence over the concept's invented chat, decorative logo and image-editor toolbar.

Compared the selected reference and the actual renderer together in the same image input. Both show the requirement Gate, the clarification material with acceptance criteria, and an open independent conversation. Reference: 1748 × 1246. Actual observed CSS viewport: 1748 × 1245 (one-pixel browser rounding). The IAB viewport override produced a padded screenshot canvas; `10-reference-normalized.png` crops the complete first viewport raster and normalizes its pixel density, without changing app content. The unmodified capture is retained as `09-match-raw.png`. Normal-window screenshots have no capture defect. Temporary viewport overrides were reset after testing.

Local evidence lives in `out/gate-workbench-qa/` (not committed): `07-final-dark.png`, `03-light-review.png`, `09-match-raw.png`, `10-reference-normalized.png`. Evidence uses the production renderer and an isolated in-memory bridge populated from a read-only copy of the user's saved state. Mutating business operations are rejected by that bridge. This is renderer verification, not a claim of live-model or deployed Electron verification.

## Findings and changes

1. **P2 — working space:** permanent project and workflow columns crowded out the material reader. The default is now a compact project/Run disclosure and horizontal stage/node navigation above the two independent panes. Flow and list views remain available explicitly.
2. **P2 — conversation coupling:** selecting a node or Run must not replace the conversation. The center reader navigates independently; the selected conversation, draft and message scroll position persist. The pinned “节点详情” control focuses the center without closing the chat. The supplied compact tabs, menus, close buttons, plus and history are retained.
3. **P2 — document overload:** five material tabs separate clarification, original request, repository findings, team knowledge and the review report. Markdown headings, lists, tables and code are rendered through the existing safe renderer. Acceptance criteria are open; longer supporting sections and source metadata are collapsed. Review findings are shown once with their evidence available on demand.
4. **P2 — information loss:** the full clarification is available through “查看原文”; browser inspection verified all 3,631 characters, including the final open question. Presentation labels and duplicate headings are cleaned up without changing the stored original. Internal identifiers and hashes remain in source/version disclosures.
5. **P2 — status alignment:** material-row status badges stretched vertically. Explicit center alignment restores compact, readable badges; recaptured and compared.

No actionable P0/P1/P2 visual finding remains in the changed workbench.

## Runtime and interaction checks

- Real saved requirement Gate, four artifacts and five conversations were used as isolated fixture data; no business approval or model request was sent.
- Switching from stage 01 to 02 and back preserved the selected chat ID, a typed draft and its message scroll offset; the newly selected center reader starts at the top.
- Clarification rendering, original-text toggle, material switching, report findings, source disclosures and independently scrolling panes were checked in the browser.
- Dark and light views were inspected. Existing dark/teal and light/pink product tokens, fonts and icon library are retained.
- Standard laptop viewport and the reference-sized viewport were checked. Main navigation, material tabs, chat tabs, new/history and composer controls remain usable. The splitter continues to support keyboard and pointer resizing.
- Browser console error collection returned no errors.
- Component/application tests additionally cover Run switching, hidden technical metadata, escaped Markdown, empty/missing materials and existing Gate controls.

## Intentional differences and P3 follow-up

The production header retains team pairing, search, budget and synchronization controls omitted by the mock. Its existing horizontally scrollable diagnostic strip remains unchanged. The conversation starts at the user's saved history rather than fictional example messages; no history is rewritten. Exact brand art, large concept typography and mixed English terminology outside this scope are not replaced. Further simplification of the global diagnostic strip is optional polish, separate from this reader redesign.
