<a id="devflow-studio-v13-手动-walkthrough-指南"></a>

# DevFlow Studio v1.3 人工演练指南

> 历史版本流程：本文描述 V1.3 的候选与验收契约，保留原命令、界面按钮、截图及机器字段。当前部署和界面应查看现行指南；本文不授权新的付费模型调用。

更新时间：2026-07-31

适用版本：`v1.3.0` 候选提交 `C` 与验收提交 `S`；仓库候选标识：
`v1.3 delivery-flow candidate`

这份指南用于人工验证 DevFlow Studio 的端到端交付流程：从需求创建，到澄清/设计门禁，
再到编码、测试、PR 草稿、验收证据包。它描述的是目标通过路径，不代表当前主干已经
验收通过。实际发布状态只以 `docs/releases/v1.3.0/` 的四份证据、
`corepack pnpm release:status` 的对应模式结果和 `v1.3.0` 标签指向为准。

## 候选形成前历史快照（2026-07-31）

2026-07-25 的失败基线：
[2026-07-25 历史演练结果](./devflow-studio-v1.3-walkthrough-result-2026-07-25.md)。
该结果用于解释本轮收尾来源，不代表 2026-07-31 工作树已经完成新的电脑控制验收。

2026-07-31 已做一次隔离的电脑控制收尾演练：真实 UI 完成了工作流实例创建、需求澄清、
两次知识审查 / 门禁、模拟编码权限/代码差异和独立测试，随后在未绑定
本地项目 ↔ 团队项目时正确阻断 PR 草稿。由于点击 `绑定` 会创建桌面访问令牌，本轮没有在缺少当次操作确认时越过该边界。因此这次演练不是正式
`passed` 演练，也没有生成发布证据；在该历史快照中，正式验收仍须在
候选提交 `C` 上重跑
完整配对 → PR → 业务验收 → 团队同步 → 重启流程。

截至 2026-07-31，收尾工作树已经针对该失败基线完成以下实现校准：

- Electron 主进程使用共享可信命令推进 Agent、门禁、开发、测试、PR 和业务验收；渲染器
  不再提交自建 Run/交付产物。
- 工作流实例变更与本次产生的产物/事件/测试证据通过本地事务原子提交，并拒绝过期版本
  工作流实例。
- 开发必须有匹配的已完成的编码运行 + 代码差异，测试只有通过才进入 PR，PR 和业务验收
  都会核验上游证据。
- 配对显式绑定本地项目与团队项目；同 ID 的本地工作流实例/产物/事件在同步
  合并中优先保留。
- `DEVFLOW_ENABLE_FAKE_RUNTIME=true` 会显式提供确定性模拟 Agent 服务商，同时
  允许模拟编码引擎。
- 测试证据会先将已知 POSIX/Windows 工作区根目录替换为 `<workspace>`，再做密钥
  脱敏。

以上均为候选 `C` 形成前的历史状态，不是发布验收。该快照中，六个包已统一
为 `1.3.0`，本地 `verify:demo`、构建/产物、Docker 和 PostgreSQL 已通过；当时候选 SHA
绑定的 Windows 检查、新的完整电脑控制结果、真实付费 OpenCode 冒烟测试、证据提交和
`v1.3.0` 标签尚未完成。后续是否完成必须重新检查发布证据、`release:status` 和标签。

## 你会验证什么

- 从真实用户需求创建工作流实例，而不是克隆种子 Run。
- `clarify -> design -> build -> test -> pr -> accept` 六阶段在画布中可见。
- 门禁批准会沿工作流连线推进 `currentNodeId`，不会再把所有门禁都硬编码成
  `building`。
- PR 阶段可以生成本地 `PR Draft` 产物。
- 业务验收阶段可以生成 `Acceptance Bundle` 产物。
- 编码、测试证据、门禁策略执行、Agent 审查、预算、工具与技能轨迹仍保持
  v1.2 行为。

## 0. 启动前检查

```bash
# 从 workbench 根目录进入本 Project
cd projects/agent-engineering/ai-devflow-studio
corepack pnpm install
corepack pnpm verify
```

`release:status -- --mode=pre-tag` 不是候选 `C` 的启动前检查。它只在四份证据已提交到
干净的 `S`、且标签尚不存在时运行。

如果只是人工体验，可以先运行真实 Electron：

```bash
DEVFLOW_ENABLE_DEMO_DATA=true \
DEV_AUTH_ENABLED=true \
DEVFLOW_ENABLE_FAKE_RUNTIME=true \
DEVFLOW_CODING_ENGINE=fake \
corepack pnpm dev:electron
```

`DEV_AUTH_ENABLED=true` 只用于本机演示/CLI 请求头会话；任何可被其他主机访问的 API 都必须保持关闭。

通过标准：

- 打开的是真实 `AI DevFlow Studio`，不是 Electron 默认应用。
- 左侧能看到工作台、团队概览、知识、Agents、技能、MCP、测试。
- 模拟、无费用路径不产生真实模型费用。
- `DEVFLOW_ENABLE_FAKE_RUNTIME=true` 时，模型服务商列表出现
  `Deterministic Fake Provider`；运行需求澄清/方案设计/知识审查前明确选择
  它。关闭该标记后，旧模拟服务商选择必须隐藏或被拒绝。

![Electron 工作台](./screenshots/14-electron-current-userdata-workbench.png)

## 1. 选择本地仓库

在工作台的 `Local Project` 面板中选择当前项目根目录；从 workbench 根目录看，它是：

```text
projects/agent-engineering/ai-devflow-studio
```

通过标准：

- 本地项目名称和路径显示出来。
- 测试命令可以保存。
- 危险命令会被命令安全检查阻断。

<a id="11-正式走查的-team-project-绑定"></a>

### 1.1 正式走查的团队项目绑定

正式电脑控制走查可以把一次性配对码作为本地 API 测试前置条件创建。
对应端点是 `POST /api/team/projects/:projectId/pairing-codes`，调用者仍须具有该项目的
lead/owner 权限。

如果配对码由 API 测试前置创建，带日期的结果记录必须如实记录 `local API prerequisite`。
这只证明 API 能产生配对码，不能记录为 Web 配对 UI 通过。

电脑控制必须在真实 Electron UI 中亲自完成以下操作，不得用直接调用
配对交换 API 替代：

1. 确认已选中要绑定的本地项目。
2. 在 `Desktop pairing code` 输入框粘贴一次性配对码，点击 `绑定`。
3. 确认界面显示已绑定的团队项目，再点击 `同步团队`。
4. 关闭并重启同一隔离 `userData` 的 Electron，确认绑定仍存在并可再次同步。

通过标准：

- 配对必须将团队项目与当前 `localProjectId` 一起持久化。
- 配对码和交换后的 Bearer 令牌不得写入结果文档、截图、日志或发布 JSON。
- 重启后的同步仍使用已保存的绑定，不要求重新输入配对码。

<a id="2-从需求创建-run"></a>

## 2. 从需求创建工作流实例

点击顶部 `新建 Run`。

填写：

- 标题：`修复 webhook retry 失败边界`
- 一句话需求：`请澄清 webhook retry 的失败边界，设计最小实现方案，完成本地实现、测试、PR handoff 和验收证据。`

点击 `创建并开始澄清`。

通过标准：

- 工作流实例列表出现新标题。
- 新工作流实例的状态是 `clarifying`。
- 画布出现六个阶段：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收。
- 澄清节点的检查面板中出现 `Raw request` 产物，内容是你输入的需求。

<a id="3-gate-推进"></a>

## 3. 门禁推进

选择需求确认门禁，点击 `通过 Gate`。

通过标准：

- 当前节点推进到方案设计阶段。
- 工作流实例状态变成 `designing`。
- 临时提示显示门禁已通过或流程已推进。
- 不应出现旧行为：所有门禁批准都把工作流实例强行改成 `building`。

继续选择方案评审门禁，点击 `通过 Gate`。

通过标准：

- 当前节点推进到开发任务。
- 工作流实例状态变成 `building`。
- 开发任务才显示 `Coding Agent` 操作。

![工作台门禁策略执行](./screenshots/01-workbench-gate-enforcement.png)

<a id="4-coding-agent-与-test-evidence"></a>

## 4. 编码 Agent 与测试证据

选择开发任务，点击 `Coding Agent`。

默认模拟路径：

- 创建托管工作树。
- 产生权限请求。
- 在 Agents 视图批准权限。
- 生成脱敏差异产物。
- 生成依赖准备/测试证据。

通过标准：

- 编码 Agent 只从 `stage: build` 且 `kind: task` 的节点启动。
- 主仓库不被直接修改。
- Agents 中能看到权限、工具与技能时间线、代码差异、清理、终止状态。
- 只有匹配当前开发节点的编码运行已完成且代码差异已持久化后，可信
  `complete_build` 才把当前节点推进到测试。

![编码节点](./screenshots/09-coding-node.png)

选择测试节点或测试视图运行测试。

通过标准：

- 测试证据显示命令/状态/退出码/耗时。
- 输出经过脱敏，不应暴露密钥或完整本地敏感路径。
- 测试 IPC 只接收项目/Run/节点 ID；主进程必须拒绝非当前测试节点。
- 失败结果留在当前测试并将工作流实例标为 `failed`；重新执行并通过后才能推进到 PR。
- 产物中已知工作区根目录显示为 `<workspace>`；POSIX、Windows、文件 URL 和编码
  路径都要覆盖。

![测试证据](./screenshots/05-tests-evidence.png)

<a id="5-生成-pr-draft"></a>

## 5. 生成 PR 草稿

选择 PR 节点，点击 `生成 PR Draft`。

通过标准：

- 节点检查面板的产物列表中出现 `PR Draft:`。
- 内容包含：
  - 请求；
  - 变更路径；
  - 测试证据；
  - 策略；
  - 预算；
  - Agent 审查；
  - 安全的比较 URL，若仓库映射不安全则显示不可用。
- PR 草稿不包含原始补丁正文、原始标准输出/错误、模型服务商密钥或完整本地工作目录。

当前 v1.3 只生成 PR 交接产物，不创建真实 GitHub PR。

PR 草稿通过专用 IPC 生成；主进程会重新读取当前工作流实例、编码差异、测试证据、
审查、策略和预算。本地项目必须已经配对到明确的团队项目，仓库
来自该绑定项目的远端快照；未绑定或不匹配的旧凭据应在不确定时拒绝继续。

## 6. 生成验收证据包

选择业务验收节点，点击 `生成验收证据包`。

通过标准：

- 节点检查面板的产物列表中出现 `Acceptance Bundle:`。
- 内容引用：
  - 原始请求；
  - PR 草稿；
  - 变更路径；
  - 测试；
  - 策略；
  - 预算；
  - Agent 审查。
- 业务验收批准仍走门禁策略执行写路径，不因生成证据包自动通过。
- 非当前业务验收、缺失已完成的编码运行/代码差异、最新测试未通过或 PR 草稿未附着
  时，证据包命令必须被可信写路径拒绝，且不能留下孤立产物/事件。

<a id="7-final-acceptance-gate"></a>

## 7. 最终验收门禁

在业务验收节点点击 `通过 Gate`。

通过标准：

- 工作流实例状态变成 `completed`。
- 这是业务验收完成，不是自动合并或自动发布。
- 如果门禁策略执行阻断，必须先补证据或走合法覆盖审批。
- 最终验收只能在当前业务验收节点执行，并要求已关联的证据包、授权角色、
  非阻断策略、该业务验收节点的最新非阻断 Agent 审查，以及非阻断预算
  决定。任一证据缺失时应保持未完成。

<a id="8-team--budget--sync-回归检查"></a>

## 8. 团队 / 预算 / 同步 回归检查

打开团队概览和 Web 团队控制台。

通过标准：

- Web/API/Postgres 自托管路径仍可显示脱敏 Run/证据/审查/编码/费用摘要。
- 运行时预算策略/批准界面仍可用。
- 桌面配对和 `同步团队` 仍通过 Bearer 令牌工作。
- 配对请求必须包含当前 `localProjectId`，凭据保存本地 ↔ 团队项目绑定。
- 测试/审查/编码证据采用先上传子项的顺序；只有服务端明确返回正式 Run 缺失（`canonical-missing`）
  时，Electron 主进程才上传一次最新正式 Run 并重试该子项一次。跨项目、过期版本、
  作用域冲突或重试后仍无正式 Run 的写入被拒绝。
- 子项摘要 ID 只能在原组织/项目/Run/节点作用域内幂等更新；尝试重绑定到
  另一个节点、工作流实例或项目时返回 409，原记录保持不变。
- 只有正式 Run 摘要可以推进远端状态/当前节点。迟到的测试/审查/编码
  子项不得重新激活或阻断非当前节点，远端最多保留一个活动的当前节点。
- 独立负责人的门禁覆盖审批不重传创建者拥有的 Run；服务端以当前正式节点、确切阻断项集合、策略版本、成员角色和职责分离重新判定。Postgres 节点命名空间在求值时
  规范化，在已接受的审计记录的外键中恢复并保持幂等。
- 远端 Agent 审查必须携带重建确切阻断项 ID 所需的最小脱敏发现项；仅有计数的载荷 被拒绝。编码结构化元数据、费用/模型与预算/原因不得保留未知键、
  密钥或本地绝对路径。
- 合并远端快照时，本地同 ID 工作流实例/产物/事件保持权威，远端摘要只补充
  仅远端存在的数据。
- 关闭并重启 Electron 后，桌面端仍能读取同一本地 ↔ 团队项目绑定并再次同步。

若配对码由本地 API 前置创建，本次证据只能验收桌面端绑定、同步与重启持久化；
除非电脑控制另外真实操作并记录 Web 配对 UI，否则不得声称该 Web UI 已通过。

![Web 团队概览](./screenshots/08-team-overview.png)

<a id="9-release-only-真实-opencode--豆包volcengine-smoke"></a>

## 9. 仅发布时运行的真实 OpenCode + 豆包/Volcengine 冒烟

这一步会消耗真实模型服务商配额，不属于默认演练。

```bash
export ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"
export DEVFLOW_RUN_OPENCODE_SMOKE=1
export DEVFLOW_CODING_ENGINE=opencode-http
export DEVFLOW_OPENCODE_PROVIDER_ID=double
export DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest
export DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN

corepack pnpm opencode:status
corepack pnpm test:opencode-smoke

unset ANTHROPIC_AUTH_TOKEN DEVFLOW_RUN_OPENCODE_SMOKE DEVFLOW_CODING_ENGINE
unset DEVFLOW_OPENCODE_PROVIDER_ID DEVFLOW_OPENCODE_MODEL_ID DEVFLOW_OPENCODE_API_KEY_ENV
```

如果 `opencode` 不在 `PATH`，还必须在上述两条命令之前设置
`export DEVFLOW_OPENCODE_BIN=<absolute path to opencode>`。不得用 `ARK_API_KEY` 代替本走查约定的
`ANTHROPIC_AUTH_TOKEN`。

通过标准：

- 真实 OpenCode 权限转发通过。
- 捕获脱敏差异。
- 保存测试样例证据。
- 记录工具与技能时间线。
- 进程与工作树清理完成。
- 不泄露模型服务商密钥、原始工作目录、原始标准输出/错误、原始提示词、完整补丁。

任一前置检查缺失、进程/网络/模型服务商失败、权限转发未完成、无代码差异、无
工具调用/结果、测试证据未通过、清理未完成或脱敏检查失败，都不得把
`real-opencode.json` 写成 `status: "passed"`。

`real-opencode.json` 的完整格式与禁止字段见
[仅发布时执行的真实 OpenCode 服务商冒烟](../plans/release-only-real-opencode-smoke.md)。

<a id="10-人工-walkthrough-核对表"></a>

## 10. 人工演练核对表

发布验收使用两个提交：候选提交 `C` 包含产品代码、配置、文档和版本；其直接子提交
`S` 只包含三份发布 JSON 与 JSON 引用的带日期的演练结果。三份 JSON 的
`candidateSha` 都必须是 `C`；标签最终指向包含证据的 `S`。

电脑控制通过后，新建的结果记录必须命名为
`docs/guides/devflow-studio-v1.3-walkthrough-result-YYYY-MM-DD.md`。对应
`docs/releases/v1.3.0/walkthrough.json` 最少包含：

```json
{
  "targetVersion": "1.3.0",
  "candidateSha": "<C full SHA>",
  "status": "passed",
  "date": "YYYY-MM-DD",
  "method": "computer-use",
  "evidencePath": "docs/guides/devflow-studio-v1.3-walkthrough-result-YYYY-MM-DD.md"
}
```

对应 `docs/releases/v1.3.0/required-gates.json` 最少包含：

```json
{
  "targetVersion": "1.3.0",
  "candidateSha": "<C full SHA>",
  "status": "passed",
  "gates": {
    "verify": "passed",
    "windows-compatibility": "passed",
    "e2e": "passed",
    "electron-smoke": "passed",
    "postgres-smoke": "passed",
    "docker-smoke": "passed",
    "build": "passed",
    "build-output-smoke": "passed"
  }
}
```

带日期的结果记录必须写明配对码的来源、电脑控制完成的桌面端绑定/同步操作、
重启持久化结果，以及 Web 配对 UI 是否真正被操作。不得记录配对码或令牌。

`S` 中不得加入额外截图或日志文件。`C..S` 必须恰好包含 `walkthrough.json`、
`required-gates.json`、`real-opencode.json` 和上述带日期的结果记录。先在无标签的干净 `S`
运行 `pre-tag`，通过后才可将 `v1.3.0` 指向同一 `S` 并运行 `tagged` 检查。

| 步骤 | 入口 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| 创建标签前状态 | 所在终端，提交 `S` | `corepack pnpm release:status -- --mode=pre-tag` | 干净工作区；`S^1=C`；证据绑定 `C`；`C..S` 仅含四个证据文件；标签尚不存在 |
| 创建标签后状态 | 所在终端，提交 `S` | `corepack pnpm release:status -- --mode=tagged` | 仅在 `pre-tag`通过并创建标签后运行；标签必须精确指向 `S` |
| 桌面启动 | 终端 | `corepack pnpm dev:electron` | 打开 AI DevFlow Studio，不是默认应用 |
| 配对前置条件 | 本地 API 测试设置 | 为目标团队项目创建一次性配对码 | 只记录来源，不记录配对码/令牌，不声称 Web UI 通过 |
| 桌面配对 | Electron 顶栏 | 电脑控制输入配对码，点击 `绑定` 和 `同步团队` | 绑定包含当前 `localProjectId` |
| 请求接收 | 工作台 | 新建工作流实例并输入需求 | 创建 `raw_request` 产物；工作流实例从 `clarifying` 开始 |
| 工作流推进 | 门禁节点检查面板 | 通过需求确认 / 方案评审门禁 | `currentNodeId` 推进；Run 状态对应下一阶段 |
| 编码 | 开发任务 | 点击编码 Agent 并批准权限 | 托管工作树 + 代码差异 + 测试证据 |
| PR 草稿 | PR 节点 | 点击 `生成 PR Draft` | PR 草稿产物出现，含差异/测试/策略/预算/审查摘要 |
| 验收证据包 | 验收节点 | 点击 `生成验收证据包` | 验收证据包产物出现，引用 PR 草稿和证据 |
| 验收批准 | 验收节点 | 点击 `通过 Gate` | 工作流实例已完成；任何阻断都必须先修复，本次不得记为通过 |
| 团队同步 | 桌面端 | 完成后再同步 | 远端只收到脱敏摘要，本地完整工作流实例保留 |
| 重启持久化 | Electron | 关闭并以同一隔离 `userData` 重启 | 绑定和完整工作流实例仍在，再次同步成功 |
| 真实 OpenCode | 终端 | 由环境变量显式启用 `test:opencode-smoke` | 仅在接受真实费用时执行 |

<a id="签核过程中的宣称边界"></a>

## 验收过程中的宣称边界

- 只有干净的 `S` 的 `pre-tag`与 `tagged` 检查均通过、且 `v1.3.0` 标签精确指向 `S` 后，
  才能宣称 v1.3 已完成正式验收并发布。
- 2026-07-25 的失败结果是历史基线，不能替代绑定候选 `C` 的新电脑控制结果。
- 不要说 Windows、Postgres、Docker、全部 CI 或绑定候选提交的发布证据已通过，
  除非它们已在同一候选 SHA 上实际运行并记录。
- 候选 `C` 的验证工作流（含 `windows-latest`）与验收 `S`/标签的发布工作流都必须成功，
  才能作为远端发布验收证据。
- 不要说仅发布时运行的真实 OpenCode 已通过，除非得到付费调用授权并完成记录。
- 如果配对码由本地 API 前置创建，不要说 Web 配对 UI 已通过。
- 不要在 `pre-tag`验收完成前创建或宣称 v1.3 标签。
- 不要说 v1.3 已创建真实 GitHub PR。
- 不要说系统会自动推送、合并或自动通过门禁。
- 不要说真实 OpenCode 是默认 CI/验证路径。
- 不要说 MCP 真执行 / MCP 策略执行已完成。
- 不要说 RAG/向量检索已接入。
- 不要说 Windows Electron 完整冒烟已完成。
