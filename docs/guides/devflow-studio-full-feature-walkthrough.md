# DevFlow Studio 全量基础功能体验指南

更新时间：2026-07-31

状态：V1.3 历史指南，仅保留 V1.3 产品与发布语境。

适用版本：仅限 `v1.3.0` 历史体验，不是当前 V1.5 操作指南。

当前开发态的演示与冒烟测试入口见
[演示与冒烟说明](../engineering/demo-and-smoke.md)；候选绑定的 V1.5 GitHub 交付
验收见 [V1.5 GitHub 交付演练](./devflow-studio-v1.5-walkthrough.md)。
本历史指南不授权付费服务商冒烟。

这份指南用于体验 DevFlow Studio 已经落地的基础能力。它不是某一个版本的发布演练，而是按 V1.3 当时的产品入口把 v0.2 到 v1.3 的核心能力串起来：本地仓库、工作流实例/门禁、
知识、基于知识的门禁审查（Knowledge-Grounded Gate Review）、编码 Agent、测试证据、团队/Web、配对、预算、工具与技能轨迹、PR 草稿和验收证据包。

这里的知识是审查依据；审查对象是当前门禁、门禁条件和关联的阶段产物与证据。

本指南列出目标体验路径，不代表任何候选已自动通过验收。v1.3.0 的实际发布状态只以
`docs/releases/v1.3.0/` 的四份证据、`corepack pnpm release:status` 的对应模式结果和
`v1.3.0` 标签指向为准。

## 候选形成前历史快照（2026-07-31）

2026-07-25 的失败
电脑控制基线见
[2026-07-25 历史演练结果](./devflow-studio-v1.3-walkthrough-result-2026-07-25.md)。
在该快照中，收尾工作树尚未生成新的带日期的结果记录。

默认路径不调用真实付费模型。真实
`opencode` + 豆包/Volcengine 模型服务商冒烟测试是仅发布时运行的验证项，放在最后单独执行。
截至该历史快照，V1.3 收尾工作树已加入以下边界：

- 共享可信命令负责 Agent/门禁/开发/测试/PR/业务验收的顺序和证据检查；
- Electron 主进程从本地存储重载正式状态，并以事务提交工作流实例与候选交付证据；
- 配对绑定本地项目与团队项目，同 ID 本地状态在同步合并时保持权威；
- `DEVFLOW_ENABLE_FAKE_RUNTIME=true` 显式提供确定性模拟 Agent 服务商并允许
  模拟编码引擎；
- 已归档的测试证据将已知工作区根目录替换为 `<workspace>`；
- API/Worker 构建产物有隔离运行冒烟测试，验证/发布工作流覆盖构建/产物、E2E、
  Electron、Windows、Postgres 和 Docker 检查。

这些是当时的实现边界，不是发布结论。该快照中，新的电脑控制、完整候选检查、
真实 OpenCode 付费调用记录、版本对齐和标签尚未完成；后续是否完成必须重新检查发布证据、`release:status` 和标签。

## 0. 启动环境

在项目根目录运行：

```bash
# 从 workbench 根目录进入本 Project
cd projects/agent-engineering/ai-devflow-studio

DEVFLOW_ENABLE_DEMO_DATA=true \
DEV_AUTH_ENABLED=true \
DEVFLOW_ENABLE_FAKE_RUNTIME=true \
DEVFLOW_API_BASE_URL=http://127.0.0.1:4310 \
NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310 \
corepack pnpm dev:api
```

另开一个终端：

```bash
DEVFLOW_ENABLE_DEMO_DATA=true \
DEVFLOW_API_BASE_URL=http://127.0.0.1:4310 \
NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310 \
corepack pnpm dev:web
```

另开一个终端：

```bash
DEVFLOW_ENABLE_DEMO_DATA=true \
DEVFLOW_ENABLE_FAKE_RUNTIME=true \
DEVFLOW_CODING_ENGINE=fake \
DEVFLOW_API_BASE_URL=http://127.0.0.1:4310 \
NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310 \
corepack pnpm dev:electron
```

通过标准：

- API 健康检查可访问：`http://127.0.0.1:4310/health`。
- Web 控制台可访问：`http://127.0.0.1:4311`。
- Electron 窗口标题是 `AI DevFlow Studio`，不是 Electron 默认应用。
- 左侧能看到 `工作台`、`Team Overview`、`Knowledge`、`Agents`、`Skills`、`MCP`、`测试`。

![Electron 工作台](./screenshots/14-electron-current-userdata-workbench.png)

<a id="1-workbench本地仓库与六阶段-run"></a>

## 1. 工作台：本地仓库与六阶段工作流实例

入口：左侧 `工作台`

要体验：

- 选择本地仓库。
- 保存测试命令。
- 搜索工作流实例、产物与知识。
- 新建工作流实例，输入真实需求。
- 查看六阶段：`clarify -> design -> build -> test -> pr -> accept`。

建议输入：

- 标题：`修复 webhook retry 失败边界`
- 需求：`请澄清 webhook retry 的失败边界，设计最小实现方案，完成本地实现、测试、PR handoff 和验收证据。`

通过标准：

- 新工作流实例从 `clarifying` 开始。
- 节点检查面板能看到 `Raw request` 产物。
- 门禁批准会推进 `currentNodeId`，不会把所有门禁硬编码成 `building`。
- 开发任务才显示 `Coding Agent`。
- PR 节点显示 `生成 PR Draft`。
- 业务验收节点显示 `生成验收证据包`。

![工作台门禁策略执行](./screenshots/01-workbench-gate-enforcement.png)

<a id="2-gate-enforcement策略阻断补救"></a>

## 2. 门禁策略执行：策略、阻断、补救

入口：工作台节点检查面板的 `GATE ENFORCEMENT`

要体验：

- 选中门禁节点。
- 查看策略来源、版本（`version`）与同步时间（`syncedAt`）。
- 查看阻断或警告原因。
- 查看处理建议计划。
- 尝试在未满足策略时批准门禁。

通过标准：

- 阻断门禁不会只靠渲染器禁用按钮；Electron 主进程写路径也会拒绝。
- `blocked_policy_unavailable` 只阻止门禁批准，不阻止门禁审查、测试、编码等本地工作。
- 强制阻断时应显示处理建议，不显示覆盖审批逃生口。
- 已确认的覆盖审批和临时/被拒绝的覆盖审批的 UI 语义不同。

<a id="3-knowledge知识治理与引用"></a>

## 3. 知识：知识治理与引用

入口：左侧 `Knowledge`

要体验：

- Markdown 知识文档。
- 知识治理检查。
- 知识图谱。
- 检索/引用命中。
- 搜索 `api`、`test`、`security` 等关键词。

通过标准：

- 能看到标准、清单和 ADR 类知识。
- 治理检查是证据驱动；仅检索得到的引用不会自动满足证据。
- 节点检查面板里能看到当前节点关联的知识治理状态。

![知识](./screenshots/12-electron-knowledge.png)

<a id="4-门禁审查-agent审查tracefinding"></a>

## 4. 门禁审查 Agent：审查、执行轨迹、发现项

入口：工作台节点检查面板的“门禁审查”或左侧 `Agents`

`DEVFLOW_ENABLE_FAKE_RUNTIME=true` 时会列出 `Deterministic Fake Provider`，不花模型钱；
它适合本地演练和 CI，但不代表真实模型审查。运行前明确选择它；关闭该标记
后，旧模拟服务商选择必须隐藏或被主进程拒绝。

如果要让门禁审查 Agent 调用豆包/Volcengine Ark：

1. 打开左侧 `Agents`。
2. 在“门禁审查模型凭证”中确认：
   - 服务商名称：例如 `公司火山方舟`（内部 `providerId` 由系统生成并保持稳定）
   - 基础 URL：`https://ark.cn-beijing.volces.com/api/coding/v3`
   - 模型：`ark-code-latest`
3. 输入 API 密钥，点击 `Save and Use Provider`。重名或空名称会被明确拒绝。
4. 在“门禁审查模型 Provider”下拉框选择保存后的真实服务商，再运行“门禁审查”。

边界说明：豆包/Volcengine 只提供 OpenAI 兼容模型 API。DevFlow 自己组装门禁审查提示词、检索知识作为依据、运行治理检查，并解析结构化门禁审查结果；当前门禁、门禁条件与阶段产物或证据才是审查对象。门禁审查 Agent 不由 `opencode` 执行；`opencode` 只用于编码 Agent。

要体验：

- 选中一个门禁或开发节点。
- 点击“门禁审查”。
- 打开 `Agents` 查看门禁审查历史。
- 查看执行轨迹、Token 与费用、Agent 策略发现项、警告/阻断建议。

通过标准：

- 门禁审查生成可审计结果和产物。
- 模型服务商显示能区分模拟/无费用与真实/可能产生用量费用。
- 门禁审查发现项默认不会强制阻断。
- 门禁建议是否阻断由策略评估决定，不由 Agent 核心逻辑直接决定。

![Agent 工作台](./screenshots/04-agent-workbench.png)

<a id="5-coding-agentfake-默认路径permission-relaydiffworktree"></a>

## 5. 编码 Agent：模拟默认路径、权限转发、代码差异、工作树

入口：开发任务的 `Coding Agent`，然后左侧 `Agents`

要体验：

- 在开发任务点击 `Coding Agent`。
- 在 Agents 视图查看权限请求。
- 点击批准。
- 查看模拟代码差异、托管工作树、依赖准备/测试证据、终止状态。

通过标准：

- 编码 Agent 只允许从 `stage: build` 且 `kind: task` 启动。
- 渲染器不传提示词；编码任务说明由主进程与共享层从工作流实例、节点、产物、知识、策略、
  处理建议、测试证据组装。
- 主仓库不被直接修改。
- 差异产物只保存已脱敏、可供审查的内容。
- 清理状态可见。
- 开发只在匹配当前节点的编码运行完成且代码差异已持久化后推进到测试。

![编码节点](./screenshots/09-coding-node.png)

<a id="6-tool--skill-timeline可观测性"></a>

## 6. 工具与技能时间线：可观测性

入口：左侧 `Agents`

要体验：

- 查看权限时间线。
- 查看 `Tool / Skill Timeline`。
- 查看 `tool_call` / `tool_result`。
- 查看来源：`opencode_metadata`、`inferred` 或未来的 `opencode_event_stream`。

通过标准：

- 模拟引擎不应被误导成真实 OpenCode 技能调用。
- 如果缺少 `skillName`，UI 显示 `Unknown skill` 或推断标记。
- 本地事件元数据也必须脱敏，不保存原始标准输出/错误、原始提示词、模型服务商密钥、
  完整工作目录或完整补丁正文。
- 当前不能保证还原 OpenCode 内部私有技能调用栈。

<a id="7-tests本地测试证据"></a>

## 7. 测试：本地测试证据

入口：左侧 `测试`

要体验：

- 查看本地测试证据。
- 运行保存的测试命令。
- 尝试保存危险命令，例如 `rm -rf /`。

通过标准：

- 安全命令可以执行并生成测试证据。
- 危险命令被命令安全检查阻断。
- 证据显示命令/状态/退出码/耗时。
- 标准输出/错误摘要经过脱敏。
- 只有当前测试节点可以执行；失败测试保持当前并将工作流实例标为 `failed`，通过后才进入
  PR。
- 测试报告中的已知 POSIX/Windows 工作区根目录显示为 `<workspace>`；上传到团队
  的摘要继续省略工作目录和原始输出。

![测试证据](./screenshots/05-tests-evidence.png)

<a id="8-remediation--retry-coding"></a>

## 8. 处理建议 / 重试编码

入口：被策略/发现项阻断的节点的检查面板

要体验：

- 让门禁策略执行或 Agent 发现项产生处理建议计划。
- 查看处理建议候选项。
- 点击重试/编码相关操作。
- 在 Agents 里批准新的权限。

通过标准：

- 重试是人工批准，不自动绕过门禁。
- 每次重试都有记录。
- 编码任务说明带修复上下文。
- 团队/Web 只接收脱敏交付摘要。

<a id="9-pr-draft-与-acceptance-bundle"></a>

## 9. PR 草稿与验收证据包

入口：工作台的 PR 节点和业务验收节点

要体验：

- 在 PR 节点点击 `生成 PR Draft`。
- 在业务验收节点点击 `生成验收证据包`。
- 最后通过业务验收门禁。

通过标准：

- PR 草稿包含请求、变更路径、测试证据、策略、预算、门禁审查、安全的比较 URL。
- 验收证据包引用原始请求、PR 草稿、代码差异、测试、策略、预算、门禁审查结果。
- 当前 v1.3 只生成 PR 交接产物，不创建真实 GitHub PR。
- 系统不会自动推送、合并或自动通过门禁。
- PR 只在当前 PR 节点、已完成的编码运行/代码差异和最新通过的测试/报告都匹配时
  完成。
- 验收证据包还要求已附着 PR 草稿；最终验收再要求证据包、授权角色、
  非阻断策略、匹配且非阻断的门禁审查和非阻断预算决定。
- 被拒绝的可信命令不会留下孤立的交付产物/事件。

<a id="10-team-overview团队视角与-redacted-sync"></a>

## 10. 团队概览：团队视角与脱敏同步

入口：左侧 `Team Overview`，以及浏览器 `http://127.0.0.1:4311`

要体验：

- 桌面端团队概览。
- Web 团队控制台。
- 点击桌面端的 `同步团队`。
- 查看 Web 是否出现脱敏 Run/测试/审查/编码/费用摘要；内部 `Review` 类型在界面显示为“门禁审查”。

通过标准：

- Web 只显示脱敏摘要，不显示原始提示词、原始日志、工作目录、补丁、模型服务商密钥。
- 团队概览能展示项目、成员、成本、风险、交付摘要。
- API 种子数据模式可以用于本地演示；Postgres/Docker 是独立显式路径。
- 配对凭据必须绑定当前 `localProjectId` 与一个团队项目。
- 远端测试/审查/编码证据写入前必须先有同项目正式 Run；其中内部 `Review` 对应门禁审查。跨项目、
  过期版本或缺工作流实例的写入会被拒绝。
- 同 ID 的本地工作流实例/产物/事件优先于远端摘要，远端只补充仅远端存在的数据。

![团队概览](./screenshots/11-electron-team-overview.png)

![Web 团队概览](./screenshots/08-team-overview.png)

<a id="11-runtime-budget成本策略approval-retry"></a>

## 11. 运行时预算：成本、策略、携带批准重试

入口：Web 团队控制台的 `Runtime Budget`，以及桌面端 Agents/节点检查面板的预算执行轨迹

要体验：

- Web 查看运行时预算策略。
- Web 创建预算批准。
- 桌面端在编码 Agent 被预算检查器阻断时查看预计费用/当前费用/费用限额。
- 输入批准 ID 后重试。

通过标准：

- 付费服务商调用前先过预算检查器。
- 超预算且无有效批准时，必须在 `engine.start(...)` 前阻断。
- 桌面端传批准 ID，运行时/团队边界解析完整批准记录。
- 模拟/默认路径不花模型钱。

<a id="12-desktop-pairing-与-self-hosted-pilot"></a>

## 12. 桌面配对与自托管试点

入口：

- 本地 API 测试前置可调用 `POST /api/team/projects/:projectId/pairing-codes` 创建一次性配对码；调用者须有 lead/owner 权限。
- 桌面端顶栏：`Desktop pairing code` + `绑定`
- 自托管指南：[devflow-studio-self-hosted-pilot.md](./devflow-studio-self-hosted-pilot.md)

要体验：

- 可由本地 API 测试前置创建配对码，但不得把这记录为 Web 配对 UI 通过。
- 电脑控制在桌面端中亲自输入配对码，点击 `绑定`，然后点击 `同步团队`。
- 关闭并以同一隔离 `userData` 重启 Electron，再次同步。

通过标准：

- 桌面同步使用 Bearer 令牌，不回退演示请求头。
- 渲染器不接收明文 Bearer 令牌。
- 配对码是仅可复制一次且短期有效。
- 绑定持久化当前 `localProjectId` 和团队项目，重启后仍可同步。
- 结果文档和截图不记录配对码或令牌。
- Docker Compose 路径通过 `corepack pnpm test:docker-smoke` 验证，不属于默认 `verify`。

若配对码由本地 API 前置创建，本次证据只能验收桌面端绑定、同步和重启持久化；
除非电脑控制另外真实操作并记录 Web 配对 UI，否则不得声称该 Web UI 已通过。

<a id="13-skills-与-mcp"></a>

## 13. 技能与 MCP

入口：左侧 `Skills`、`MCP`

要体验：

- 查看技能目录。
- 查看 MCP 服务定义。
- 启用/禁用 MCP 服务。

通过标准：

- 技能/MCP 当前是管理壳和未来运行时扩展位置。
- MCP 开关本地持久化。
- 当前不启动真实 MCP 进程。
- 当前不要宣称 MCP 真执行或 MCP 策略执行已完成。

当前实测说明：技能显示未加载真实团队能力，MCP 显示未加载本地连接器；这两个页面当前
应按管理壳计，不按可用运行时计。

![MCP](./screenshots/07-mcp-management.png)

<a id="14-release-only-真实-opencode--豆包volcengine"></a>

## 14. 仅发布时运行的真实 OpenCode + 豆包/Volcengine

这一步会产生真实模型调用，不属于默认体验。

门禁审查的真实模型冒烟测试走 OpenAI 兼容模型服务商：

```bash
DEVFLOW_AGENT_OPENAI_API_KEY=... \
DEVFLOW_AGENT_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3 \
DEVFLOW_AGENT_OPENAI_MODEL=ark-code-latest \
corepack pnpm test:agent-live
```

这条冒烟测试验证门禁审查 Agent 能用真实豆包/Volcengine 模型返回结构化门禁审查结果。它不验证 `opencode`。

先检查本机运行时：

```bash
corepack pnpm opencode:status
```

确认要花真实模型服务商配额后，再运行：

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

通过标准：

- `opencode serve` 启动。
- 权限转发可见。
- 差异采集可见。
- 测试样例的测试证据通过。
- 进程与工作树清理完成。
- 不打印模型服务商密钥。

任一前置检查、权限、差异/工具证据、测试证据、清理或脱敏条件失败，
都不得生成 `status: "passed"` 的 `docs/releases/v1.3.0/real-opencode.json`。完整 JSON
格式见 [仅发布时执行的验收规则](../plans/release-only-real-opencode-smoke.md)。

## 15. 全量体验核对表

| 模块 | 入口 | 必看点 | 通过标准 |
| --- | --- | --- | --- |
| 桌面启动 | `corepack pnpm dev:electron` | AI DevFlow Studio | 不是 Electron 默认应用 |
| 工作台 | 工作台 | 六阶段工作流实例 | 请求创建工作流实例，门禁可推进 |
| 本地项目 | 工作台 | 仓库选择/测试命令 | 命令安全检查阻断危险命令 |
| 门禁策略执行 | 节点检查面板 | 策略/原因/处理建议 | 写路径不能绕过阻断 |
| 知识 | 知识 | 文档/图谱/引用/检查 | 检索不等于证据 |
| 门禁审查 | 节点检查面板/Agents | 门禁审查产物/执行轨迹/发现项 | 发现项不强制阻断 |
| 编码 Agent | 开发任务/Agents | 权限/差异/工作树 | 模拟路径可重复、主仓不改 |
| 工具与技能时间线 | Agents | `tool_call` / `tool_result` / 来源 | 技能缺失时显示未知/推断 |
| 测试 | 测试 | 测试证据 | 脱敏状态/命令/耗时 |
| 修复重试 | 节点检查面板/Agents | 重试记录 | 人工批准，不自动绕门禁 |
| PR 草稿 | PR 节点 | PR 交接产物 | 不创建真实 GitHub PR |
| 验收证据包 | 业务验收节点 | 验收证据包 | 最终门禁仍受策略约束 |
| 团队概览 | 桌面端/Web | 脱敏摘要 | 不上传原始仓库内容/日志/提示词/补丁 |
| 运行时预算 | Web/桌面端 | 策略/批准/重试 | 付费运行前阻断超预算 |
| 配对 | Web/桌面端 | 配对码/令牌同步 | Bearer 令牌不进渲染器 |
| 技能/MCP | 技能/MCP | 目录/服务开关 | 不宣称真实 MCP 执行 |
| 真实 OpenCode | 终端 | 仅发布时运行的冒烟测试 | 只在接受费用时执行 |

发布状态必须显式区分两个阶段：

```bash
# 创建 tag 前
corepack pnpm release:status -- --mode=pre-tag

# 仅在全部签核并创建 tag 后
corepack pnpm release:status -- --mode=tagged
```

## 版本验收的宣称边界

- 只有干净的 `S` 的 `pre-tag`与 tagged 检查均通过、且 `v1.3.0` 标签精确指向 `S` 后，
  才能宣称 v1.3 已完成正式验收并发布。
- 2026-07-25 的失败结果是历史基线，不能替代绑定候选 `C` 的新电脑控制结果。
- 不要说 Windows、Postgres、Docker、全部 CI 或绑定候选提交的发布证据已通过，
  除非它们已在同一候选 SHA 上实际运行并记录。
- 不要说仅发布时运行的真实 OpenCode 已通过，除非得到付费调用授权并完成记录。
- 如果配对码由本地 API 测试前置创建，不要说 Web 配对 UI 已通过。
- 不要在 `pre-tag`验收完成前创建或宣称 v1.3 标签。
- 不要说新 Web 壳已经闭环请求接收、门禁、配对和 Run 选择。
- 不要说真实 OpenCode 是默认 CI/验证路径。
- 不要说模拟引擎是真实模型服务商行为。
- 不要说当前能还原 OpenCode 内部私有技能调用栈。
- 不要说 v1.3 已创建真实 GitHub PR。
- 不要说系统会自动推送、合并或自动通过门禁。
- 不要说 MCP 真执行 / MCP 策略执行已完成。
- 不要说 RAG/向量检索已接入。
- 不要说 Windows Electron 完整冒烟已完成。
