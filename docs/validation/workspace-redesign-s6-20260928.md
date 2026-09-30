# 工作区改造 S6：完整验收与文档

日期：2026-09-28。对应[工作区改造方案](../plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md) 7.6 节的改动清单（R1–R7）和 8.2 节的 S6 验收。分支 `feat/workspace-redesign-s6`，基于 S5 合入后的 `main`（`f0fad85`）。

## 结论

- 在隔离环境中跑完了改造后产品的完整验收（R1），覆盖桌面端、打包后的桌面端、打包后的 GitHub 交付和 Web。S4、S5 改过传参却没有运行的两个打包冒烟本批次补跑，都通过。
- 打包后的 GitHub 交付冒烟用一次性 Postgres 和离线的 GitHub 替代服务，走到了分支发布、Draft PR 与业务验收完成：Draft PR 1 个，重启后重复副作用 0，持久化密钥泄露 0，撤销绑定后交付被阻断。
- 剩余的英文文案已改为中文（R2），范围如下：
  - 桌面端：任务页的知识治理与引用来源区、团队请求列表。
  - Web：团队请求、配对码、预算、策略、项目创建与组织管理页面，以及 Web 代理路由返回的提示。
- 文档与截图按当前界面更新（R3–R7）：
  - 新截图目录：`docs/guides/screenshots/workspace-redesign-20260928/`。
  - README、部署指南，以及产品与工程文档。
  - 界面设计理由增加一节“当前界面结构”。
  - 历史指南只改横幅，正文不改。
- 验收中发现并修复了一处 S5 引入的回归：Web 侧栏去掉主按钮后，页脚被拉伸到整列高度。
- 首屏基线与 S5 相同（见下文）。
- **没有覆盖的**：真实模型调用、真实 GitHub 远端发布、签名安装包，以及 3–5 人的可用性走查。原因见“覆盖范围”一节。

## 覆盖范围：模拟模型、真实模型与远端发布

| 环节 | 本批次的覆盖 | 使用的替代 | 没有覆盖 |
| --- | --- | --- | --- |
| 需求澄清、方案设计、门禁审查 | Electron 冒烟、打包桌面冒烟、基线样例、e2e | Deterministic Fake Provider | 真实模型的内容质量与耗时 |
| 项目讨论（独立会话） | 会话冒烟：24 次模型调用 | 本机受控的模型服务，没有调用外部服务 | 真实模型 |
| 开发实现（编码、权限、测试） | Electron 冒烟（模拟编码引擎）、Native Coding 冒烟 | 模拟编码引擎；本机受控的模型服务 | 真实模型驱动的编码 |
| 桌面端与 Web 交接 | Electron 冒烟：同步后在 Web 直接打开任务详情；e2e 覆盖 Web 首屏、审批区、交付审批 | 内存演示 API | 一次运行中串联“桌面端生成 → Web 审批 → 桌面端执行”的远程审批（处理器、写入层与预检分别有测试，见 S5 报告） |
| PR 交付与业务验收 | 打包后的 GitHub 交付冒烟：分支只发布一次、不强制推送；Draft PR；业务验收完成；撤销绑定后阻断 | 一次性 Postgres；离线 GitHub 替代服务 | 真实 GitHub 仓库与 GitHub App |
| 发布包 | 本机打包的未签名 macOS 应用（`build:desktop-pilot`） | — | 签名、公证、安装器与 Windows 完整冒烟 |

DevFlow 不合并 PR，也不部署。报告和文档都没有宣称任何交付已经合并或上线。

## 8.2 节 S6 验收

| 场景 | 结果 | 依据 |
| --- | --- | --- |
| Draft PR 与业务验收各有依据，不宣称已合并或已部署 | 通过 | 打包后的 GitHub 交付冒烟：`draftPullRequests: 1`，`acceptance: completed`；交付恢复结果为 `draft_pr_created`；撤销绑定后为 `binding_inactive`。确定性交付门禁测试 5 项通过。README 与部署指南写明 DevFlow 永不合并 |
| 长内容、窄窗口下主要操作与正文都可到达，页面无横向溢出 | 通过 | 桌面端：长内容样例在 1024 与 1440 两档都无横向溢出，状态行的三个动作都可见（见“首屏基线”）；基线 32 个样例在三档内容区都无横向溢出。Web：e2e 覆盖 6 档宽度（最窄 390）并核对无横向溢出，文档截图脚本在 390 宽度同样核对 |

## 首屏基线

测量方法与 S3–S5 相同，只测三档内容区尺寸与浅色、深色主题。

```sh
corepack pnpm exec tsx scripts/workspace-baseline.mts --out docs/validation/evidence/workspace-redesign-s6-20260928
corepack pnpm exec tsx scripts/workspace-baseline.mts --samples clarify-gate-warn --sizes 1440x742 --theme dark --out docs/validation/evidence/workspace-redesign-s6-20260928/variants/dark
corepack pnpm exec tsx scripts/workspace-baseline.mts --self-check
```

- 32 个样例都完成，`--self-check` 通过。所有样例在三档内容区都没有横向溢出。
- 主基线 `clarify-gate-warn` 三档与深色主题：
  - 状态行底部 227.3px，首个正文区块 273.3px；
  - 顶栏 56px、4 个控件，视口内控件 28 个；
  - 字号 4 种、最小 12px。
- 与 S4 证据相比，24 个样例的位置指标下移 1px，其余 8 个相同，控件数与字号都不变。原因是采集用的显示器不同：本次缩放系数为 1，S4、S5 为 2，亚像素取整不同。依据是在同一台显示器上把 S5 合入后的代码（`f0fad85`）重跑主基线，结果同样是 227.3px / 273.3px（`variants/same-display-s5`）。所以代码没有改变首屏布局。
- **长内容**：`long-content` 样例用 60 字的任务名和约 575 字的需求，停在需求确认 Gate，在 1024 与 1440 两档测量（`variants/long-content`）。
  - 两档都没有横向溢出，也没有被截断的阶段标签，状态行与首个正文区块的位置和主基线相同，视口内控件都是 28 个。
  - 任务名在标题行按省略号截断，悬停显示完整名称（`title` 属性）；正文中的需求标题完整换行显示。
  - 状态行上的「运行门禁审查」「确认需求 v1」「请求修订当前版本」都可见。

## 截图

- 桌面端截图用基线工具在真实 Electron 窗口中拍摄，内容区 1440 × 900。新增的 `doc-tour` 样例只用于文档截图，不计入 32 个基线样例。
- Web 截图用默认跳过的 `tests/e2e/doc-screenshots.spec.ts` 拍摄，只有设置 `DEVFLOW_CAPTURE_DOC_SCREENSHOTS=1` 时才运行。
- 两部分都在隔离环境中，采集方法、源码提交与数据边界写在截图目录的 README 中。
- 原 `current-20260928` 目录标为改造前的历史截图，保留给历史指南引用。

## 与方案的差异

- R2 多改了两处：桌面端的团队请求列表（Work Requests → 团队请求，创建本地 Run → 创建本地任务），以及 Web 的项目创建与组织管理页面。
- 基线工具新增两个只在显式指定时运行的样例：`doc-tour`（文档截图）和 `long-content`（长内容验收）。默认运行仍是 32 个样例。
- 修复了 S5 引入的 Web 侧栏页脚拉伸（见“结论”）。

## 发现、留给后续批次

- 知识库底层优化：S6 之后以当前实现为基线另行立项（erich04，2026-09-28）。
- 桌面端设置／模型与执行方式的“启动前检查”仍显示英文状态 `Blocked`，并混有 “Implement locally” 等英文节点名；这些节点名来自工作流模板。
- 模拟运行时的正文（“Template design”“Fake coding run completed …”）和 Web 同步投影生成的步骤名（“Synced design node”）是英文。前者是测试替身的固定模板，后者属于 API 同步投影，都不是界面文案。
- 桌面端团队连接中配对码输入框的无障碍名称仍是 `Desktop pairing code`，可见标签是“配对码”。
- Web 截图左下角的 Next.js 开发模式标记只出现在开发服务中。
- 3–5 人的可用性走查（8.3 节）没有做：本批次无法招募未参与实现的人。也没有用自评代替。
- 工作区中有一组不属于本批次的未提交改动（Native Coding 执行器、会话服务及两个冒烟脚本）。本批次既没有提交它们，也没有修改它们。所有验收都在只含已提交代码的独立工作树中运行。

## 验证

验收在只含已提交代码的独立工作树（`git worktree`）中运行。`9f3e082` 与 `28444b3` 之间只差基线工具的长内容样例。

提交 `28444b3`：
- `corepack pnpm verify`：通过。类型检查（含 Web `next build`）通过；328 个测试文件、4466 项测试通过（1 个文件、15 项按既有配置跳过）；跨平台检查通过。
- `corepack pnpm test:e2e`：41 项通过，1 项跳过（默认跳过的截图采集脚本）。
- `corepack pnpm test:electron-smoke`：通过。
- `corepack pnpm test:workbench-conversation-electron-smoke`：通过，24 次受控模型调用，`externalProviderCalled: false`。
- `corepack pnpm test:native-coding-electron-smoke`：通过。
- 基线 32 个样例、深色主题与 `--self-check`：通过，见上文。

提交 `9f3e082`：
- `corepack pnpm build:desktop-pilot`（本机打包的未签名 macOS 应用），然后：
  - `corepack pnpm test:desktop-pilot-smoke`：通过，`hostileDevelopmentServerRequests: 0`。
  - `corepack pnpm test:v15-github-delivery-packaged-smoke`：通过。这项冒烟需要一次性 Postgres 容器，为此在本机启动了 Docker Desktop。
- `corepack pnpm test:v15-github-delivery`：5 项通过。
- 长内容样例：通过，见上文。

另外：
- 同一显示器上 S5 合入代码的主基线复测（`f0fad85`）：227.3px / 273.3px，见上文。
- 文档测试：`scripts/` 下全部测试通过（1 个需要 Postgres 的文件按既有配置跳过）。
- README 中的截图路径都指向存在的文件。

没有运行：
- `test:studio-onboarding-postgres-smoke`：需要真实 Postgres 与 Electron。本批次只更新了它的界面名称。
- `test:postgres-smoke`、`test:docker-smoke`、`test:docker-lifecycle-smoke`：由 PR 的 CI 运行。
- `test:stage-agent-design-electron`：自 #168 起在生成前失败，与本次改造无关（S3 报告已记录）。
