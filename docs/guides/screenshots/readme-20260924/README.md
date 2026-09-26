<a id="populated-full-window-readme-screenshots--september-24-2026"></a>

# README 完整窗口截图与示例数据——2026-09-24

这些图片直接截取当时的应用界面，使用包含内容的 Payments API 演示项目。每张图片保留完整应用视口与导航；部分页面仅通过现有阅读区或页面滚动到相关内容。图片没有进行元素裁剪、拼接，也不是 AI 生成的产品设计图。点击可查看原始分辨率。

前四张图采集于提交 [`98985a5`](https://github.com/erich04/ai-devflow-studio/commit/98985a50a19b1c9ae61f27b137bee58e0197444d)。新增八张阶段/控制台截图采集于 [`bea4384`](https://github.com/erich04/ai-devflow-studio/commit/bea4384ebe800f63d33d185f525a862ed7f6a062)。两份检出中的应用代码均保持为 [`9895c34`](https://github.com/erich04/ai-devflow-studio/commit/9895c34cc4512a24c2ed9947f57e3dd2b829f64b)，桌面生产构建也使用该源码。[清单](manifest.json)记录了源码提交、采集尺寸、哈希与样例范围。

| 图片 | 完整视口 | 展示内容 |
| --- | --- | --- |
| [桌面工作台](desktop-workbench.png) | 1920 × 1280 | 四个已完成阶段、当前 PR 交付步骤、三张通过的测试结果卡片、Token/费用估算，以及带证据链接的对话。 |
| [流程概览](desktop-workflow-overview.png) | 2560 × 1600 | 六列阶段、任务/门禁/测试/交付/验收卡片、完成状态颜色、产物/轨迹数量、测试结果与独立会话栏。 |
| [方案 Gate 审查](desktop-gate-review.png) | 1920 × 1280 | 另一条等待方案 Gate 的 Run，部分完成的阶段进度、就绪计数、策略/审查检查、明确批准控件与设计风险讨论。 |
| [需求澄清](desktop-clarification.png) | 1920 × 1280 | 原始请求、展开的目标、验收标准、非目标、已完成阶段导航与已保存交付对话。 |
| [方案设计](desktop-design.png) | 1920 × 1280 | 幂等性设计、组件职责、数据库/缓存取舍、测试计划、发布顺序问题与评审对话。 |
| [开发实现](desktop-implementation.png) | 1920 × 1280 | 变更文件表和示例仓库的真实 Git 补丁，以及阶段进度和测试/交付讨论。 |
| [PR 准备](desktop-pr-preparation.png) | 1920 × 1280 | 人工编写的 PR 材料预览：变更文件、实际示例测试结果和尚未满足的交付前置条件。没有发布真实 PR。 |
| [Web 团队概览](web-team-overview.png) | 1920 × 1200 | 四名团队成员、项目费用估算、不同阶段的多条 Run 与三条脱敏测试摘要。 |
| [Web 工作请求](web-work-requests.png) | 1920 × 1080 | 三条已保存请求、填写但尚未提交的第四条请求、项目/Run 选择器与桌面配对控件。 |
| [Web 证据与评审](web-evidence-review.png) | 1920 × 1200 | 交付指标、八个流程节点、38% 完成度、评审摘要和未提交的人工决策意见。 |
| [Web 预算治理](web-budget-governance.png) | 1920 × 1200 | 已保存的月额度和预警阈值、演示用量、两条演示批准与填写中的批准草稿。 |
| [Web 团队策略](web-team-policy.png) | 1920 × 1600 | 已保存的策略 v2、内置 Recommended 规则动作、最低要求、修复指引与项目生效策略。 |

所有截图使用深色主题，保留完整应用视口。内容在应用已有面板内滚动；流程概览将节点阅读区滚到证据部分。Web 评审截图将页面滚到交付指标与证据链，同时保留完整视口和常驻导航。阶段图集通过现有展开控件打开产物。此前的空白桌面裁剪图和内容较少的 Web 截图已替换，目前共有七张 Electron 和五张 Web 截图。

<a id="demonstration-data"></a>

## 演示数据

桌面端使用一次性 Git 仓库、独立 SQLite 数据库和隔离的数据环境注册表。记录通过生产 LocalStore API 写入，明确作为示例历史，再由未经修改的 Electron 应用读取：

- **Health API：**示例将澄清、设计、实现和测试标为完成，当前步骤为准备 PR 交付。三条测试证据记录包含小型示例仓库中 14 项通过测试的真实输出。
- **支付幂等性：**设计已准备好评审，人工 Gate 尚未批准。
- **退款审计：**Run 位于开发实现阶段。
- **对账导出：**Run 位于方案设计阶段。

首批有 15 份产物；阶段图集增加一份 PR 材料预览，总计 16 份。此外还有 3 条审查记录、7 条阶段用量记录和 2 个已保存会话。流程状态、过往批准、设计/审查文字、用量估算和助手回复均为展示现有界面而编写的样例，不能证明发生过真实模型执行、真实消费或生产交付。会话提示标明示例回复的性质。

Health API 的示例测试不能证明生产就绪；对话明确指出设计中尚未实现的超时要求。实现截图包含这些示例文件的实际 `git diff --cached`。PR 预览仍是人工编写的演示内容，没有已批准的 Delivery Intent，也不是绑定提交、可直接发布的交付包。

桌面端保持本地、未配对模式，页头对此有明确显示。导入历史时产生的示例同步发件箱记录，仅从这份一次性样例数据库中移除。本次截图采集没有验证桌面配对或端到端同步。

Web 使用当时的 Next.js 应用，连接 API 明确启用的内存演示仓库。第一张概览图中，四条示例 Run 摘要、三条测试摘要和三条审查摘要通过正常的已认证 API 端点上传，身份为隔离的演示用户。新增 Web 截图使用独立启动器，在启动未经修改的 API 服务前，将完整的八节点 Run 图、产物摘要、事件和演示用量写入内存种子数组。测试与审查摘要仍走正常同步端点。因此这些图片展示的是已有历史数据下的 Web 渲染效果，不能作为桌面完整历史同步的覆盖证据。

正常 API 端点创建了三条工作请求、每月 $200/预警 $150 的预算策略，以及两条限额演示批准（$10 与 $5）。随后 Web 编辑器将内置 Recommended 策略保存为 v2。这些记录只存在于隔离演示 API 中，没有通过批准给真实模型充值或调用模型。第四条请求、评审意见和 $8 的批准表单均为未提交草稿。策略截图晚于评审截图；后者仍使用默认策略。

Web 还包含原有的 `run-health-001` 示例与其用量估算。展示的身份属于演示仓库，不是真实 GitHub OAuth 登录。设置界面显示 `NO RUN SELECTED`（未选择 Run）/`Waiting for sync`（等待同步），原因是设置页没有加载所选 Run；图中的预算和策略记录确实存在。

本次未使用既有用户工作区/数据环境、付费模型调用、生产记录或真实 GitHub 交付。没有为展示修改应用源码、DOM 文字、CSS 或截图像素。Next.js 开发指示器通过其自带的 **Preferences → Hide** 控件隐藏。

<a id="capture-procedure"></a>

## 采集步骤

1. 安装锁定版本的依赖，使用 `corepack pnpm --filter @ai-devflow/desktop build` 构建桌面端。
2. 使用一次性、已提交的 Git 仓库，以及独立的 `DEVFLOW_USER_DATA_DIR` 和 `DEVFLOW_DATA_PROFILE_REGISTRY_PATH` 路径。通过 `createLocalStore` 将上述示例历史导入该数据环境，用 `createWorkflowRunFromRequest` 创建合法流程结构，再调用 LocalStore 的产物、审查、用量、测试证据和会话方法。演示数据预置不能使用个人数据环境。
3. 执行三个示例项目测试命令，将标准输出、退出状态和耗时保存在 `TestEvidence` 中。明确区分编写的历史记录与实际执行的检查。
4. 启用演示/模拟运行时，启动已构建的 Electron。通过真实的阶段控件、会话页签、阅读页签和滚动面板选择要展示的视图。
5. 使用 `DEVFLOW_ENABLE_DEMO_DATA=true` 和 `DEV_AUTH_ENABLED=true` 启动隔离 API，取消数据库连接变量。Web 使用相同演示标志与对应 API URL。第一张概览图上传白名单中的 Run/测试/审查示例摘要；阶段图集则在服务启动前初始化进程样例数组中的完整演示图，再上传 `/api/sync/test-evidence-summary` 与 `/api/sync/agent-review-summary`。保留这一差别，不把预置流程图称为同步测试。
6. 使用上述限额示例填充 `/api/team/projects/p-payments/work-requests`、`/api/runtime/budget-policy` 和 `/api/runtime/budget-approvals`。浏览工作台、团队、预算及策略视图，通过预览/确认界面保存 Recommended 策略。使用产品主题选择器，并通过开发指示器自身的设置隐藏指示器。
7. 通过 CDP 将 Playwright CLI 连接到 Electron，Web 则使用其 Chromium 会话。设置表中视口尺寸，截取完整视口，不指定元素或裁剪范围。替换文档资产前检查每张 PNG。

<a id="verification-scope"></a>

## 验证范围

当时桌面生产构建通过；上一轮 README 更新的七份文档/界面测试文件通过，共 52 项测试。本次截图更新又运行了四份 README/指南测试文件，共 33 项通过。截图按完整窗口尺寸检查，哈希与 Markdown 图片链接另行核验。GitHub Markdown 渲染也已检查：12 张图片和三个折叠图集均可显示。另有 14 项示例项目测试，属于演示证据，不计入 DevFlow 回归测试。

当时已有的会话 Electron 冒烟脚本仍包含此前记录的过时 `节点详情` 页签断言，因此本次截图更新没有宣称该脚本通过。分栏阅读布局见[导航验证记录](../../../validation/workflow-navigation-20260924.md)。这些图片不能作为完整发布验收或真实提供方验收的结论。
