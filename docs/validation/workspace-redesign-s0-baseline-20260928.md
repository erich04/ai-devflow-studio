# 工作区改造 S0：首屏基线与待验证项核实

日期：2026-09-28。对应[工作区改造方案](../plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md)第 7 节的 S0 批次与 `.kiro/specs/workspace-redesign-s0/`。本次只新增测量脚本、样例与一条回归测试，没有修改产品代码。

## 结论

- 首屏基线已在真实 Electron 窗口中测得并入库：主基线（1440×742）的顶栏与状态条高 105px、含 12 个控件，节点状态摘要底部在 429px，默认页签首个正文区块在 487px，视口内 41 个控件，主区 8 种字号、最小 10px，空讨论栏占主区 35.5%。
- 32 个状态样例中，30 个能在隔离环境里按固定步骤重新制备并截图；等待 Web 审批与证据读取失败两种无法在离线桌面窗口中出现，已写明替代验证方式。
- 方案 2.3 节的 7 个待验证项都有结论。另有 6 项新发现（X1–X6），其中 X1（连接前调用过模型的任务，连接后上传以 `conflict` 失败）是数据路径缺陷，不在 S1 修。
- 结论已回写方案（第 5 版）：2.2 节“现状”列、2.3 节、6.4 节、6.5 节，以及 S1 的改动清单与验收。

## 环境与方法

| 项目 | 取值 |
| --- | --- |
| 代码 | `main` / `0518870`；分支 `feat/workspace-redesign-s0`。`apps/` 下唯一改动是新增的测试用例，桌面构建来自未修改的产品代码（`metrics.json` 中 `productCodeDirty: true` 即因这个测试文件） |
| 机器 | macOS arm64；屏幕 1920×1080，可用区域 1920×1050，系统缩放 2 倍 |
| 运行时 | Node.js 24.18.0；Electron 42.11.6（Chrome 148.0.7778.280）；加载构建产物，不依赖 Vite 开发服务器 |
| 隔离 | 每个样例新建临时用户数据目录、数据环境注册表与示例 Git 仓库；内存演示 Team API 运行在空闲端口，不连接数据库 |
| 模拟 | 需求与方案由 Deterministic Fake Provider 生成；编码用 fake 引擎，或 DevFlow Native 配合一直不响应的受控模型服务；讨论使用固定回答的受控模型服务。主进程拦截所有非本机请求，合成凭据不进入系统钥匙串 |
| 未覆盖 | 真实模型、远端发布、GitHub 交付、Postgres 团队仓储、Web 页面 |

测量口径见方案 2.2 节：只计视口内可见、未被滚动区域裁掉的控件；字号以文本节点为单位，只计视口内可见文本；测量前等待全局提示浮层消失。测量函数的自检页覆盖视口外文本、混合内容、隐藏元素和标签截断，7 项断言全部通过。

命令：

```sh
corepack pnpm baseline:workspace --out docs/validation/evidence/workspace-redesign-s0-20260928
corepack pnpm exec tsx scripts/workspace-baseline.mts --samples clarify-gate-warn --sizes 1440x742 --theme dark --out docs/validation/evidence/workspace-redesign-s0-20260928/variants/dark
corepack pnpm exec tsx scripts/workspace-baseline.mts --samples clarify-gate-warn --sizes 1440x742 --zoom 2 --out docs/validation/evidence/workspace-redesign-s0-20260928/variants/zoom200
corepack pnpm exec tsx scripts/workspace-baseline.mts --self-check
```

数据与截图在 [`evidence/workspace-redesign-s0-20260928/`](evidence/workspace-redesign-s0-20260928/)：`metrics.json` 为逐次测量，`manifest.json` 为样例清单与观察结果，`shots/` 为截图。S1 开发期间不带 `--out` 运行，结果写到被 git 忽略的 `outputs/`，不会覆盖这份基线。

## 首屏指标

样例 `clarify-gate-warn`：需求确认 Gate，策略仅警告，缺少门禁审查，未连接团队。三档内容区高度都是 742，只改宽度；1024 档低于产品窗口最小宽度 1180，由脚本在测量进程内临时放开。

| 指标 | 1440×742 | 1280×742 | 1024×742 |
| --- | --- | --- | --- |
| 节点状态摘要底部（状态行对照） | 429px | 429px | 480px |
| 默认页签首个正文区块顶部 | 487px | 487px | 538px |
| 顶栏与状态条总高度 | 105px | 105px | 149px（顶栏折行） |
| 顶栏与状态条中的控件 | 12 | 12 | 12 |
| 视口内可交互控件 | 41 | 40 | 38 |
| 主区字号 | 8 种，最小 10px | 8 种，最小 10px | 7 种，最小 10px |
| 空讨论栏 | 480px，占主区 35.5% | 480px，40.2% | 468px，49.9% |
| 被截断的阶段标签 | 第 6 阶段 | 第 5–6 阶段 | 第 3–6 阶段 |
| 「需求确认 Gate」／「当前步骤」／「实际当前节点」／「实际进度」 | 3／2／1／1 | 3／2／1／1 | 2／2／1／0 |

- 与 2026-09-28 走查对照：顶栏与状态条高度、控件数一致。视口内控件从 47 更正为 41：在同一页面上用旧规则计数仍是 47，多出的 6 个都被滚动区域裁掉，包括项目菜单里的任务行、阶段节点按钮和正文里的「查看原文」。首个区块从 502px 改为 487px，因为旧脚本量的是标题，现在量区块本身。字号从“10 种、最小 9.2px”改为“8 种、最小 10px”，差异来自排除了视口外文本。
- 深色主题下的数字与浅色相同（`variants/dark`）。
- 200% 页面缩放时 CSS 视口为 720×371：顶栏与状态条高 223px，占内容区 60%；节点状态摘要底部在 187px，主区只剩约 148px，看不到正文首个区块（`variants/zoom200`）。
- 开发实现及之后的节点页出现 9.17px 字号（`build-running`、`test-stage`、`pr-ready`、`acceptance`）。
- 提示浮层遮住讨论栏的新建与历史按钮（L4），见 `shots/clarify-gate-warn-toast-1440x742.jpg`。

## 状态样例

“方式”一栏：ui 为真实界面路径；ipc 为部分步骤直接调用桌面 IPC 快进；store 为在应用关闭时直接改写本地库；renderer 为只能在渲染层验证。按方案 8.3 节，ipc 与 store 样例只用于布局对比。除测试页的三种空态外，所有样例都用了模拟模型或模拟编码。

| 样例 | 状态 | 方式 | 截图 |
| --- | --- | --- | --- |
| `clarify-gate-warn` | 需求确认 Gate，仅警告，缺少审查（主基线；也是空讨论样例） | ui | 三档尺寸、提示浮层、深色、200% |
| `clarify-gate-suggestions` | 已有审查，3 条风险、1 条测试建议 | ui | 1440×742 |
| `clarify-gate-clean` | 已有审查，没有建议 | store | 1440×742 |
| `gate-enforced-block` | 团队策略强制阻断（缺少审查） | ui | 1440×742 |
| `upstream-waiting` | 浏览尚未开始的方案设计 | ui | 1440×742 |
| `clarify-history` | 需求 v1、v2，正在阅读 v1 | ui | 1440×742 |
| `design-gate` | 方案评审 Gate | ipc | 1440×742 |
| `build-running` | DevFlow Native 执行中 | ipc，瞬时 | 1440×742 |
| `build-permission` | 待处理的权限请求（约 60 秒过期） | ipc，瞬时 | 1440×742 |
| `build-interrupted` | 拒绝权限后中断 | ipc | 1440×742 |
| `test-stage` | 编码完成，进入测试节点 | ipc | 1440×742 |
| `pr-ready` | PR 草稿，等待准备交付 | ipc | 1440×742 |
| `pr-approval` | 等待 Web 审批 | renderer | 无；替代：App.test.tsx 中 `githubDeliveryIntentFixture("approval_required")` 的渲染用例 |
| `acceptance` | 业务验收节点（交付证据缺失） | store | 1440×742 |
| `test-no-repo`、`test-no-command`、`test-not-run` | 测试页：未选仓库、未配置命令、本任务尚未运行（D4） | ui | 1440×742 |
| `test-running`、`test-failed`、`test-timeout`、`test-stale` | 测试页：执行中、失败、超时（真实 120 秒）、通过后代码有新提交 | ipc | 1440×742 |
| `test-read-failure` | 证据读取失败 | renderer | 无；替代：S1 的 SupportViews 组件测试 |
| `team-unpaired` | 未连接团队，同步弹层（上传情况 1） | ui | 1440×742 |
| `upload-requeued` | 刚绑定，正在上传（上传情况 2；上传请求被暂时挂起） | ui，瞬时 | 1440×742 |
| `team-paired` | 已连接，上传结束 | ui | 1440×742 |
| `policy-unavailable-after-reload` | 已连接、未拉取时刷新窗口，策略不可用 | ui | 1440×742 |
| `team-existing-credential` | 已有凭据，输入框中是占位配对码 | ui | 1440×742 |
| `upload-target-other-project` | 记录目标是 X，凭据属于另一本地项目（上传情况 3） | ui | 1440×742 |
| `upload-no-credential` | 记录目标是 X，没有凭据（上传情况 4） | store | 1440×742 |
| `upload-target-unrecoverable` | 本地项目已改连到 Y（上传情况 5） | ui | 1440×742 |
| `upload-credential-invalid` | 凭据在服务端被撤销，上传被拒 | ui | 1440×742 |
| `discussion-messages` | 讨论有一轮问答 | ui | 1440×742 |

每个样例的方案条目、局限与观察记录见 `manifest.json`。“被跳过”只对工作流节点成立，测试证据没有这个状态，未单独制备。

## 待验证项的结论

| 待验证项 | 结论 | 所用样例与步骤 | 置信度 |
| --- | --- | --- | --- |
| 拉取后团队数据仍为空 | 不为空。经顶栏配对表单连接后立即拉取、等待上传结束后再拉取，两次都提示「拉取成功 · 策略 v1」，团队快照有 1 个项目、4 名成员、1 个任务、6 份材料（演示种子数据）。本地任务不在其中，原因见 X1 | `team-paired` | 高（内存演示 API） |
| D3 终止记录的错误码 | 没有任何凭据：`pairing_required`；其他本地项目已配对：`scope_mismatch`。两种都没有团队目标，`recovery` 为 `none` | `team-unpaired`；`upload-target-other-project` 后续检查中，B 已配对时在 A 新建任务 | 高 |
| A 的记录在 B 已配对时被处理 | 以 `scope_mismatch` 终止；再次连接 A 后仍保持终止，没有自动重排。A 的新任务下一次写入（生成需求澄清）时，入队合并把记录重新置为待上传，随后上传完成 | `upload-target-other-project` 后续检查 | 高 |
| 凭据过期时的错误码 | 以撤销令牌代替过期（API 对已撤销和已过期的令牌都返回空会话）：上传以 `unauthorized` 终止，团队目标保留，`recovery` 为 `none`。顶栏仍显示「已绑定」和当前身份 | `upload-credential-invalid`：连接并上传后，经 Team API 撤销该桌面令牌，再请求修订需求 | 中高：未等真实过期 |
| 同一团队项目重新配对是否撤销交付 | 会。新配对码返回的凭据只有 `createdAt`、`expiresAt` 不同，令牌 ID 相同；本地按整份凭据比较，因此判定为变化。提交时没有任何确认框 | `team-existing-credential` 后续检查；新增单元测试（见“验证”） | 高 |
| 撤销后 API 侧的交付请求 | 桌面端不通知 API，API 上的请求保持原状态 | 代码阅读：`github-delivery-processor.ts` 跳过已撤销意图，API 交付路由没有撤销入口。离线没有交付请求，未运行 | 中 |
| `githubDeliveryIntents` 是否含其他项目 | 含。`loadState` 不带条件列出全部交付意图 | 代码阅读：`local-store.ts` 的 `loadState`、`listGitHubDeliveryIntents`。未运行 | 高 |

## 新发现

| 编号 | 现象 | 依据 |
| --- | --- | --- |
| X1 | 连接团队之前已经调用过模型的任务，连接后重排的上传以 `conflict` 终止，团队数据里没有这个任务。阶段用量记在 `local-user` 名下，配对用户是 `u-ling`，内存仓储的 `uploadRunSummary` 拒绝用户不一致的用量。先连接再生成的任务上传成功 | `team-paired`、`upload-requeued`、`gate-enforced-block`；Postgres 仓储未核对 |
| X2 | 执行中只有跳到 Agents 页的「查看运行进度」，有权限请求时只有「处理 Coding Permission」；任务页首屏没有停止、批准或拒绝 | `build-running`、`build-permission` 的控件清单 |
| X3 | 顶栏徽标「已绑定 · 已同步／待同步」表示团队数据是否已拉取，状态条「同步失败／暂无待同步任务」表示上传队列，两者同屏矛盾；服务端已撤销的凭据仍显示「已绑定」 | `team-paired`、`build-running`、`upload-credential-invalid` |
| X4 | 已连接、未拉取团队数据时刷新窗口，策略评估为 `blocked_policy_unavailable`，Gate 显示「处理 Gate 阻断」和英文说明 | `policy-unavailable-after-reload` |
| X5 | 审查给出 3 条风险、1 条测试建议后，节点摘要为「Gate 已准备好，可以通过 · 警告 0」 | `clarify-gate-suggestions` |
| X6 | 测试证据不记录所测提交，工作树有新提交后仍显示「已通过」；测试页执行按钮在非测试节点也可点，点击后只提示不能执行 | `test-stale`；`SupportViews.tsx`、`useDesktopActions.ts` 的 `executeTestPlan` |

这些发现已登记在方案 2.3 节。X2–X5 和 X6 的显示部分并入 S1；X1 与 X6 的证据提交号需要改写入路径，另行处理。

## 验证

- `corepack pnpm verify`：通过。类型检查通过；312 个测试文件、4164 项测试通过（另有 1 个文件、15 项按既有配置跳过）；跨平台检查通过，已包含新脚本。仓库的类型检查不覆盖 `scripts/*.mts`，新脚本由 tsx 直接运行。
- `tsx scripts/workspace-baseline.mts --self-check`：7 项断言通过。
- 新增 `apps/desktop/electron/github-delivery-local-store.test.ts` 的两条用例：同一团队项目重新配对会撤销进行中的交付；保存完全相同的凭据不会撤销。
- 入库的 JSON 已检查，不含本机用户路径、令牌、配对码或合成 API Key；截图中的本机路径只有脚本创建的临时目录。
- 所有运行都在隔离环境中完成，结束后临时目录已删除。

后记（后续补记，正文不改）：X1 已在 S6 合入后修复。桌面端上传前把阶段用量的用户改为上传凭据的用户，服务端校验不变；同一台机器上重跑 `team-paired`，修复前以 `conflict` 终止，修复后上传完成，团队数据中可见该任务。说明见方案修订记录中的“X1 修复”。
