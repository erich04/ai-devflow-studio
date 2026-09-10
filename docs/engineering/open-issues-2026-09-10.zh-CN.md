# 剩余 15 个 Issue 的逐项修复记录

起点：main `f79a970`；工作分支 `codex/open-issues-20260910`。

用户要求：逐项复现、确认原因、修复、回归，推送后关闭。交互调整必须先由用户确认。
本记录进行中，未验证完成的项目不关闭。原工作区的未提交文档和分析产物未纳入本分支。

| Issue | 范围 | 当前状态 |
| --- | --- | --- |
| #51 | Web 深色模式 | 已按确认方案增加三态主题和首屏恢复；含退出登录同源修复，六尺寸浏览器回归通过，PR #84 已合并，Issue 已关闭 |
| #52 | 新 Studio 完整主流程 | PR #87 已合并，云端五项检查通过，Issue 已关闭 |
| #53 | Work Request 宽屏布局 | 已统一主卡宽度，空状态置于表单下；空/有请求 × 六尺寸 × 双主题回归通过，PR #84 已合并，Issue 已关闭 |
| #54 | pairing code 布局 | 已拆为配对码整行、复制/撤销下一行；六尺寸受控配对码视觉回归通过，PR #84 已合并，Issue 已关闭 |
| #55 | Provider 删除入口 | PR #85 已合并；引用、并发、持久化、键盘及真实删除/重启回归通过，Issue 已关闭 |
| #56 | 真实 OpenCode 需求澄清 | 已接通保存的 DeepSeek 凭据并完成真实只读澄清验收；PR #83 已合并，Issue 已关闭 |
| #57 | Policy 配置 | PR #87 已合并，完整规则编辑、预览和同步验证通过，Issue 已关闭 |
| #58 | 应用 Policy 的反馈 | 已统一反馈、保存后权威重读和两页刷新；真实 Server Action 到隔离 API 回归通过，PR #84 已合并，Issue 已关闭 |
| #59 | Policy 自引用链接 | 已移除自引用操作链接，保留实际提交按钮；组件和浏览器回归通过，PR #84 已合并，Issue 已关闭 |
| #60 | Desktop 同步按钮、项目 Policy | 已修复；真实同步、Task 策略、状态推送保留及自动化回归通过（PR #80） |
| #61 | Team 页面滚动 | 已修复；多尺寸/主题自动化与真实底部滚动通过（PR #80） |
| #63 | Gate Inspector 滚动 | 已修复；多尺寸/主题自动化、真实长内容滚动及 Evidence 访问通过（PR #80） |
| #64 | 卡片计数与证据入口 | 已统一产物 / 测试证据 / 轨迹和直达入口；本地及云端回归通过，PR #88 已合并，Issue 已关闭 |
| #65 | 重复审查与费用 | 已修复；真实 DeepSeek 确认重审及并发/重放/失败重试回归通过（PR #80） |
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
- 云端重新查询：起点的 15 项现剩 14 项打开。此时涉及交互的实现尚未获得用户确认；后续第一批已获确认（见下文）。OpenCode 真机验收仍缺可用凭据。

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


## 第二批：已确认的 Desktop 可用性修复

用户随后确认先实施 #60、#61、#63、#65。其余交互方案继续等待答复。

- #60：Team 内的同步按钮接入真实 IPC 同步，禁用重复点击；同步后刷新当前项目的 Policy 和当前 Gate 评估，原位显示版本/时间或错误，保留当前视图和所选节点。Policy 读取独立于 Gate 是否启用，普通 Task 也能看到团队策略。修正 Local Project / Team Project ID 的对应关系。
- #60 的真实验证额外发现本地 outbox 状态推送清空 Team 摘要。先以失败测试复现，再改为同一项目和 pairing 下保留团队快照；切换项目或 pairing 权限变化时清空。回归包含解绑清理。
- #61、#63：保留内容顺序，将 Team 内容行恢复自然高度，长规则名在原列内换行以免覆盖相邻列，Inspector 使用连续纵向滚动，避免长澄清内容挤出下方标签。
- #65：已有结果的主动作改为查看，重新审查为次级动作；确认框展示目标、Provider/Model、上次时间和新增记录/费用。取消、Esc 与焦点回收有回归。确认携带上次 Review ID，运行时验证它仍是最新记录，拒绝旧确认重放；每个请求单独创建 Runtime 时也共享同一 store 的并发保护。
- #65：本地 Review 的相同时间戳按持久化顺序确定最新记录；覆盖相同内容、内容更新后重审、失败重试和新建 Runtime 的重复请求。

### 自动化结果

- `corepack pnpm verify`：260 文件 / 3690 用例、typecheck、跨平台检查全部通过。
- 随后补充“内容更新”和“确认后失败重试”的边界用例：KnowledgeReviewRuntime 共 13 用例通过（新增 2 用例，产品代码未再变化）。
- 完整 Desktop Playwright 受控接口回归：16/16 通过；其中滚动覆盖 1180×760、1834×768 与浅色/深色的四种组合。使用真实长度的规则标识，并验证文字不越出所属列；修改前该断言失败，列内换行修复后通过。
- Desktop production build 通过。CI 的 Electron smoke 最初仍断言旧同步文案；现改为从 Team 内触发真实 IPC 同步、验证原位反馈与停留 Team，并回到工作台验证本地 Run 保留。隔离临时 profile 的 `corepack pnpm test:electron-smoke` 本地完整通过。受控接口/Provider 测试不计为真实 Provider 验收。

### 真实验证结果

本次运行隔离工作分支的 Desktop production 构建，复用只读 QA Run `run-work-request-d31f23324f30654ed290208e35f85802`。验证前为 `paused_at_gate / v4`，共 7 份 Review（方案 Gate 6 份、需求 Gate 1 份），9 份用量记录，Coding Run 和 Test Evidence 均为 0。

CUA 曾出现 `noWindowsAvailable` 和截图旧帧，旧测试进程也未真正退出。用户恢复可操作窗口后，彻底重启验证实例，确认新 PID 与构建路径，再重新完成以下验收；旧画面不计为通过证据。

| 验证 | 真实结果 |
| --- | --- |
| #60 Team 同步 | 原位显示 `remote_cache v1 / 2026-09-10T09:57:30.304Z` 和绑定的 Team Project，保持 Team 页面 |
| #60 Task 项目策略 | 选中已完成的设计 Task 后，Policy v1 / loaded 与预算仍显示；没有执行 Task Gate 评估 |
| #60 本地状态推送 | 真实重审结束后的状态更新及 outbox 推送后，Team 项目、成员、成本与同步反馈仍保留 |
| #61 页面滚动 | 实际滚轮到达第 10 条规则、Budget Guard、保存和同步按钮；长规则名在列内换行、不覆盖相邻列 |
| #63 长澄清滚动 | 实际滚轮越过澄清内容，点击 Evidence 标签，再滚动到已有 Review 报告 |
| #65 查看 / 取消 | 查看结果、Esc 取消、按钮取消后，仍为 7 份 Review / 9 份用量记录 |
| #65 确认重审 | 点击一次确认，运行中按钮禁用；完成后恢复查看结果主动作，新增且仅新增 1 份 Review、1 份用量、1 份对应 Artifact 和 Trace |

真实 Provider 为 DeepSeek `deepseek-v4-flash`；新 Review `agent-review-review-request-9af9e8c9-09bb-45dd-8ef7-801a0d35b761-electron`，时间 `2026-09-10T09:57:51.069Z`。归档用量为 4966 input / 814 output / 4736 cache read；系统记录成本 `$0.0032888`。

重审后总计 8 份 Review（方案 Gate 7 份）、10 份用量。审查对象 manifest 保持一致，Run 仍为 `paused_at_gate / v4`，Coding Run 和 Test Evidence 仍为 0。重复请求与旧确认重放使用受控 Provider 做边界回归；不通过额外重复的付费调用制造验收数据。

上述为这四项 Issue 的定向真实回归，不等同于重新执行从需求到交付的完整流程。[PR #80](https://github.com/erich04/ai-devflow-studio/pull/80) 汇总修复与回归；Issue 在云端检查通过并合并后关闭。其余 10 项继续按交互确认 / OpenCode 配置依赖处理。

## #56：复用已保存 DeepSeek 凭据的真实 OpenCode 验收

用户确认使用 `deepseek / deepseek-v4-flash` 并复用 DevFlow 已保存 Key。历史“0 credentials”仅指 OpenCode 自有凭据库，不能说明 DevFlow 没有保存 Key。原生 Provider 配置的实际 ID 是 `deepseek`，可精确绑定，不按显示名称猜测，也不需要用户再次输入凭据。

### 复现与修复

- 原 Main 的 OpenCode 启动路径只传递环境白名单，未读取 DevFlow 的已保存凭据；`opencode models deepseek --pure` 返回 Provider not found。
- Main 现在按项目确认的 Provider ID 精确解析已保存凭据和端点，用专用子进程环境变量及引用变量的 inline config 接通 OpenCode。凭据不进入 Renderer、不复制到 OpenCode auth 文件；解密失败不回退，凭据轮换改变缓存身份。预检、Coding 和只读 Stage Agent 共用绑定。
- 第一轮真实调用已完成 5 个 DeepSeek assistant 回合、9 次只读工具调用，但返回的 citations 是字符串列表，被严格校验拒绝。提示词原先笼统要求“所有列表都是字符串”，与引用对象契约冲突。已明确 top-level 字符串列表和 Repository Findings 的对象结构；引用路径和内容 digest 校验保持严格。
- 适配器从 OpenCode 执行记录取得模型身份、汇总整个会话的工具和 token，用于 Trace；不信任模型自行填写的 model/usage，不把最后一条文本回复视为全部工具调用。

### 真实链路证据

通过测试 Desktop 的正常界面新建 Run `OpenCode live clarification #56`，输入一句需求：修改 mini Agent README 主标题为 `Mini Agent - Ready for OpenCode`，其余内容不变。配置项目 OpenCode `1.18.15 / deepseek/deepseek-v4-flash / v2`，选择 `Read-only Local Agent (OpenCode)` 并执行。

| 项目 | 结果 |
| --- | --- |
| Run | `run-949c6feb-03cc-4a60-9802-4edc30983830` |
| OpenCode Session | `ses_f751dd02dffemtaQy5kh64C1UG` |
| Provider/Model | `deepseek/deepseek-v4-flash`，运行中的 OpenCode `/provider` 确认 connected，模型可枚举 |
| 真实执行 | 3 个 assistant 回合、4 次已完成工具调用（2 glob、2 read），没有写入/权限扩张 |
| 用量 | OpenCode 报告 input 15268、output 1444（含 reasoning）、cache read 12416，已归档到 Trace |
| 产物 | `artifact-run-949c6feb-03cc-4a60-9802-4edc30983830-clarification`，澄清 v1 |
| 仓库证据 | 4 条事实、3 条引用；README.md 与 package.json 的内容 digest 逐一与真实文件比对通过 |
| 仓库不变 | 24 个受跟踪/未忽略文件的 SHA-256、Git HEAD 和 status 与运行前完全相同 |
| Workflow | 成功入库后 `v1 / clarifying` → `v2 / paused_at_gate`；当前为需求确认 Gate |
| 界面 | Gate 正常显示 Raw Request、Repository Findings、Clarification Revision 三者绑定；Gate 要求后续审查，未自动批准 |
| 失败保留 | 第一轮 `evidence_invalid` Trace 保留；失败时没有澄清产物，也没有推进 Workflow |

该验收覆盖 #56 的 UI → Main → OpenCode → 真实 DeepSeek → 只读仓库取证 → 校验 → Artifact/Trace 入库 → 需求 Gate。它不等同于再次执行本需求的开发、测试和 PR 交付；README 未被修改。

### 回归及新增问题

- 最终 `corepack pnpm verify`：262 个测试文件 / 3702 个用例、typecheck、跨平台检查全部通过；Desktop production build 通过。受控用例覆盖凭据过滤、精确绑定、轮换、解密失败、模型 provenance、完整工具/用量统计、错误引用结构及既有 Stage/Gate 行为。
- [#81](https://github.com/erich04/ai-devflow-studio/issues/81)：OpenCode 真实 token 还未进入费用汇总，未知金额可能显示为零；不阻塞本次澄清，费用交互已向用户提问，保持打开。Trace 中明确标注金额未由 DevFlow 结算。
- [#82](https://github.com/erich04/ai-devflow-studio/issues/82)：真实 provenance 的开始/完成时间相同但 duration 为 9861ms。已修复 Main 过早固定完成时间和 shared 复用开始时间的问题；可控时钟测试先失败（完成时间早 10 秒），修复后通过。历史证据不重写。
- 原有 #60、#61、#63、#65 已随 PR #80 合并并关闭。其余未确认的交互不在本次变更内。


## Web 批次：#51、#53、#54、#58、#59

用户已确认按交互提案分批实施。本批次起点为 PR #83 合并后的 `dbc5f62`，分支 `codex/web-ux-batch-20260910`。

### 原因与修改

- #51：新 Studio 写死浅色 token，旧页面“跟随系统”按钮没有动作。新增共享三态控件、浏览器持久化和首屏前初始化；两套页面的背景、控件、状态与图表使用语义 token。系统主题变化由 CSS 响应。浏览器回归另复现退出登录从 `127.0.0.1` 跳到内部 `localhost` 导致偏好丢失；Logout 改用固定同源相对跳转，保留会话清除和错误处理。
- #53：缺少相邻主卡的 1320px 宽度上限，空列表仍占第三列。统一宽度/对齐；将创建反馈和空状态置于表单下方；有请求时显示独立列表，1120px 以下列表跨行，760px 以下单列。
- #54：代码与两个按钮共用一行，压缩了代码宽度。现在代码占整行，按钮在下一行并允许自然换行；撤销使用危险色，保留一次性代码的完整复制、撤销、过期时间及错误反馈。
- #58：原两个 Server Action 都仅保存、不返回结果、不刷新。两页面复用同一组件与 Action，保存前检查云端状态，保存后重读 API 并刷新两页面。显示策略名称、来源、版本、阻断规则数和更新时间；交付评估计数单独标明。重复提交受保护；已经应用时不会重复写入；结果不确定时提供只读重试，避免盲目再次保存。Owner 权限和策略内容由 API 保持约束。
- #59：`SupportPanel.action` 改为可选；Policy 不再渲染指向自身的操作链接，其他卡片入口保持原行为。

### 证据与边界

- 首轮页面回归可复现主题入口/策略摘要缺失；Logout 原实现的浏览器回归明确失败于同源 URL 和主题恢复断言。
- `corepack pnpm test:e2e`：25/25 通过，其中本批新增 8 项。六种 CSS 视口为 390、760、1120、1440、1920、2560px；空/有请求、浅/深色共归档 36 张组件截图。宽度、对齐、代码与按钮分行、最小可用宽度、页面无横向溢出均通过几何断言。
- 测试运行器使用独立端口与 seed API，并为该临时进程生成专用会话签名密钥。请求创建与策略应用通过真实 Next 页面 / Server Action / API；仅视觉用配对码使用受控占位串，不截图真实配对秘密。该批是 Web 功能回归，不作为新的真实 Provider 全流程验收。
- CUA 在现有真实 Web QA 页面核对：新旧页面均显示云端 `Recommended enforcement preset / v1 / 4 条 / 2026-09-02T16:10:06.018Z`；已应用按钮禁用。请求主卡与 GitHub Delivery 均宽 1320px、左边界一致；深色偏好刷新和跨页保留。现有组织策略未被测试改写，浏览器主题及临时视口已恢复。
- 14 项新增状态测试覆盖首屏恢复、存储异常、跨标签偏好、重复提交、已应用判定、权限失败、读回失败、并发改变策略和只读重试。最终 `corepack pnpm verify` 的 typecheck、265 文件 / 3718 用例及跨平台检查全部通过。云端检查与关闭信息在交付后补充。


### Web 批次云端交付

[PR #84](https://github.com/erich04/ai-devflow-studio/pull/84) 已于 2026-09-10 12:36 UTC 合并，main commit `d7e62f924b2bbc0f761bc4d10722147905a1db7c`。源提交 `607c3049371a3e81c5ebc73af7be361eb1e6edc4` 的 macOS verify、Windows compatibility、Postgres integration、Docker smoke、Docker lifecycle smoke 全部通过（Actions run `34476925750`）。#51、#53、#54、#58、#59 已关闭。

## Provider 管理批次：#55

按确认稿，在已有 Provider 选择器旁加入次级“管理”入口。确认框展示精确名称、ID、模型、遮罩凭据、相关项目名称/ID和删除影响；取消及 Esc 返回入口，确认后不自动选择其他 Provider。

- Main 在确认时重新检查活动 Stage / Review / Provider 配置操作；本地 OpenCode Stage 按实际项目配置持有 Provider 使用记录，原生缓存 Provider 每次调用也重新检查凭据是否存在。
- LocalStore 的同一持久化队列内重新读取项目配置、活动 Coding Run 和凭据版本。有引用则阻止，确认后凭据已变化则要求重新核对；删除和未选择状态一起持久化，写盘失败一起回滚。SQLite 开启 secure delete 清理已删除凭据所在页面，历史证据表保持原数据。
- 选择偏好保存在本地设置，显式未选择状态跨重启保留；新增凭据仍按既有流程自动选中，偏好写入失败单独解释已保存结果。最后一项被删除时焦点回到新增名称字段，仍有其他项时回到已有选择器。

### 本地验证

- `corepack pnpm verify`：268 文件 / 3733 用例、类型检查和跨平台检查通过。最终补充项目显示名称后，13 个相关用例及 Desktop typecheck 再次通过。
- `corepack pnpm test:e2e`：29/29 通过；新加入 1440×920、760×600 × 浅/深色，验证精确确认、Tab/Shift+Tab、Esc、焦点回收、不自动切换及无弹窗横向溢出，归档 4 张截图。
- `corepack pnpm test:electron-smoke`：完整通过。隔离临时 profile 中通过真实表单、preload、Main、SQLite 保存临时凭据，在 `webContents.setZoomFactor(2)` 下到达确认按钮并删除，再次启动检查凭据消失、选择为空。这是受控凭据测试，不是云端模型调用。
- CUA 对最终 production 构建真实验证：DeepSeek 的 3 个项目配置引用都被识别，确认删除禁用；取消恢复焦点。只创建测试项 `Temporary Provider QA 55`，ID `provider_d8795ddcd1934cd2ad6eacfbfc881f9e`，地址 `https://example.invalid/v1`，未调用模型。
- 经真实界面确认删除后，提示删除完成，选择为空，审查按钮禁用；完全重启后列表只有“未选择 Provider”和原 DeepSeek，测试项消失。核验结束后通过选择器主动恢复原 DeepSeek。未删除真实 Key，未推进 QA Run、执行 Coding 或改动 mini Agent 仓库。

本批次是 Provider 管理定向验收，不作为一次新的需求到 PR 全流程。剩余 #52/#57 的导航与设置布局、#64 的计数命名、#81 的未知费用展示已分别提出具体确认问题，未收到答复前不实施这些交互。

云端首轮 Windows 回归中，Provider 写盘失败回滚用例因对完整 SQLite Buffer 做递归对象比较而超过 5 秒（7200ms）。改用 `Buffer.equals` 做完整字节比较，保留同一断言强度，本地用例从约 1435ms 降为 55ms；5 个存储回归全部通过。产品代码未因此修改，云端对新提交重新执行全部检查。

### Provider 批次云端交付

PR #85 于 2026-09-10 13:23 UTC 合并，main `7b587e234a10ece7edf6e8862d471e4c4b015e1d`。源提交 `c1baec3486e5c8befb3a596b0fd41e7492a0b4ba` 的五项 CI（run `34481063201`）全部通过，#55 已关闭。

## Studio 和 Policy 批次：#52、#57（已交付）

用户已确认三项剩余交互。分支 `codex/studio-policy-52-57` 起点为 PR #85 合并后的 main。新增的三个页面回归用例首先全部失败，分别证明正常流程仍跳旧页面、缺少完整 Policy 设置、缺少团队总览。随后实现统一入口、在 Studio 创建和选择项目、预算配置及完整 Policy 编辑；服务端新增明确的默认回退 / 已保存来源标记。验证记录待本批完成后补充。

### Studio / Policy 原因、实现与本地证据

- 新 Studio 提供工作台 / 团队总览 / 设置；项目创建表单、预算操作迁出 legacy 目录并复用，成功返回真实 Project ID 后自动选择。旧 Route 只保留兼容重定向，旧表单和旧快捷 Policy 写入口已移除。首次本地登录直接进入 Studio。
- Policy 编辑展示全部十条规则、来源、名称、版本、更新时间和生效动作；Owner 预览后保存，Lead / Member 只读。API 和 Web 复用 shared 校验。新写入保持现有策略 ID、提升版本，并以同一事务内的组织锁和预期修订检查拒绝旧预览。保存后权威重读；未知结果只能重新读取后继续。
- API 的组织过滤层需同时传递策略来源，不能靠名称或 ID 推断是否持久化。初次浏览器验证发现过滤漏传，修复后 12 项浏览器回归通过。
- 冷启动时 SSR 已显示按钮但事件尚未就绪，快速点击预设可能无效；新增交互在挂载就绪后启用。截图工具的默认 caret 隐藏会在 React 初始化期间修改输入框 style，造成测试自身的 hydration 警告；独立 smoke 改用原始 caret 并等待入口就绪，最终浏览器 console / page errors 为空。
- 新增 #86：同一数据库 public 已迁移而新的 search_path schema 为空时，迁移检测误查 public，随后读取当前 schema 报 relation schema_meta does not exist。真实首轮失败已记录；检测改为遵循当前 search_path，与后续读写保持一致。迁移单元回归 15 项通过，已有 public + 全新 schema 的真实初始化随后通过。

可重复命令：`DEVFLOW_DATABASE_URL=<专用测试数据库> corepack pnpm test:studio-onboarding-postgres-smoke`。运行前准备 Desktop production build 和 Chromium；脚本创建并清理独立 schema、临时 Git 仓库与独立 Electron profile，不访问真实模型凭据。

该集成链路真实执行：空库首次登录 → Web 弹窗创建并选中新 Project → 创建一句话 Work Request → Web 配对码 → Electron Main 配对 / 本地持久化 → Inbox 领取并创建本地 Run → 默认 Policy v1 / warn → Web 预览并保存 Recommended v2 → 真实 Postgres 的同版本并发修改得到 200 / 409 → Electron 同步 remote_cache v3，同一 Gate 变为 blocked。Provider 调用为 0，本项是初始化和策略集成回归，不冒充真实模型全流程。

旧壳迁移清单：项目创建、配对、预算配置/审批、Policy 编辑、Review 操作均有 Studio 正式入口；成员/成本/最近 Run / 测试摘要迁入团队总览；Evidence Chain / Agent / Policy 交付摘要保留工作台。旧页面所有写操作已移除，无需保留诊断 Route；既有书签重定向 Studio，手册及截图已更新。

### 本批完整回归

- `corepack pnpm verify`：类型检查、269 测试文件 / 3747 用例、跨平台检查全部通过。
- `corepack pnpm test:e2e`：33/33 通过。含三尺寸 Studio 项目创建 / 自动选中 / 提交需求、双主题 Policy、Member 只读，以及既有 Desktop / Web 回归。
- `corepack pnpm test:electron-smoke`：完整通过（退出码 0），保留既有真实 Main / preload / SQLite、Workflow 与凭据管理回归。
- `corepack pnpm test:postgres-smoke`：专用 Postgres 实例完整通过；确认组织策略来源、版本及现有权限 / Gate / Delivery 行为。
- `corepack pnpm test:studio-onboarding-postgres-smoke`：已有 public 表 + 新空 schema 的完整初始化和 Web → Electron 同步回归通过，浏览器错误为 0；独立 schema、Electron profile 和临时仓库由脚本清理，截图保留在手册目录。

PR #87 的五项云端检查（macOS、Windows、Postgres、Docker、Docker lifecycle）全部通过，合并为 `d50f88d`；#52、#57、#86 已关闭。


## #64：计数与 Inspector 内容对应

复现：Gate 卡片按 Artifact.nodeId 统计，但 Inspector 按 node.artifactIds 展示关联产物；Evidence 又混合审查和全 Run 测试数据。新增用户路径回归先失败。

修复：所有节点统一“产物 / 测试证据 / 轨迹”，卡片计数可点击、可用键盘 Enter 激活并直达对应标签。卡片主按钮与三个计数按钮互为兄弟，避免嵌套按钮。产物和测试按当前 Run + 节点归属展示；关联上游审查资料单独标注，不重复计入产物数量。测试标签只列本节点真实 TestEvidence，交付引用的上游测试明确列出来源入口。Knowledge 引用保持独立，Gate 规则评估仍使用原有上下文。新增 Gate 轨迹入口，搜索也进入统一标签。标签在窄 Inspector 中换行排列，文字不拆成竖排。

本地 `pnpm verify`：269 文件 / 3748 用例、类型与跨平台检查通过。浏览器回归 37 项通过，含 1180 / 1834 × 浅深主题的计数导航、键盘激活、零结果、不重复报告与既有长内容滚动；截图验证后修正标签挤压并再次回归。此次浏览器用受控数据，不调用真实 Provider；真实模型全流程在最后一批后统一运行。

PR #88 合并为 `2bb4268786a9764c6907078958ea59d5f11a8cd2`，#64 已关闭。源提交 `c2b359a` 的五项检查全部通过（run `34494611759`）。首轮 Windows 在未修改的 Native/OpenCode 生命周期测试发生超时与 EBUSY，原提交重跑失败作业后通过；未降低断言或修改超时。

## #81、#89：Stage Agent 用量与当前价格

#81 的原因：OpenCode Stage 成功结果跳过 AgentTokenUsage，解析/引用校验失败时也丢失执行器已报告用量；顶部显示团队费用而非当前 Run。先以两项失败回归证明解析后失败会丢失用量，再补充独立记账、同版本云端同步与预算检查。

- 成功和结果验证失败均保存执行器真实用量，重试使用独立 ID；失败不生成成功产物或推进节点。缺失/部分用量明确标注，未知金额保存为 null，不冒充免费调用。
- 只有已验证官方 DeepSeek 绑定和完整 cache 数据使用峰值费率估算，保存价格快照；任意兼容网关上的同名模型不套用官方价格。Direct Stage / Review 未知模型也不再套用无关模型价格。
- 现有 Run summary 仅增加受限的记账投影。API 校验 Run/项目/用户、去重并拒绝同 ID 改账；同一 Run version 可以补传失败消费。Postgres v26 保存独立 JSONB 记账字段，并允许历史费用表保存 null。客户端在下一次预算判断前先上传消费；上传失败或已有未知金额均沿用阻断语义。
- 顶部显示当前 Run 的真实 tokens 和预计费用/金额待确认；测试证据、产物、轨迹仍遵循 #64 的节点归属。历史未记账 Trace 仅显示数据不完整，不重写、不追溯定价。
- #89：核对 DeepSeek 官方页面发现 2026-09-10 V4.1 Flash 更新，新增版本目录并保留旧快照。新公共名 `deepseek-flash` 与原 Flash 别名兼容，不改用户配置。官方未给 Flash 精确切换时刻，因此切换当日的未确认区间不定价。明确保存本次核验时间；Pro 的 9 月 14 日路由边界按官方明确时刻处理。详见 [价格目录](runtime-pricing-catalog.md)。

当前本地验证：`pnpm verify` 271 文件 / 3760 用例、类型和跨平台检查通过；浏览器 41 项通过；Electron smoke 通过。专用全新 Postgres 数据库完整 smoke 通过，真实 HTTP 验证同版本上传两次只计一次、null 费用持久化、改账 409、预算 unavailable / blocksRun。随后补充价格快照往返及总 token 溢出边界，5 项记账用例再次通过。

本轮真实模型全流程与云端交付尚在进行，#81、#89 暂不关闭。

首轮 CI 暴露两处旧测试契约：Docker lifecycle 对整行 JSON 的比对把新增空字段误作历史数据变化；packaged smoke 的受控 API 未实现现在预算前必需的 Run summary 上传。分别改为原字段逐字保留 + 新记账字段为空的独立检查，并补上具备身份/项目约束及去重的受控上传端点、两条 Stage 记账断言。真实 Docker lifecycle 升级/回滚验证已通过；没有放宽产品预算规则。

费用链路复核补上 Gate Review：新 Review 也标记实际 direct-provider 身份，用量保存与 Run summary outbox 入队在同一 SQLite 事务中完成，防止审查消费仅留本地。历史记录不加新标签、不重写。新增重启后 null 金额和待同步操作同时保留的回归，连同 Review / 项目同步共 283 项定向用例通过。打包后的 Desktop pilot smoke 已通过。

补充改动后全量 `pnpm verify` 再次通过：271 文件 / 3761 用例、类型及跨平台检查。当前真实链路的逐步证据、独立仓库/项目/请求 ID 和待处理事项见 [本轮全流程验证](final-live-e2e-2026-09-10.zh-CN.md)；在完成前 PR #90 保持 Draft，#81、#89 不提前关闭。新增 #91 是仓库绑定冲突反馈，界面文案正在等待确认。

最终构建再次通过 Desktop pilot smoke 和 v15 GitHub Delivery packaged smoke：真实安装包 Main + 新建临时 Postgres，离线模拟 GitHub，精确分支发布、一次 Draft PR、重启无重复效果、Acceptance completed、撤销阻断、持久化秘密泄漏计数 0。该项是受控交付回归，不作为真实 GitHub/Provider 全流程证据。
