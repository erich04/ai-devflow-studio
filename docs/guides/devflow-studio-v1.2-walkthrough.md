<a id="devflow-studio-v12-手动-walkthrough-指南"></a>

# DevFlow Studio v1.2 人工演练指南

> 历史操作脚本：适用于 V1.2，不是当前候选版的验收结果。保留原按钮标识和截图；当前部署应按[自托管试点指南](./devflow-studio-self-hosted-pilot.md)填写完整配置。付费冒烟仅适用于要求它的版本契约，不自动授权新增调用，V1.5 不要求额外付费冒烟。

更新时间：2026-06-21  
适用版本：`v1.2.0`

这份指南用于你亲自动手走一遍 DevFlow Studio 当前已经具备的主要能力。它不是测试报告，而是人工体验脚本：按顺序启动、点击、观察、核对。

## 你会验证什么

- Electron 桌面端本地工作台：仓库选择、工作流、门禁、知识、Agents、测试、编码。
- 门禁策略执行：策略来源、阻断原因、处理建议、覆盖审批状态。
- 策略驱动交付：从门禁原因 生成处理建议，再由人批准重试编码。
- 运行时可观测性：权限、工具与技能时间线、代码差异、测试证据、清理、终止状态。
- 运行时费用与预算：Web 管理预算策略和批准，桌面端使用批准 ID 重试。
- 团队试点：Web/API/Postgres 自托管、桌面配对、脱敏同步。
- 仅发布时运行的真实 OpenCode 冒烟：真实豆包/Volcengine 模型服务商路径，明确会消耗模型服务商配额。

## 先记住边界

1. 默认演练不花模型钱。Electron 默认模拟模型服务商 / 模拟编码引擎，可重复、可离线。
2. 真实 `opencode` + 豆包/Volcengine 冒烟测试会产生真实模型调用，只在你明确要验证发布验收运行时时跑。
3. 团队控制台展示的是脱敏摘要，不应该看到原始工作目录、原始标准输出/错误、原始提示词、完整补丁、模型服务商密钥。
4. 当前能观察 OpenCode 权限/工具转发；当前不能保证还原 OpenCode 内部私有技能调用栈。
5. V1.2 不是商业发行版：没有签名安装器、自动更新、Kubernetes、公开 SaaS、Windows Electron 完整冒烟。

## 0. 环境准备

在项目根目录：

```bash
# 从 workbench 根目录进入本 Project
cd projects/agent-engineering/ai-devflow-studio
corepack pnpm install
```

先跑基础检查：

```bash
corepack pnpm release:status
corepack pnpm verify
corepack pnpm build
```

如果 Playwright 首次缺浏览器：

```bash
corepack pnpm exec playwright install
```

<a id="1-打开真实-electron-desktop"></a>

## 1. 打开真实 Electron 桌面端

```bash
corepack pnpm dev:electron
```

不要只打开浏览器 Vite 页面。浏览器模式没有本地文件夹选择、SQLite、受控 IPC、命令执行和 Electron 预加载 API。

![Electron 工作台](./screenshots/14-electron-current-userdata-workbench.png)

通过标准：

- 应用标题或界面显示 AI DevFlow Studio，而不是 Electron 默认应用。
- 能看到工作台、团队概览、知识、Agents、技能、MCP、测试等入口。
- 选择本地仓库时，可以在文件选择器中选择当前项目根目录；从 workbench 根目录看，它是：

```text
projects/agent-engineering/ai-devflow-studio
```

<a id="2-workbench-与-gate-enforcement"></a>

## 2. 工作台与门禁策略执行

进入 `Workbench`，选择一个受保护门禁，例如方案评审门禁或验收门禁。

![工作台门禁策略执行](./screenshots/01-workbench-gate-enforcement.png)

重点观察节点检查面板：

- 策略执行状态：`pass / warn / blocked / hard_blocked / overridden / blocked_policy_unavailable`
- 策略来源、版本与同步时间（syncedAt）
- 命中规则 / 阻断原因
- 处理建议候选项
- 覆盖审批或强制阻断处理建议

通过标准：

- 默认仅警告不会无故阻止人工门禁。
- 如果推荐策略或团队缓存策略触发阻断，界面必须说明为什么被拦。
- 强制阻断只展示补救说明，不展示覆盖审批表单。
- 渲染器只是展示状态，最终批准写路径由 Electron 主进程校验。

<a id="3-knowledge-governance"></a>

## 3. 知识治理

打开 `Knowledge` 视图，搜索 `api`、`testing`、`gate`。

![知识治理](./screenshots/12-electron-knowledge.png)

重点观察：

- 源路径
- 章节/分块
- 知识引用
- 治理检查
- 检索结果与治理证据的区别

通过标准：

- 检索命中不会自动满足治理证据。
- 证据仍来自产物、测试证据、Agent 审查、门禁决定。

<a id="4-knowledge-review-agent"></a>

## 4. 知识审查 Agent

回到门禁节点，点击 `Agent Review`，完成后打开 `Agents`。

![Agent 工作台](./screenshots/04-agent-workbench.png)

重点观察：

- 服务商、模型、模拟或真实来源
- 审查产物
- 执行轨迹步骤
- 结论、风险、缺失证据、建议测试
- Token 用量与费用来源
- 门禁建议
- Agent 策略发现项

通过标准：

- 默认模拟模型服务商不产生真实模型费用。
- Agent 发现项默认不构成强制阻断。
- 团队可见摘要不包含原始提示词、原始执行轨迹、工作目录、标准输出/错误、密钥。

<a id="5-tests-与-test-evidence"></a>

## 5. 测试与测试证据

打开 `Tests` 页面或从相关节点运行测试。

![测试证据](./screenshots/05-tests-evidence.png)

重点观察：

- 命令
- 状态
- 退出码
- 耗时
- 脱敏 / 截断
- 测试证据是否进入门禁 / 处理建议输入

通过标准：

- 测试失败或超时能变成处理建议信号。
- 不应泄露本地绝对路径、原始标准输出/错误或密钥。

<a id="6-coding-agent-与-retry-coding"></a>

## 6. 编码 Agent 与重试编码

选中开发任务节点，或从门禁的处理建议候选项点击 `Retry Coding`。

![编码节点](./screenshots/09-coding-node.png)

默认路径使用模拟编码引擎：

- 创建托管工作树。
- 产生权限请求。
- 人工批准后生成脱敏代码差异。
- 在工作树内运行测试。
- 保存差异产物、测试证据、运行时事件。

通过标准：

- 编码 Agent 只允许从 `stage: build` 且 `kind: task` 的节点启动。
- 重试编码必须由人点击，不会自动修改主仓库或自动通过门禁。
- 主仓库不被直接改动。

<a id="7-runtime-trace-与-tool--skill-timeline"></a>

## 7. 运行时轨迹及工具与技能时间线

在 `Agents` 中打开编码 Agent 运行。

重点观察：

- 权限请求/回复/过期
- `tool_call`
- `tool_result`
- 工具与技能时间线
- 来源：`opencode_metadata` / `inferred` / `opencode_event_stream`
- 工具、技能、命令/文件摘要
- 终止状态：`completed / failed / cancelled / timed_out / interrupted`
- 清理状态

通过标准：

- 模拟引擎和真实 OpenCode 证据能区分。
- 缺少技能元数据时显示 `Unknown skill` 或 `Inferred tool`，不能编造技能名。
- 工具元数据本地落库前也必须脱敏，不只远端摘要脱敏。

<a id="8-runtime-cost-与-budget-admin"></a>

## 8. 运行时费用与预算管理

启动 API/Web：

```bash
corepack pnpm dev:api
corepack pnpm dev:web
```

打开：

```text
http://127.0.0.1:4311
```

进入团队控制台的 `Runtime Budget` 区域。

![Web 团队概览](./screenshots/08-team-overview.png)

重点操作：

1. 找到 `Runtime Budget` 面板。
2. 保存预算策略：
   - 是否启用
   - 月度限额
   - 预警阈值
3. 创建 `Budget Approval`：
   - 请求者（`requestedBy`）
   - 模型服务商 ID（`providerId`）
   - 额外费用上限（美元）（`maxAdditionalCostUsd`）
   - 原因（`reason`）
   - 到期时间（`expiresAt`）
4. 复制生成的批准 ID。

通过标准：

- 负责人可保存策略。
- 负责人可创建批准。
- 页面显示当前支出、策略、批准列表。
- Web 不显示原始提示词、补丁正文、工作目录、模型服务商密钥。

<a id="9-desktop-使用-budget-approval-重试"></a>

## 9. 桌面端使用预算批准重试

回到 Electron 桌面端的编码 Agent / 运行时预算区域。

当预算检查器返回 `requires_lead_approval` 时：

1. 在 `Runtime budget approval ID` 输入 Web 创建的批准 ID。
2. 点击 `Retry with approval`。
3. 观察新的编码运行预算决定。

通过标准：

- 没有批准 ID 时，超预算运行在 `engine.start(...)` 之前被阻断，不产生模型服务商调用。
- 有有效批准 ID 时，运行时检查器解析完整批准记录后再评估。
- 过期、拒绝、项目不匹配、模型服务商不匹配或额度不足的批准不应通过。
- Agents 执行轨迹里能看到预算状态、预计费用、限额、批准 ID。

<a id="10-self-hosted-team-pilot"></a>

## 10. 自托管团队试点

如果要体验 Web/API/Postgres 自托管最小闭环：

```bash
cp .env.example .env
docker compose up --build
```

打开：

```text
Web:        http://127.0.0.1:4311
API health: http://127.0.0.1:4310/health
```

<a id="desktop-pairing"></a>

### 桌面配对

1. Web 团队控制台中点击 `Create desktop pairing code`。
2. 复制一次性配对码。
3. Electron 桌面端顶部粘贴配对码。
4. 点击 `Pair`。
5. 点击 `同步团队`。

![Electron 团队概览](./screenshots/11-electron-team-overview.png)

通过标准：

- 桌面端使用 Bearer 令牌同步。
- 令牌无效时不能回退演示会话。
- Web 能看到脱敏的运行、证据、审查、编码与费用摘要。

可选自动验证：

```bash
corepack pnpm test:docker-smoke
```

<a id="11-release-only-真实-opencode--豆包volcengine-smoke"></a>

## 11. 仅发布时运行的真实 OpenCode + 豆包/Volcengine 冒烟

这一步会消耗真实模型服务商配额。只在你要验证真实运行时或做发布验收时跑。

先做无成本检查：

```bash
corepack pnpm opencode:status
```

推荐 Volcengine / 豆包配置：

```bash
export ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"

DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN \
corepack pnpm test:opencode-smoke
```

通过标准：

- 冒烟测试启动 `opencode serve`。
- 创建托管工作树。
- 收到真实权限请求。
- 转发权限。
- 捕获脱敏代码差异。
- 运行测试样例并生成验证证据。
- 记录运行时费用与 Token 来源。
- 完成进程与工作树清理。
- 输出不包含模型服务商密钥、本地原始工作目录、原始标准输出/错误、原始提示词、完整补丁。

记录模板见：

```text
docs/plans/release-only-real-opencode-smoke.md
```

<a id="12-人工-walkthrough-核对表"></a>

## 12. 人工演练核对表

| 步骤 | 入口 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| 发布状态 | 终端 | `corepack pnpm release:status` | 包、标签、文档与 Git 状态正常；人工演练可显示待完成 |
| 桌面启动 | 终端 | `corepack pnpm dev:electron` | 打开 AI DevFlow Studio，不是 Electron 默认应用 |
| 本地项目 | 工作台 | 选择当前仓库 | 能加载工作流和项目状态 |
| 门禁策略执行 | 工作台节点检查面板 | 选择受保护门禁 | 显示策略来源、阻断原因、处理建议 |
| Agent 审查 | 门禁节点检查面板 / Agents | 点击 Agent 审查 | 生成审查产物、执行轨迹、审查建议、发现项 |
| 测试证据 | 测试 | 运行或查看测试 | 显示命令、状态、退出码、耗时，输出脱敏 |
| 重试编码 | 门禁 / 编码节点 | 点击重试编码并批准权限 | 创建托管工作树，产生差异与测试证据，不改主仓库 |
| 工具与技能轨迹 | Agents | 查看编码 Agent 运行 | 显示 tool_call/tool_result、未知技能/推断工具、清理 |
| 运行时预算 | Web 团队控制台 | 保存策略，创建批准 | 策略和批准列表可见 |
| 预算重试 | 桌面端 Agents | 输入批准 ID 并使用批准重试 | 预算决定从需要批准变为 `approved_over_budget` 或可执行 |
| 配对同步 | Web + 桌面端 | 创建配对码，桌面配对，同步团队 | Web 显示脱敏团队摘要 |
| 真实 OpenCode | 终端 | 由环境变量显式启用 `test:opencode-smoke` | 真实模型服务商冒烟测试通过；仅在你接受费用时执行 |

人工走完并确认后，可以标记发布演练：

```bash
DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict
```

## 当前不要宣称

- 不要说真实 OpenCode 是默认 CI/验证路径。
- 不要说系统会自动修复并自动通过门禁。
- 不要说已支持公开 SaaS、企业 SSO、计费、Kubernetes。
- 不要说 MCP 真执行 / MCP 策略执行已完成。
- 不要说能完整还原 OpenCode 内部私有技能调用栈。
- 不要说 Windows Electron 完整冒烟已完成。
