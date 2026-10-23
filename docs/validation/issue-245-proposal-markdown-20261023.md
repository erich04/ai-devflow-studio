# #245：节点提案 Markdown 展示验证

日期：2026-10-23。B 包独立工作树基于 PR #244 的 `533ddb5`。

## 行为与接口

- 新增纯展示组件 `ProposalBody({ content, title? })`，会话提案和方案修订的已保存提案共用。
- 复用 `ConversationBody` 的 Markdown、GFM、查看原文、渲染失败回退和链接/图片/HTML策略；不增加渲染器权限。
- 若正文首个一级标题与卡片标题一致，仅省略重复的外层标题。原文、保存命令、人工确认、覆盖关系与流程推进规则不变。
- 正文容器独立限制高度并可键盘滚动；代码块和表格在各自区域横向滚动，表格单元保留最小可读宽度。超出既有会话预览上限的正文仍使用原有完整原文分页入口。
- `WorkbenchWorkspace.tsx` 只有组件 import 与提案展示调用点变化。无 main/IPC/preload、共享类型或存储接口变更。

## 已执行验证

1. 先新增工作台行为测试；旧实现因找不到提案中的 Markdown 标题失败，确认覆盖实际 `pre` 展示缺口。
2. 三组组件测试共 35 项通过：`WorkbenchWorkspace.test.tsx`、`ProposalBody.test.tsx`、`DesignRevisionPanel.test.tsx`。包括标题、列表、强调、行内/块代码、表格、CRLF 原串、重复标题、安全链接、图片与 HTML 策略、确认保存命令、保存前后展示。
3. `corepack pnpm --filter @ai-devflow/desktop build` 通过。视觉修正后单独重建 renderer 通过。
4. 扩展并运行 `node scripts/workbench-conversation-electron-smoke.mjs`，最终于 `2026-10-23T16:22:39.170Z` 通过。使用真实 Electron、preload、SQLite、独立应用 profile、临时 Todo 仓库、随机独立端口，以及本地合成模型端点。它不使用真实 DeepSeek 或 Postgres，不能代替 B 包其他真实模型验收。
5. Electron 验证 320px 会话宽度下的正文滚动、代码块横向滚动、表格边界和最小列宽，原文与保存记录逐字相同，读取/切换/保存没有新增模型请求。原有保存确认、取消、会话重启、独立执行器选择等脚本断言继续通过。
6. 已查看 Markdown、原文与代码/表格截图。初次视觉检查发现窄表格逐字竖排；新增布局断言先失败，设置最小列宽后通过，最终截图显示为可读列及横向滚动。

最终 smoke 的完整流程有 31 次本地合成请求，真实提供方请求为 0，新增费用为人民币 0 元。截图与 JSON 报告保存在忽略目录 `out/workbench-conversation-qa/`：

- `15-proposal-markdown-narrow.png`
- `16-proposal-code-table-narrow.png`
- `17-proposal-raw-narrow.png`
- `report.json`

桌面 TypeScript 检查 `corepack pnpm --filter @ai-devflow/desktop typecheck` 已在并行实现修复后重新运行并通过。早期 `opencode-task-guard.ts` 的 TS2695 阻断已解除。仓库全量 typecheck、全量测试及 verify 由 B 包总验收单独记录，本记录不据此声称这些整包检查已经通过。
