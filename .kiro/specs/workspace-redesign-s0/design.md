# 设计文档：工作区改造 S0 基线与核实

## 概述

S0 新增一个测量入口脚本和几个辅助模块，复用现有 Electron 冒烟测试的启动与隔离方式，不新造启动器，也不引入新依赖。样例以“制备步骤”的形式入库，每次运行都在新的临时环境中重新制备。待验证项先由代码阅读得出初步结论（见“待验证项的初步结论”），S0 执行时逐项运行确认。

## 现有基础

2026-09-28 核对。

| 需要 | 现有做法 | 位置 |
| --- | --- | --- |
| 启动 Electron | Playwright `_electron.launch({ args: ['.'], cwd: 'apps/desktop' })` | `scripts/electron-smoke.mjs` 的 `launchApp` |
| 渲染层 | 不设 `VITE_DEV_SERVER_URL` 时加载构建产物 `apps/desktop/dist/index.html` | `apps/desktop/electron/renderer-entry.ts`；`main.ts` 创建窗口处 |
| 构建 | `corepack pnpm --filter @ai-devflow/desktop build` | `scripts/electron-smoke.mjs` |
| 数据隔离 | 同时设置 `DEVFLOW_USER_DATA_DIR` 和新的 `DEVFLOW_DATA_PROFILE_REGISTRY_PATH`；只设前者可能与已选数据环境冲突 | `apps/desktop/electron/desktop-data-profile.ts` |
| 演示 Team API | `corepack pnpm --filter @ai-devflow/api dev`，设置 `DEVFLOW_ENABLE_DEMO_DATA=true`、`DEV_AUTH_ENABLED=true`、`DEVFLOW_SESSION_SECRET`、`PORT`，并置空 `DATABASE_URL`、`DEVFLOW_DATABASE_URL`，使用内存存储 | `scripts/electron-smoke.mjs`、`scripts/native-coding-electron-smoke.mjs` |
| 模拟运行时 | `DEVFLOW_ENABLE_FAKE_RUNTIME=true` 提供 Fake Agent Provider；`DEVFLOW_CODING_ENGINE=fake` 启动后直接进入权限请求 | `apps/desktop/electron/agent-provider-runtime.ts`、`coding-engine.ts` |
| 选择仓库 | 在主进程替换 `dialog.showOpenDialog` | `.tmp/ui-review/electron-walk.mjs`（本机临时材料） |
| 窗口尺寸 | `BrowserWindow.setContentSize`；窗口默认 1440×920，最小 1180×760；没有自定义菜单，默认菜单可缩放页面 | `main.ts` 创建窗口处 |
| 配对码与策略 | `createSmokePairingCode`、`saveRecommendedEnforcementPolicy`、`saveAgentFindingBlockingPolicy`，以及签名会话 Cookie | `scripts/electron-smoke.mjs` |
| 直接写入 | `LocalStore` 的 `saveRun`、`saveArtifact`、`saveAgentReview`、`saveTestEvidence`、`saveWorkbenchConversation` 等 | `apps/desktop/electron/local-store.ts` |
| 渲染层夹具 | `desktopState`、`remoteSyncOperation`、`githubDeliveryIntentFixture`、`installDesktopApi` 等 | `apps/desktop/src/App.test.tsx` |

临时脚本 `.tmp/ui-review/electron-dump.mjs` 有四个问题，入库时修正：

- 字号取 `main *` 中没有子元素的元素，只要求高度大于 0。这会计入滚出视口的文本，并漏掉混合内容元素中的文本。
- 依赖外部已启动的 Vite（5173）与 API（4310），可能与开发环境冲突，也可能读到别的数据。
- “首个标题”取 `main` 中第一个 h1–h3，不等于默认页签的首个正文区块。
- 请求 1440×900，实际得到 1440×742，脚本没有检查。

## 架构

```text
scripts/workspace-baseline.mts                 入口：参数、逐样例逐尺寸运行、写输出
scripts/workspace-baseline/environment.mts     临时目录、示例仓库、API、受控模型服务与 Electron 的启动和清理
scripts/workspace-baseline/measure.mts         测量入口，把页面内函数以源码文本交给 page.evaluate
scripts/workspace-baseline/measure-in-page.js  页面内测量函数，纯浏览器 JavaScript，只读 DOM
scripts/workspace-baseline/samples.mts         样例定义与制备步骤
scripts/workspace-baseline/self-check/         测量自检用的静态页面与最小 Electron 入口
```

页面内函数不写成 TypeScript：tsx 会给具名函数注入页面中不存在的 `__name` 辅助函数。同理，样例里传给 `page.evaluate`、`app.evaluate` 的回调不声明具名内部函数。

用 `tsx` 运行 `.mts`，与 `scripts/stage-agent-design-contract.mts` 相同：后者在 Node 中直接引入 `apps/desktop/electron/local-store.ts` 的 `createLocalStore` 和 `packages/shared/src/index.ts`，也能配合 `--electron` 启动 Electron。需要直接写入的样例在 Electron 关闭时用 `createLocalStore({ dbPath })` 写入隔离环境的数据库，写入前先确认数据环境解析出的数据库路径。

新脚本不得引用 `@ai-devflow/shared/fixtures`：`scripts/demo-fixture-boundary.test.ts` 会拦截非测试文件对演示夹具的引用。自检页面的目录因此不叫 `fixtures`。

package.json 增加：

```json
"baseline:workspace": "corepack pnpm --filter @ai-devflow/desktop build && tsx scripts/workspace-baseline.mts"
```

参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--samples` | 全部 | 逗号分隔的样例 ID |
| `--sizes` | `1440x742,1280x742,1024x742` | 内容区尺寸 |
| `--theme` | `light` | `light` 或 `dark`，经 `DEVFLOW_INITIAL_THEME` 设置 |
| `--zoom` | `1` | 页面缩放，经 `webContents.setZoomFactor` 设置 |
| `--out` | `outputs/workspace-baseline/<时间>/` | 默认写到已被 git 忽略的目录；入库基线时显式指定 |
| `--keep-temp` | 否 | 保留临时目录，便于调试 |
| `--self-check` | 否 | 只运行测量自检 |

默认输出目录位于 `.gitignore` 已忽略的 `outputs` 下。S1 开发期间反复运行，不会覆盖入库的基线。

### 尺寸控制

1. 用 `app.evaluate` 取主窗口。目标尺寸低于 1180×760 时，先调用 `setMinimumSize`，只在本次进程内生效。
2. 调用 `setContentSize(w, h)`，等布局稳定后读取 `innerWidth`、`innerHeight`。
3. 实际值与请求不一致时，把该次测量标为 `invalid` 并记录实际值；报告不使用无效数据。

### 测量定义（measure.mts）

坐标以内容区左上角为原点，单位为 CSS 像素。

- **可见**：矩形与视口相交，宽高大于 0，计算样式的 `visibility` 不是 `hidden`，`opacity` 大于 0。
- **控件**：`button, a[href], [role="tab"], input:not([type="hidden"]), select, textarea, summary` 中的可见元素。输出标签名、角色、可读名称和矩形。
- **字号**：用 `TreeWalker` 遍历 `main` 下的非空白文本节点，用 `Range.getClientRects()` 判断可见性，取父元素的计算字号。输出去重后的取值、最小值，以及每种取值对应的文本节点数。
- **区域**：样例提供选择器表，脚本输出各区域的 top、bottom、height、width。改前与改后可以用不同的选择器：

  | 区域 | 改前 | 改后（S1 需提供） |
  | --- | --- | --- |
  | 顶栏、状态条 | `.topbar`、`.status-strip` | `.topbar`；状态条取消后记为 0 |
  | 状态行 | 节点头部 | `[data-testid="task-status-row"]` |
  | 首个正文区块 | `[role="tabpanel"]` 中第一个可见的块级子元素 | 同左 |
  | 讨论栏 | `.workbench-workspace` | 同左 |
  | 阶段项 | 阶段导航中的各项 | `[data-testid="stage-item"]` |

- **当前位置表达**：统计可见文本中方案 2.2 节所列短语的出现次数，包括当前节点名、「当前步骤」「实际当前节点」「实际进度」。短语表随样例给出。
- **标签截断**：阶段项的 `scrollWidth > clientWidth`，或文本被 `text-overflow` 截断。

“节点头部”和阶段项在改前界面上的实际选择器，由 S0 执行时确认并写入样例定义。

### 样例

每个样例的定义包含：`id`、`planRefs`（对应的方案条目）、`method`（`ui`、`ipc`、`store`、`renderer`）、`simulated`、`transient`、`prepare(ctx)`、`selectors`、`phrases`、`limits`。

“冻结”指样例定义与制备脚本固定，不提交用户数据快照。快照里含绝对路径，配对令牌也由系统安全存储加密（macOS 为钥匙串），无法跨机器使用。

实际制备方式如下（2026-09-28 实施后更新；完整清单见 `scripts/workspace-baseline/samples.mts`，运行 `--list` 可列出）：

| 样例 | 状态 | 方式 | 要点 |
| --- | --- | --- | --- |
| `clarify-gate-warn` | 需求确认 Gate，策略仅警告，缺少门禁审查（主基线；同时是空讨论样例） | ui | 与 2026-09-28 走查同一路径：选择仓库 → 新建 → 生成需求澄清。另存提示浮层遮挡讨论栏的截图 |
| `clarify-gate-suggestions` | 已有审查，只剩非阻断建议 | ui | 从检查器进入 Agents 页运行门禁审查。Fake Provider 给出 3 条风险、1 条测试建议 |
| `clarify-gate-clean` | 已有审查，没有建议 | store | Fake Provider 总会给出测试建议；运行审查后在应用关闭时改写这条审查 |
| `gate-enforced-block` | 强制阻断 | ui | 写入“缺少审查即阻断”的团队策略，经配对表单连接并拉取团队数据。阻断原因是缺少审查 |
| `upstream-waiting` | 等待上游 | ui | 点击阶段导航中的方案设计 |
| `clarify-history` | 需求 v1、v2，阅读 v1 | ui | 经检查器请求修订后再次生成，在「内容与审查」中选择 v1 |
| `design-gate` | 方案评审 Gate | ipc | 经 IPC 审查并批准需求 Gate，生成方案 |
| `build-running` | DevFlow Native 执行中 | ipc | 模型请求发往一直不响应的受控服务 |
| `build-permission` | 待处理的权限请求 | ipc | fake 引擎启动即请求权限；约 60 秒后过期，制备后立即截图 |
| `build-interrupted` | 拒绝权限后中断 | ipc | 回复 `rejected` |
| `test-stage`、`pr-ready` | 测试节点、PR 草稿 | ipc | 批准 fake 编码的权限、运行测试、生成 PR 草稿 |
| `pr-approval` | 等待 Web 审批 | renderer | 需要 GitHub 替身，不在桌面测量范围 |
| `acceptance` | 业务验收 | store | 从 PR 草稿改写本地库进入验收节点 |
| `test-no-repo`、`test-no-command`、`test-not-run` | 测试页空态 | ui | 按仓库与命令配置区分 |
| `test-running`、`test-failed`、`test-timeout`、`test-stale` | 测试执行结果 | ipc | 测试只能在测试节点运行，并在编码的托管工作树中执行。先快进到测试节点，改写工作树的 test 脚本，再在测试页点击执行。超时等待真实的 120 秒 |
| `test-read-failure` | 证据读取失败 | renderer | 现有代码没有这一事实来源 |
| `team-unpaired` | 未连接团队，同步弹层 | ui | 上传情况 1 |
| `upload-requeued` | 刚绑定，正在上传 | ui | 在主进程中暂时挂起 `/api/sync` 请求，使“上传中”停留到截图完成 |
| `team-paired` | 已连接，上传结束 | ui | 同时核实待验证项 1 |
| `policy-unavailable-after-reload` | 已连接、未拉取时刷新窗口 | ui | 策略不可用导致 Gate 阻断 |
| `team-existing-credential` | 已有凭据，准备重新配对 | ui | 截图中是占位配对码；后续检查提交真实配对码，记录没有确认框 |
| `upload-target-other-project` | 上传情况 3 | ui | 两个示例仓库都连接 p-payments；后续检查覆盖待验证项 2、3 |
| `upload-no-credential` | 上传情况 4 | store | 应用关闭时删除本地库中的凭据 |
| `upload-target-unrecoverable` | 上传情况 5 | ui | 在内存 Team API 中新建团队项目 Y 并改连 |
| `upload-credential-invalid` | 凭据在服务端失效 | ui | 经 Team API 撤销桌面令牌，代替过期（待验证项 4） |
| `discussion-messages` | 讨论有一轮问答 | ui | 受控对话模型服务，固定回答 |

注意事项：

- 启动时主进程会运行 `recoverInterrupted()`，配对后会唤醒上传、Gate 命令与交付调度器，直接写入的数据可能在启动后被改变。制备后先读回状态，与预期不符时把样例标为失败。
- 权限请求会超时，执行中状态也无法冻结，只能现场截图。
- 桌面进程的环境变量与 2026-09-28 的走查一致。已核实 `DEVFLOW_ENABLE_DEMO_DATA` 与 `DEV_AUTH_ENABLED` 不影响未连接团队的首屏。
- 每次启动都在主进程中替换 `safeStorage` 的异步加解密，并拦截所有非本机请求，与 Native 和会话冒烟测试相同：合成凭据不进入系统钥匙串，也不会有真实模型或外部网络请求。
- S1 会改动冒烟测试依赖的文案。样例步骤优先用角色与 test id 定位，少用文案。

### 输出

```text
<out>/
  metrics.json      每条记录：样例、尺寸、主题、缩放、是否有效、指标、控件清单
  manifest.json     样例清单：方案条目、制备方式、是否模拟、局限、结果
  shots/<样例>-<宽>x<高>[-dark|-zoom200].jpg
```

截图使用 `page.screenshot({ type: 'jpeg', quality: 85, scale: 'css' })`。页面缩放不是 100% 时，Playwright 截图会被裁切，改用 `webContents.capturePage()` 截取窗口，再缩放到内容区尺寸。样例可以用 `capture` 额外保存过程截图，例如提示浮层出现的瞬间。入库基线时：

- 报告：`docs/validation/workspace-redesign-s0-baseline-<YYYYMMDD>.md`，沿用 `docs/validation` 的现有格式；
- 数据与截图：`docs/validation/evidence/workspace-redesign-s0-<YYYYMMDD>/`。

写出前检查 JSON 和页面文本，不含配对码、令牌或 `/Users/` 之类的本机用户路径。

## 待验证项的初步结论

以下来自 2026-09-28 的代码阅读，是 S0 运行确认的起点。运行后的结论见[基线报告](../../../docs/validation/workspace-redesign-s0-baseline-20260928.md)，已写回方案 2.3 节。与下表不同之处：第 1 项的原因是 X1（上传 `conflict`），第 4 项以撤销令牌代替过期。

| # | 待验证项 | 代码阅读结论 | 依据 | 运行确认 |
| --- | --- | --- | --- | --- |
| 1 | 拉取后团队数据仍为空 | 可能为空且不报错。可能原因：上传是异步的，配对后立即拉取会早于上传完成；以 `scope_mismatch`、`unauthorized` 等终止的记录不会上传；API 按会话角色过滤项目；上传的摘要以团队项目 ID 作为 `projectId`，而任务列表按本地项目 ID 过滤，远端任务可能不显示在本地项目下 | `useDesktopActions.ts` 的 `syncRemoteTeamState`；`main.ts` 的 `loadRemoteSnapshot` 处理；`App.tsx` 的 `scopedRuns`；`apps/api` 的 team 路由 | 用正常配对表单连接，等上传记录完成后拉取，记录项目、成员、任务的数量和显示位置；再测一次配对后立即拉取。`mergeLocalAndRemoteSnapshot` 尚未阅读 |
| 2 | D3 的实际错误码 | 没有任何凭据时为 `terminal`、`pairing_required`、`recovery: 'none'`；其他本地项目已配对时为 `scope_mismatch`。状态条只要有 `terminal` 记录就显示「同步失败」，不看错误码和绑定状态 | `remote-sync-outbox-processor.ts` 的 `processClaimedOperation`；`App.tsx` 状态条的「同步」弹层 | 读取样例中记录的 `lastErrorCode` |
| 3 | A 未绑定期间的记录在 B 已配对时被处理 | 以 `scope_mismatch` 终止。检查顺序：有无凭据 → 凭据的本地项目是否一致 → 团队目标是否一致。之后连接 A 时，只重排同时满足五个条件的记录（属于 A、组织与团队项目为空、已终止、错误码为 `pairing_required`），这些记录不在其中。补充：同一 Run 下一次写入时，入队合并会把没有团队目标或目标一致的记录重新置为待上传，所以 `run-summary` 不一定要手动重试；测试证据等一次性记录仍需手动重试 | 同上；`local-store.ts` 的 `writeRemoteSyncOperation`；`main.ts` 的 `pairDesktop` 处理 | 按“连接 B → 修改 A 的任务 → 连接 A → 再修改 A 的任务”复现 |
| 4 | 凭据过期时的错误码 | 桌面端不检查过期，会带着过期令牌发出请求；API 返回 401，记录以 `unauthorized` 终止。此时团队目标已绑定，配对后不会自动重排 | `remote-sync-outbox-client.ts`（只查令牌与范围）；`packages/shared` 的同步失败分类 | 在专用数据中让令牌过期后触发上传，确认状态码与错误码 |
| 5 | 同一团队重新配对是否撤销交付 | 会。比较的是整份凭据 JSON，新凭据的令牌 ID、创建时间和过期时间都不同，所以只要已有凭据就会撤销，且不按项目过滤 | `local-store.ts` 的 `saveDesktopPairingCredential` | 补一条单元测试，不需要界面走查 |
| 6 | 撤销后 API 侧的交付请求 | 桌面端不通知 API。API 上的请求保持原状态，只在有人操作且已过期时才拒绝 | `apps/desktop/electron/github-delivery-processor.ts`；`apps/api` 的交付路由与仓储 | 重新配对后查询团队项目的交付列表，并尝试在 Web 审批旧请求 |
| 7 | `githubDeliveryIntents` 是否含其他项目 | 含。`loadState` 调用 `listGitHubDeliveryIntents()` 时不带条件，渲染层原样保存，只在选择检查器对象时按任务和节点过滤。P1 确认框可以直接从渲染层状态列出其他项目的进行中交付 | `local-store.ts` 的 `loadState`、`listGitHubDeliveryIntents` | 可选：两个本地项目各有交付时，读回渲染层状态 |

若第 3、4 项得到确认，方案 6.5 节“连接后会怎样”一列需要补充两点：`run-summary` 记录会在同一任务下一次写入时重新进入上传；凭据过期的记录以 `unauthorized` 终止，需要手动重试。

## 对 S1 的输入

- 为状态行、阶段项和页签面板加稳定的 `data-testid`（`task-status-row`、`stage-item`、`workspace-tabpanel`），同一脚本才能测量改后界面。
- D3、T4 的状态摘要按待验证项 2–4 的结论区分错误码与绑定状态；P1 确认框按第 5、7 项，从渲染层现有状态列出所有项目的进行中交付。

## 错误处理

- 参数无效（尺寸格式错误、未知样例）：立即退出并说明原因，不启动任何进程。
- 单个样例制备失败：记录到清单并继续其他样例，最终以非零状态退出。
- 尺寸不符：该次测量标为无效，不中断其他尺寸。
- 任何退出路径都在 `finally` 中关闭 Electron 与 API，并按参数清理临时目录。

## 测试策略

- **测量自检**：`--self-check` 在同一 Electron 中载入 `self-check/measure-page.html`，覆盖视口外文本、混合内容、隐藏元素、截断标签和已知字号，断言测量结果。
- **与旧数据对照**：主基线样例的顶栏与状态条高度（105px）、视口内控件数（47）应与 2026-09-28 走查一致；首个正文区块和字号的差异应能由测量方法的修正解释。
- **跨平台检查**：新脚本加入 `scripts/check-cross-platform.mjs`，随 `corepack pnpm verify` 运行。
- 不为测量脚本本身新增 vitest 用例：布局依赖真实渲染，jsdom 无法验证。第 5 项的撤销行为另补单元测试。
