# 剩余 15 个 Issue 的逐项修复记录

起点：main `f79a970`；工作分支 `codex/open-issues-20260910`。

用户要求：逐项复现、确认原因、修复、回归，推送后关闭。交互调整必须先由用户确认。
本记录进行中，未验证完成的项目不关闭。原工作区的未提交文档和分析产物未纳入本分支。

| Issue | 范围 | 当前状态 |
| --- | --- | --- |
| #51 | Web 深色模式 | 实际 Web 无主题控件，背景为固定浅色；交互确认待答 |
| #52 | 新 Studio 完整主流程 | 已盘点项目创建、预算、团队总览仍由旧页面承载；导航方案确认待答 |
| #53 | Work Request 宽屏布局 | 1600px 视口下空状态独占约 508px 列；布局方案确认待答 |
| #54 | pairing code 布局 | 真实临时配对码被压至约 95px 宽、161px 高，已撤销；布局方案确认待答 |
| #55 | Provider 删除入口 | 待交互确认及引用检查回归 |
| #56 | 真实 OpenCode 需求澄清 | 已确认本机 1.18.15、0 credentials；等待可用 Provider/Model 配置 |
| #57 | Policy 配置 | 待交互确认 |
| #58 | 应用 Policy 的反馈 | 已确认 action 不返回可展示结果，界面缺少策略版本反馈；隔离写入复现待做，交互确认待答 |
| #59 | Policy 自引用链接 | 实际点击仅变更 #policy 锚点，未执行应用动作；交互确认待答 |
| #60 | Desktop 同步按钮、项目 Policy | 已复现：按钮点击未调用同步；交互确认待答 |
| #61 | Team 页面滚动 | CUA 实际滚动后画面不变、下方规则被裁剪；交互确认待答 |
| #63 | Gate Inspector 滚动 | 实际长澄清内容将标签压出可视区域，滚动不移动；交互确认待答 |
| #64 | 卡片计数与证据入口 | 实际 Gate 显示产物 1 / 证据 0，报告位于 Evidence、没有产物标签；命名方案确认待答 |
| #65 | 重复审查与费用 | 真实同版本重审会新增记录；并发防重与失败重试回归通过，重审交互确认待答 |
| #76 | 模型把非缺口计作缺失证据 | 3 次真实复验通过；PR #79 已合并，Issue 已关闭 |

## 复现与回归

- #60：`corepack pnpm exec vitest run apps/desktop/src/App.test.tsx -t 'syncs the remote team from the Team Overview snapshot action'`。修复前失败：预期同步调用，实际 0 次。
- #65：`corepack pnpm exec vitest run apps/desktop/electron/knowledge-review-runtime.test.ts -t 'concurrent requests'`。修复前失败：预期 1 次 Provider 调用，实际 2 次。
- #65 确认运行时没有串行保护后，直接修复此确定性原因，不进行无依据的多假设排查。保护在任何异步调用前建立，并保持至证据保存结束；失败也释放，允许正常重试。不同请求采用独立 UUID。
- #65、#76 定向自动化：`corepack pnpm exec vitest run packages/shared/src/agent-review.test.ts packages/shared/src/workflow-context-projection.test.ts apps/desktop/electron/knowledge-review-runtime.test.ts`，3 文件 / 61 用例通过。
- #76 的历史真实结果 `agent-review-review-request-1788784806181-electron` 将明确说明“不属于设计测试策略缺口”的句子放入 missingEvidence。
- #76 本次修改前真实调用 `agent-review-review-request-1789025920054-electron`，同一方案/澄清 digest，DeepSeek v4 flash，未修改目标仓库。新增审查记录也独立复现 #65 的同版本重审行为。

上述自动化测试使用受控 Provider；真实模型证据单独记录，不混作真实端到端验收。

## #76 的真实复验

修复只补充 Review 输出语义：缺失证据必须是当前 Gate 的实际缺口；普通说明放入 summary，后续验证建议放入 suggestedTests；保留显式要求和真实缺口。不删除或重写 Provider 的输出，也不修改 Gate 权限。

通过产品 CUA 界面，在同一只读 QA Run 上连续进行 3 次真实 DeepSeek `deepseek-v4-flash` 审查。审查的澄清/设计内容 digest 保持一致，Run 仍为 `paused_at_gate / v4`，Coding Run 和 Test Evidence 均为 0。

| UTC | Review ID | missingEvidence |
| --- | --- | --- |
| 2026-09-10 07:45:31 | `agent-review-review-request-515600df-afc4-4c22-b4d4-d1bf08eb7016-electron` | 3 项仓库核验建议，无后续测试或当前审查自依赖误报 |
| 2026-09-10 07:46:50 | `agent-review-review-request-3d51c2f8-0548-4c1d-966a-d29f21ed7db7-electron` | 6 项仓库/设计核验建议，无后续测试或当前审查自依赖误报 |
| 2026-09-10 07:48:59 | `agent-review-review-request-5633f967-bc64-44a1-8230-a2e308416f96-electron` | 空数组；实施阶段核验和设计建议保留在说明/建议中 |

三次结果均完整持久化 Artifact、Trace 和实际 Provider 用量。模型仍有其他审查建议，不能宣称所有模型、所有输入都不会误报，也不将这次定向审查等同于重新跑完完整交付流程。

## 第一批交付结果

- [PR #79](https://github.com/erich04/ai-devflow-studio/pull/79) 于 2026-09-10 08:02 UTC 合并，main commit `c7ab98b1ca359594a44511cff09116cf80c32428`。
- 本地全量 `corepack pnpm verify` 通过：260 个测试文件、3682 个用例；包含 typecheck 和跨平台检查。
- 云端 macOS verify、Windows compatibility、Postgres integration、Docker smoke、Docker lifecycle smoke 五项全部通过。
- [#76](https://github.com/erich04/ai-devflow-studio/issues/76) 已关闭；[#65](https://github.com/erich04/ai-devflow-studio/issues/65) 仅交付并发保护，继续保持打开。
- 云端重新查询：起点的 15 项现剩 14 项打开。涉及交互的实现尚未获得本轮用户确认；OpenCode 真机验收仍缺可用凭据。

## 剩余交互问题的实际复现

本次通过产品 CUA 进入正常 GitHub 登录，之后返回本次工作分支的 Web 实例 `127.0.0.1:4313` 检查。没有将旧实例的页面结果当作本分支回归。Web 基线尚未做交互修改，以下结果用于确认问题，不能标记为修复通过。

- #51：默认 1600 × 900 视口，页面背景为 `rgb(247, 248, 250)`，未提供主题相关按钮或选择控件。
- #52：新 Studio 的预算详情仍链接到旧页面，创建项目也由旧页面承载；成员、跨项目成本、最近 Run 的迁移清单与导航方案需确认后实施。
- #53：复用现有空请求测试项目。Work Requests 宽约 1317px，三列约 325 / 407 / 508px；“当前项目还没有工作请求”独占第三列。
- #54：只在上述隔离测试项目生成一个临时配对码，未绑定任何 Desktop。结果容器宽约 291px，两个按钮各约 90px，配对码被压至约 95px 宽、161px 高。核验只读取尺寸，未记录配对码明文；通过同一产品界面撤销，结果显示“配对码已撤销”。
- #59：点击“应用推荐策略”链接后，仅导航至当前页面的 `#policy`；真正可执行的按钮仍是单独的 `Apply recommended enforcement`。
- #61：实际 Desktop 的 Team 页面有 10 条策略规则，下方被裁剪；在内容区域向下滚动后，画面与 AX 状态均未移动。
- #63：实际 Desktop 需求 Gate 的长澄清内容出现在标签栏之前，标签栏被压出可视区域；在 Inspector 区域滚动后画面与 AX 状态均未移动。源码中内容数量与固定 grid 行数不匹配，需在获准的滚动方案中修正并回归。
- #64：实际 Gate 卡片的“产物 1 / 证据 0”与 Inspector 缺少产物入口同时出现；审查报告在 Evidence 中。后续按用户确认的计数命名及直达入口方案修复。

没有在这轮复现中覆盖组织策略、创建新的 Work Request、推进已暂停的 QA Gate 或修改目标 mini Agent 仓库。上述隔离测试配对码已经清理。
