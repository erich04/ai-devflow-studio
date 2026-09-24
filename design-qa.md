# Workflow navigation and conversation header — visual QA

final result: passed

## Target and evidence

The user's annotated target is `/var/folders/pn/2vxnd83n1hxbtqhx6szfgcp80000gn/T/codex-clipboard-7c7321ea-4ec8-42c8-8c50-1b6ff2420765.png` (1047 × 591). It shows stage 02 selected while actual execution remains in stage 01. The red rectangles and bright hand-drawn line describe association and partial progress; the user explicitly delegated final colors and interaction details.

Implementation evidence is in `out/workflow-navigation-qa/` (local, uncommitted):

- `06-native-design-final.png`: installed Electron, original user profile, 1440 × 920 capture including native title bar. Stage 02 is selected, the requirement Gate is still current, and the original conversation remains visible.
- `04-final-design-wide.png`: isolated browser preview at observed CSS viewport 1600 × 900, devicePixelRatio 1.08; screenshot output 1481 × 833.
- `08-narrow-light-final.png`: isolated browser preview at observed CSS viewport 1265 × 833, devicePixelRatio 1.08; screenshot output 1170 × 771.

The screenshot API returned JPEG bytes despite the `.png` filenames. Images were opened by their content type. The browser capture rescales its output; no 1:1 pixel-fidelity claim is made. The source is a cropped panel rather than a full window, so comparison aligns the stage-navigation, selected-node strip, and reader regions, excluding native chrome and surrounding panels. The target and native implementation were opened together in the same image input. Their labels, connector thickness, selection pointer, and region borders are legible at that size; a further crop was unnecessary.

## Findings and comparison history

- **P2, resolved — no connection between selected stage and content.** Stage selection now has an accent border/background and downward pointer. The node strip names the viewed stage and uses the same accent; the reader repeats that stage above its node title. Actual execution has a separate filled stage index and explicit “实际进度” label.
- **P2, resolved — progress and browsing looked interchangeable.** Connectors now use a 2px muted track with a 4px completed segment. Successful/skipped nodes determine completion, including Gates. A completed clarification task with its Gate still pending is 1/2; browsing design keeps that connector at 50% and future connectors empty.
- **P2, resolved — right-side node shortcut resembled a nonresponsive tab (#169).** The split layout contains only conversation tabs, their menus/close controls, new and history. Its empty state stays conversational; the central node reader remains available.
- **P2, resolved during preview — hover weakened the selected-stage border.** The hover rule now excludes the pressed stage. The final native comparison shows an unambiguous selected design stage.
- **P2, resolved during preview — changing the selection caption moved connector geometry.** Stage buttons now reserve a stable 148px width. Browser measurements before/after stage selection confirmed the first connector's position and width are unchanged. Final wide and narrow captures retain aligned tracks.

No actionable P0/P1/P2 finding remains in the changed surfaces. These findings describe this iteration; the earlier Gate document-reader review remains available in Git history.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Typography | Existing product font stack, 12px stage labels, 10px secondary state and 23px reader title retained. Selected/current copy is readable and does not collide at the tested widths. |
| Layout and spacing | Horizontal stages use the available width; the view switch sits with the project/Run row. Consistent pointer, stage label and reader accent communicate association. Narrow layout keeps both panes and persistent chat controls visible. |
| Colors and tokens | Existing dark/teal and light/pink themes retained. Completed track is thicker as well as brighter; current execution and viewed selection use distinct shapes and wording. |
| Image and icon fidelity | No new artwork is required by this annotated UI target. Existing product assets and Lucide icons remain; the selection pointer is the library ChevronDown icon. Annotation strokes were intentionally not reproduced. |
| Copy and content | “正在查看” names the displayed stage; “实际进度” names the real current node. “返回当前进度” selects that node only. Saved artifacts and chat content are not rewritten. |

## Interactions and runtime

- In the isolated browser, design → implementation → return-to-current kept the active conversation, unsent draft and actual progress unchanged.
- Closing the last conversation showed “对话空状态”; reopening it through history restored the same draft while the center remained on design.
- Dark and light views were inspected. At the narrower viewport, document clientWidth equals scrollWidth (1265px). The existing top diagnostic strip has its own horizontal scroll.
- Browser console warning/error collection returned an empty list. No live model request or Gate approval was issued.
- Native Electron was restarted with the original data profile. New navigation, partial progress and chat-only header are visible. The requirement Gate, saved artifacts and chat history remain present.
- Component/application tests: 169 passed; final focused rerun: 18 passed. Desktop typecheck and production build passed.

## Implementation checklist

- [x] Associate selected stage, node strip and central reader.
- [x] Derive connector progress from workflow state, independent of selection.
- [x] Preserve the independent conversation and its empty/history behavior.
- [x] Compare the user target and final native screenshot together.
- [x] Check a narrower window, both themes, console output and original-profile recovery.

## Residual limits

The global horizontally scrolling diagnostics strip is unchanged. The line represents completed workflow nodes, not elapsed time or estimated work. Developer ID signed-install credential validation remains tracked separately in #135; this renderer update does not satisfy that prerequisite.
