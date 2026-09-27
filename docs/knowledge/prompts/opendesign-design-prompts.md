<a id="opendesign-design-prompts"></a>

# OpenDesign 设计提示词

本文件保存可复用的 OpenDesign 设计提示词。通用模板已提供中文版本；下方 2026-06-23 的两条已使用提示词逐字保留，便于追溯当时输入。它们描述当时的开发状态和设计意图，其中的三栏布局、右侧节点详情和发布范围不代表当前产品能力；当前层级参见[节点工作区说明](../../engineering/workbench-conversations.md)。

<a id="usage-rules"></a>

## 使用规则

- 尽量使用可复用、与具体产品解耦的提示词。
- 记录设计目标、目标界面、约束和预期输出。
- 优先生成具体界面状态，避免只做宽泛的视觉探索。
- 某条提示词取得良好效果后，补充使用日期及生成结果。

<a id="prompt-entry-template"></a>

## 提示词条目模板

````md
### YYYY-MM-DD - 提示词简称

**使用场景**：

**提示词**：

```text
在这里粘贴实际使用的完整 OpenDesign 提示词。
```

**结果与说明**：
````

<a id="core-prompt-templates"></a>

## 通用提示词模板

<a id="product-surface-redesign"></a>

### 产品界面重新设计

```text
为[产品/界面]设计一个达到生产质量的界面。

受众：
- [目标用户]

主要任务：
- [用户需要完成的事情]

背景：
- [业务/产品背景]

必须包含的界面状态：
- 默认状态
- 空状态
- 加载状态
- 错误或受阻状态
- 成功/完成状态

约束：
- 界面以工作任务为中心，适合日常重复使用。
- 优先保证便于扫读、层级清晰、流程顺畅。
- 避免装饰性的营销落地页构图。
- 保留既有产品术语；只有能明确解释新名称更合理时才调整。

输出：
- 一张完整的界面设计。
- 使用贴近实际的数据。
- 包含该工作流所需的关键控件和导航。
```

<a id="existing-screen-refactor"></a>

### 既有界面重构

```text
将现有界面重构得更清晰，并能够承载后续内容扩展。

保持不变：
- 核心工作流语义
- 领域术语
- 必需操作

改善：
- 信息层级
- 导航清晰度
- 信息密度和扫读体验
- 空状态、加载状态和错误状态
- 重复操作的便利性

结果应适合日常操作的桌面/网页应用，而非营销页面。
```

<a id="design-direction-exploration"></a>

### 设计方向探索

```text
为[界面/产品]创建 3 个不同的视觉方向。

所有方向都必须支持：
- [工作流 1]
- [工作流 2]
- [工作流 3]

各方向应在以下方面体现差异：
- 布局结构
- 信息密度
- 导航模型
- 视觉风格

不要使用纯装饰性的首屏大图区。展示真实产品状态和贴近实际的数据。
```

<a id="saved-prompts"></a>

## 已保存的提示词

在此处添加经过实践的提示词，并保留其原始输入。

<a id="2026-06-23---devflow-studio-current-product-summary-v1"></a>

### 2026-06-23 - DevFlow Studio 当时产品状态总结 V1

**使用场景**：
在编写覆盖全部模块的 V2 界面提示词前，为 OpenDesign 提供当时 DevFlow Studio Electron 应用状态的背景材料。

**提示词原文**：

```text
以下是当前本地 Electron 应用的最新文字总结，按你正在体验的 `AI DevFlow Studio` 工作树状态来描述。注意：这是**当前开发态**，不是已正式 release 的稳定版说明。

**一句话定位**
DevFlow Studio 是一个本地优先的 AI 交付工作台：把一个需求从创建 Run、需求澄清、方案设计、编码、测试证据、PR 交付、业务验收串起来，并在关键 Gate 上加入基于知识的门禁审查（Knowledge-Grounded Gate Review）、Policy Enforcement、Budget Guard、真实/假 Agent Runtime 的可观测记录。

**核心业务模型**
- **Team Project**：团队项目，例如 `Payments API`。它决定 Run 归属、团队策略、远端同步和预算策略。
- **Local Project**：本地代码仓库，例如 `ai-devflow-studio`。它用于本地测试命令、Coding Agent worktree、diff 和 Test Evidence。
- **Run**：一次需求交付实例，例如“优化空搜索结果提示文案”。一个 Run 包含节点、artifact、review、测试、coding trace。
- **Node**：流程中的一个步骤。现在有六段：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收。
- **Artifact**：阶段产物，例如 Raw Request、Clarification Brief、Design Brief、Coding Diff、Test Report、PR Draft、Acceptance Bundle。
- **Gate**：人工/策略审批点。Gate 是否能通过由角色权限、团队 policy、门禁审查、证据状态共同决定。
- **Evidence / Event / Trace**：运行过程证据，包括 Gate Review、Test Evidence、Coding Trace、permission、tool call、cleanup、budget decision 等。

**主流程**
1. 用户点击 `新建 Run`，输入一个需求。
2. 系统创建六阶段 workflow，当前节点通常从“需求澄清 Agent”开始。
3. 用户点击生成澄清/设计产物，系统确定性生成对应 artifact，并推进到下一个 Gate。
4. Gate 阶段需要看团队 policy、门禁审查和治理证据是否满足。
5. 门禁审查 Agent 会以检索到的 Knowledge 与规范为依据，审查当前 Gate、门禁条件和阶段产物，生成 Gate Advisory。
6. Build 节点可以启动 Coding Agent。Coding Agent 负责在 managed worktree 中执行变更、生成 diff、跑测试、保存 Test Evidence。
7. Test 阶段归档测试结果。
8. PR 阶段生成 PR Draft / compare handoff，不自动 push 或 merge。
9. Acceptance 阶段生成验收包并完成业务验收。

**当前界面结构**
左侧是主导航：
- `工作台`：主流程画布和 Inspector。
- `Team Overview`：团队/远端同步/预算/概览。
- `Knowledge`：知识引用、治理检查、知识材料。
- `Agents`：门禁审查 Agent、Coding Agent 状态、provider 配置、trace。
- `Skills`：技能/能力展示。
- `MCP`：MCP server 配置和状态。
- `测试`：本地测试命令和 Test Evidence。

顶部栏包含：
- 当前 Team Project 显示，例如 `Payments API`。
- 搜索框：搜索当前加载的 Run、Artifact、Knowledge/Event，不是直接搜索本地文件系统 markdown。
- 主题切换。
- Pairing code / Pair：桌面端和团队后端配对。
- `同步团队`：拉取团队策略/远端状态。
- `Redaction`：脱敏检查。
- `新建 Run`。
- 当前用户标识。

工作台中间是 workflow board：
- 横向分为六个阶段。
- 每个阶段下有 agent/gate/task/test/pr/acceptance 节点卡片。
- 点击节点后，右侧 Inspector 显示该节点的状态、可执行动作和阻断原因。

右侧 Inspector 负责：
- 展示当前节点标题、阶段、说明。
- 显示 Gate Enforcement 状态。
- 显示 Knowledge Governance 缺口。
- 提供当前节点可执行动作，例如生成澄清结果、运行门禁审查、通过 Gate、运行 Coding Agent、生成 PR Draft。
- 展示相关 artifact、agent event、trace。

**基于知识的门禁审查逻辑**
DevFlow 自己实现门禁审查 Agent 的业务逻辑：Knowledge 是审查依据，当前 Gate、门禁条件和阶段产物是审查对象；系统会检索知识、组装上下文、构造 review prompt 并解析结构化结果。模型 provider 只是推理后端。

当前支持：
- `Deterministic Fake Provider`：默认、无成本、可重复，用于本地开发和 CI。
- `OpenAI-compatible / Volcengine Ark`：你配置的豆包/火山 provider，例如 `doubao-review` + `ark-code-latest`。

这里不是 opencode 在做门禁审查。opencode 只属于 Coding Agent runtime。基于知识的门禁审查由 DevFlow 自己的 Agent 核心调用模型 provider。

**Coding Agent 逻辑**
Coding Agent 和门禁审查是两条不同链路：
- 门禁审查：以 Knowledge 与规范为依据，审查当前 Gate 条件和阶段产物。
- Coding Agent：执行代码修改。

Coding Agent 可走：
- fake engine：默认验证路径，稳定、无成本。
- real opencode runtime：release-only / 手动 smoke，用真实 provider，可能消耗 token。

Coding Agent 会：
- 创建 managed worktree。
- 生成 coding brief。
- 处理 permission request/reply。
- 产出 diff。
- 跑本地测试命令。
- 保存 Test Evidence。
- 记录 tool/skill/coding trace、cleanup、timeout/cancel 状态。

**Gate Enforcement 逻辑**
Gate 不只是按钮审批。它会综合：
- 角色权限。
- 当前节点是否真的到 Gate。
- 团队 policy 是否可用。
- 门禁审查是否完成。
- Test Evidence 是否满足。
- 是否有 lead override。
- 是否存在 hard block。

常见状态：
- `blocked_policy_unavailable`：团队 policy 未缓存，需要 Pair/同步团队。
- `missing_agent_review`：缺门禁审查结果。
- `warn`：有缺口但不阻止审批。
- `blocked`：阻止审批，需要补证据或 override。
- `hard_blocked`：不可 override，只能按 remediation 修复。

**Budget / Cost 逻辑**
应用已经有 runtime cost 与 budget guard：
- 统计 token/cost。
- 可阻止超预算 runtime 在 `engine.start` 前调用真实 provider。
- 支持 approvalId 形式的 over-budget approval。
- UI 中会显示 Token Cost、provider usage source、latest cost。

**当前体验上明显的问题**
- 顶部 `Project` 看起来像项目选择器，但实际更像当前 Run 的 Team Project 显示，容易误解。
- `Team Project` 和 `Local Project` 两个概念视觉上没有充分分离。
- Workbench 和 Agents 页都能影响当前 Run，职责边界对用户不够清晰。
- Inspector 信息密度偏高，Gate Enforcement、Knowledge Governance、Review、Coding Trace 混在一条长侧栏里。
- 当前流程虽已能走，但“下一步该点哪里”还不够强提示。
- 搜索框当前不是全局文件搜索，输入 `markdown` 搜不到本地 markdown 是符合当前实现的，但文案会误导。

**当前状态判断**
业务能力已经不只是 demo 壳：Run、Workflow、Artifact、门禁审查、Gate Policy、Coding Agent、Test Evidence、Budget、Pairing/Sync 都已经有真实链路。
但界面信息架构还需要整理。现在的问题主要不是“能力不存在”，而是“能力堆在一起后，用户不知道每一步该如何理解和操作”。

涉及的核心代码位置：
- [App.tsx](../../../apps/desktop/src/App.tsx)
- [workflow.ts](../../../packages/shared/src/workflow.ts)
- [main.ts](../../../apps/desktop/electron/main.ts)
- [desktop-api.ts](../../../apps/desktop/src/desktop-api.ts)
```

**结果与说明**：
第一版，记录当时开发状态下的产品模型、流程、界面结构、Agent/运行时边界及已知的信息架构问题。

<a id="2026-06-23---devflow-studio-full-product-interface-v2"></a>

### 2026-06-23 - DevFlow Studio 完整产品界面 V2

**使用场景**：
为 OpenDesign 提供完整的 DevFlow Studio Electron 桌面产品界面提示词，覆盖所有主要模块及跨模块的交付流程联动。

**提示词原文**：

```text
请设计 DevFlow Studio Electron 桌面端完整产品界面，包含入口、工作台、Team Overview、Knowledge、Agents、Skills、MCP、Tests 七个主板块，并让它们围绕同一个 Run delivery flow 联动。

全局 Shell：
左侧固定导航：工作台、Team Overview、Knowledge、Agents、Skills、MCP、测试。顶部包含项目选择器、全局搜索、主题切换、Desktop pairing code、同步团队、Redaction、新建 Run、用户头像。顶部状态条显示 Active Runs、Pending Gates、Token Cost、Tests Today、同步/策略错误。所有页面共享搜索、toast、loading、empty、blocked、failed 状态。

入口 / 新建 Run：
入口不是营销页，而是创建交付流的操作入口。点击“新建 Run”打开 modal，输入标题和一句话需求，点击“创建并开始澄清”后生成 raw request artifact，左侧 Run 列表新增并选中，中间画布高亮需求澄清节点，右侧 Inspector 显示当前节点动作。

工作台 Workbench：
三列布局。左列是 Local Project + Runs，支持选择本地仓库、编辑测试命令、显示 command safety、保存测试命令、切换 Run。中间是六阶段工作流画布：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收；节点点击后刷新右侧。右侧 Inspector 根据节点类型显示 Gate Enforcement、Knowledge Governance、门禁审查、Artifacts、Agent Events 和上下文动作。Gate 通过必须受策略控制，不允许只是 UI disabled。

Team Overview：
展示团队可见的 redacted delivery health，而不是本地 raw log。包含项目列表、repository、health badge、test command、active/latest Run、Gate 状态、policy/budget/test/review rollup、成员角色、token/cost rollup、同步来源 local/remote/seed。这里要强调“团队视图只看脱敏摘要”。

Knowledge：
展示 Git Markdown Index、知识文档卡、source path、category、tags、轻量知识图谱、Run references。与工作台联动：当前 Run/Node 的 Knowledge Governance 检查在 Inspector 里展示，Knowledge 页用于深挖引用来源、score、heading path、content hash。

Agents：
分两块：基于知识的门禁审查（Knowledge-Grounded Gate Review）和 Coding Agent。门禁审查区包含 provider 选择、credential 表单、运行门禁审查按钮、review history、Gate Advisory、trace、token usage、cost source。Knowledge 是审查依据，当前 Gate、门禁条件和阶段产物是审查对象。Coding Agent 区包含 Run Coding Agent、managed worktree、permission relay、Approve once / Reject、runtime budget approval、tool timeline、diff preview、changed paths、bootstrap evidence、test evidence、Open worktree、Cancel、Delete worktree。Agents 页不是独立功能页，而是从 Inspector 的门禁审查 / Coding Agent 动作跳转过来的执行控制台。

Skills：
展示团队能力目录。每个 skill 卡片展示名称、描述、stage、enabled/disabled 状态。它说明团队有哪些标准化能力可用于 Run，但不能绕过 Gate、policy 或 evidence requirements。

MCP：
展示本机工具连接器。每个 MCP server 显示 name、command、permission、enabledLocally 状态和 Enable/Disable 操作。MCP 是本地工具能力入口，不应表现成云端集成市场；要强调权限和本地执行边界。

Tests：
展示测试计划与证据。包含测试包说明、执行本地测试按钮、进度/health bar、Test Evidence 列表。每条 evidence 显示 command、status、exit code、duration、redacted yes/no、stdout/stderr 摘要。测试失败、超时、跳过都要明确保存证据，并返回工作台影响 Gate 状态。

跨模块联动：
新建 Run 进入 Workbench；Gate 缺门禁审查结果时从 Inspector 跳到 Agents；执行测试后跳到 Tests；Knowledge Governance 引用可跳到 Knowledge；同步团队影响 Team Overview 和 Gate policy；Coding Agent 产生 diff/test/bootstrap evidence 后回写 Workbench Inspector；PR Draft 和 Acceptance Bundle 都从累积 evidence 生成。整体体验必须是“流程驱动”，不是几个孤立页面。
```

**结果与说明**：
第二版，覆盖全部主要模块和跨模块交付流程。
