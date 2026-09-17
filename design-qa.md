# Unified workbench visual QA

final result: passed

## Comparison target and evidence

- Source visual truth: `/var/folders/pn/2vxnd83n1hxbtqhx6szfgcp80000gn/T/codex-clipboard-e4d0be7f-87e3-41da-b599-7d34be8624d0.png`.
- Source: 1672 × 941 pixels, dark desktop concept, existing project and requirement with a pending question.
- Implementation: actual Electron file renderer, real Main/preload/SQLite, isolated project and controlled model HTTP endpoint. The test project is unpaired; it does not pretend to be the user's authenticated walkthrough.
- Full view: `out/workbench-conversation-qa/02-conversation-question.png`, 1672 × 941 pixels / CSS px.
- Node detail: `out/workbench-conversation-qa/01-node-details.png`, 1672 × 941.
- Focused conversation: `out/workbench-conversation-qa/02-conversation-detail.png`, 520 × 796.
- Light view: `out/workbench-conversation-qa/04-light-workspace.png`, 1672 × 941.
- Narrow view: `out/workbench-conversation-qa/05-narrow-workspace.png`, 1280 × 941.
- The Electron display uses DPR 2. Final Playwright captures use `scale: 'css'` to normalize the output to the source density. Earlier 3344 × 1882 captures were compared as double-density evidence, not as larger UI controls.

The source and implementation images were opened together in each comparison input. Full-view comparison checked the three main regions and stage/card hierarchy. Focused comparison checked the source's right-hand region against the actual 520-pixel conversation capture, including Tabs, context entry, message wrapping, pending question, options, source disclosure and composer. This was a combined image comparison, not a claim that separate windows were placed side by side.

## Findings and iterations

1. **P2, right-panel legibility:** the inherited 420-pixel default left too little room for conversations. The new workspace starts at 520 pixels, retains the draggable splitter, and uses 14-pixel message text. Final focused capture shows readable wrapping and visible composer controls.
2. **P2, answer affordance:** “输入回答” initially inherited a native gray button appearance. Added a token-based text-button style; the final focused capture shows the accent action separated from explanatory copy.
3. **P2, card density:** nested old/new card padding pushed Gate cards below the useful viewport. Removed duplicate padding, reduced stage/context spacing, and preserved every evidence counter. The final full view shows both Task and Gate cards within the visible stage columns.
4. **P2, laptop header overflow:** at 1280 pixels, the global New Run action was clipped; at 1672 pixels, search scope text overlapped the input. Reduced responsive project/search minimum widths and hid redundant scope copy on constrained screens. The final narrow capture and geometry assertions confirm New Run, new conversation, history and send are inside the viewport.
5. **P3, sidebar terminology:** replaced the wrapping “Local Project + Runs” heading with “项目与运行”.

Every P2 fix was followed by a fresh actual Electron capture and another comparison. No actionable P0/P1/P2 visual finding remains within this workbench change.

## Required fidelity surfaces

- **Typography:** retained the application's system sans-serif and Chinese fallback. Conversation body uses 14px with generous line height; headings, metadata and buttons have separate weights/sizes. Long conversation titles ellipsize in Tabs while the content header and history preserve access to the full title. Source mock glyphs are not treated as an authoritative downloadable font.
- **Spacing/layout:** preserved project column, horizontally navigable stages and resizable right workspace. Fixed Tabs/context/composer remain visible while messages scroll. The real app retains additional provenance/status content, so it is denser than the concept; this is intentional preservation of existing information.
- **Colors/tokens:** dark mode uses the existing dark/teal tokens; waiting questions use the existing amber semantics. Light mode retains the existing product's light/pink theme rather than inventing a new global theme. The source specifies only the dark view.
- **Assets:** existing DF brand mark and icon library are retained; no new decorative raster art or substitute generated logo was introduced.
- **Copy/content:** the mock's separate project-assistant and node-chat Tabs are intentionally replaced by the later agreed single conversation type. Scope explicitly says all project Runs/nodes. Counts and statuses come from real local state. Draft publication is visibly pending, not an approval. The existing Inspector terminology and all internal sections remain available.

## Interaction and runtime checks

- All eight nodes and every node-specific Inspector tab opened; artifact/evidence/trace counters deep-link correctly.
- Flow/list switching, new conversations, question choices, cross-node navigation, explicit proposal publication, independent history/memory, retry, cancel, restart, close/reopen and input recovery passed in Electron.
- Dark, light and 1280-pixel layouts captured; persistent conversation and New Run controls checked against the viewport.
- Electron page-error collection remained empty.
- The packaged completed-flow probe separately verified all eight nodes after actual fixture execution through Acceptance. This does not assert an external GitHub publication or a live DeepSeek model result.

## Implementation checklist

- [x] Compare full source and actual implementation together.
- [x] Compare focused right-panel controls and text.
- [x] Fix and recapture all P2 findings.
- [x] Check preserved node details and responsive controls.
- [x] Keep actual test evidence and live-provider limits separate.

## Follow-up polish

The surrounding legacy navigation and some workflow node titles still mix English and Chinese. A future terminology pass can align the whole application; this change preserves the existing functional labels and node records.
