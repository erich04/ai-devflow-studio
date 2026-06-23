# DevFlow Studio 桌面端界面设计决策说明

本文档沉淀当前 Open Design 原型讨论中形成的产品信息架构、Workflow Board 卡片模型、Inspector 展示逻辑、模块跳转关系和后续重构注意点。

对应原型文件：

- `index.html`
- `critique.json`

## 1. 产品定位

DevFlow Studio 是一个本地优先的 AI 交付工作台，不是营销首页，也不是概念 demo。它的核心体验是把一个需求从创建 Run 到业务验收串成完整 delivery flow。

界面应该服务工程团队的日常重复使用：

- 信息密度高，适合扫描。
- 流程驱动，而不是孤立页面。
- 明确区分团队策略、本地仓库、交付实例和节点行动。
- 关键 Gate 的阻断原因必须可解释。
- Agents、Tests、Knowledge 都是支撑当前 Run/Node 的模块，不是独立孤岛。

## 2. 核心对象关系

### Team Project

团队项目，决定团队级规则：

- Team policy
- Gate policy
- 预算规则
- 角色权限
- 远端同步
- redaction / retention 等团队治理规则

Team Project 是团队配置和治理边界。

### Local Project

本地代码仓库，决定本机执行边界：

- 当前 repo
- 测试命令来源
- command safety
- Coding Agent worktree
- diff
- Test Evidence
- 本机 runtime 和权限边界

Local Project 不拥有 Team policy。它只是被绑定到某个 Team Project policy snapshot 下执行。

### Run

一次需求交付实例。用户先选择 Run，再查看这个 Run 的 Workflow Board。

Run 是主业务对象。所有 Workflow Node、Artifact、Evidence、Trace 都应该挂在某个 Run 下。

### Workflow Node

Run 内的流程主节点。当前设计里，Board 上的主卡片只表示流程节点，不再把 Artifact / Evidence / Trace 当成与 Task / Gate 同级的卡片。

### Artifact / Evidence / Trace

这些不是 Board 主流程卡片，而是某个 Workflow Node 的输出、依赖或过程记录：

- Artifact: 做出来的产物
- Evidence: 证明结果的证据
- Trace: 执行过程记录

### Gate

Gate 是门禁判断点。它不是简单的 UI disabled 状态，而是由多个条件共同决定：

- Team policy
- role permission
- Knowledge Review
- Test Evidence
- budget 状态
- 相关 Artifact 和 Trace

## 3. 主流程心智

正确的主线是：

1. 选择一个 `Run`。
2. 查看这个 Run 的六阶段 delivery flow。
3. 点击某个 Workflow Node。
4. 在右侧 Inspector 处理当前节点的下一步动作、阻断原因、Evidence、Trace、Gate 条件。
5. 必要时从 Inspector 跳转到 Agents、Tests、Knowledge 等支撑模块。
6. 支撑模块执行后回写 Workbench Inspector 和当前 Run 状态。

这意味着 Workbench 是主流程中心，其他模块为当前 Run/Node 服务。

## 4. Workflow Board 为什么这样设计

### 旧问题

早期设计把 `Task / Gate / Artifact / Evidence / Trace` 都做成 Board 上的同级卡片。这个模型有问题：

- Task 会产出 Artifact、Evidence、Trace。
- Gate 会消费 Artifact、Evidence、Trace 来判断能否通过。
- Evidence 和 Trace 不是用户要按顺序执行的流程任务。
- Board 卡片类型和 Inspector 里的 `状态 / Gate / Evidence / Trace` 维度重复，用户会困惑。

因此，Artifact / Evidence / Trace 不应作为 Board 主卡片类型。

### 当前模型

Workflow Board 的主卡片只分为四类：

| 类型 | 作用 | 典型例子 |
|---|---|---|
| `Task` | 需要执行的工作 | Clarification Agent、Coding Agent、Local Test Task |
| `Gate` | 判断能否继续推进 | 需求确认 Gate、Design Gate、PR Delivery Gate、业务验收 Gate |
| `Review` | 评审和治理动作 | Knowledge Review |
| `Delivery` | 交付封装节点 | PR Draft、Acceptance Bundle |

Artifact / Evidence / Trace 作为每张主节点卡片底部的关联摘要 chip 出现，例如：

- `ART`: 关联产物
- `EVD`: 关联证据
- `TRC`: 关联执行过程

这样 Board 只表达流程推进，Inspector 再展开诊断细节。

## 5. 每类 Workflow 卡片的设计原因

### Task

Task 是要执行的动作。它通常会产生 Artifact、Evidence 或 Trace。

例子：

- Clarification Agent
- Coding Agent
- Local Test Task

Task 卡片需要展示：

- 当前执行状态
- 是否是当前节点
- 产物数量
- Trace 是否存在
- 会影响哪个 Gate

不应该把 Task 自己设计成 Gate，因为 Task 的结果会被 Gate 消费，但 Task 本身不做门禁决策。

### Gate

Gate 是推进关口。它决定当前 Run 能不能进入下一阶段或完成交付。

Gate 卡片需要突出：

- passed / blocked / missing review / over budget 等状态
- 当前卡点
- Gate 消费哪些 Evidence
- 下一步 remediation

Gate 的价值不是“执行”，而是解释为什么可以或不可以继续往后走。

### Review

Review 是评审治理动作。当前最重要的是 Knowledge Review。

Review 和 Gate 容易混淆，但二者不同：

- Review 产生 advisory、引用、review evidence。
- Gate 消费 Review 的结果来决定是否通过。

所以 Review 不应直接等同于 Gate。它是 Gate 判断的一项输入。

### Delivery

Delivery 是交付封装节点，不是普通 Task，也不是 Gate。

例子：

- PR Draft
- Acceptance Bundle

Delivery 的职责是把前面累积的 Artifact、Evidence、Trace 组织成可以交付给外部系统或业务方的内容。

## 6. Board 卡片数量由谁决定

同一个阶段下有几个卡片，不应该随意变化。合理来源是：

1. `Run template`: 决定基础流程骨架。
2. `Team Project policy`: 决定是否插入必须的 Gate / Review。
3. `Local Project` 与 runtime 结果: 决定测试、worktree、budget 等状态是否出现。
4. 折叠规则: 已完成或非阻断的输出可以变成摘要 chip，而不是主卡片。

例如“界面修改”这种 Run，需求澄清阶段更合理的是：

- `Clarification Task`
- `需求确认 Gate`
- Raw Request / Clarification Brief 作为上面节点的 Artifact 摘要

如果一个 Run 的需求澄清阶段有 3 张卡，另一个只有 2 张，必须能解释：

- policy 插入了额外 Gate
- 该 Run 已有完整 brief，跳过了某个 Task
- 当前阶段折叠了已完成节点
- 某类需求必须追加 Knowledge Review

否则用户会误以为自己少走了一步。

## 7. 阶段推进与卡点展示

Board 需要直接表达 Run 的推进位置，而不是让用户必须点 Inspector 才知道卡在哪里。

当前设计应保留：

- 六阶段主序列：需求澄清、方案设计、开发实现、测试证据、PR 交付、业务验收
- Run progress 条
- 当前阶段标记
- 当前卡点提示
- 阶段状态：已通过、当前位置、卡点、等待

关键规则：

- 阶段是主序列。
- Gate 没过时，下游不能算完成。
- 某些下游节点可以提前准备，但最终完成要看业务验收 Gate。

## 8. Inspector 为什么按节点类型变化

早期 Inspector 对所有卡片都显示 `状态 / Gate / Evidence / Trace` 四个 tab。这个设计太统一，导致语义重复：

- Task 不是 Gate，但也出现 Gate tab。
- Artifact / Evidence / Trace 曾经既是卡片类型，又是 Inspector tab。
- 用户会误以为所有节点都有同等的 Gate / Evidence / Trace。

当前设计改为：Inspector 根据当前节点类型动态展示。

### Task Inspector

Tab：

- `状态`
- `产物`
- `Trace`
- `Gate 影响`

原因：

- Task 负责执行。
- Task 会产生产物和 Trace。
- Task 的结果会影响后续 Gate。

### Gate Inspector

Tab：

- `状态`
- `Gate 条件`
- `Evidence`
- `Remediation`

原因：

- Gate 负责判断能否继续。
- 用户最需要知道缺什么、谁能批准、下一步怎么补。

Gate 条件应该展示：

- policy snapshot
- role permission
- Knowledge Review
- Test Evidence
- budget
- required Artifact

### Review Inspector

Tab：

- `状态`
- `Knowledge Review`
- `引用来源`
- `Evidence`

原因：

- Review 是治理动作。
- 它的重点是引用来源、score、heading path、content hash、review history 和 advisory。
- Review 结果作为 Gate 输入。

### Delivery Inspector

Tab：

- `状态`
- `Artifacts`
- `Evidence`
- `Handoff`

原因：

- Delivery 负责封装可交付内容。
- 它要解释 PR Draft 或 Acceptance Bundle 由哪些 Artifact 和 Evidence 组成。

## 9. Team Project policy 的归属

Team Project policy 不应在 Workbench、Local Project 或某个 Run 里配置。

它应该在：

`Team Project Settings / Policy`

由团队管理员或有权限角色配置。

可配置内容包括：

- 哪些阶段需要 Gate
- 哪些 Gate 需要 Knowledge Review
- 哪些 Test Evidence 必须存在
- budget 上限与 approval 规则
- 哪些角色可以 approve
- redaction / sync / retention 规则

Workbench 和 Inspector 只能读取 policy snapshot，并解释当前 Gate 为什么被阻断。

## 10. 同步团队按钮的产品含义

`同步团队` 是全局按钮，因为它影响整个桌面端上下文：

- Team Overview
- Gate policy
- Workbench Inspector
- budget / policy 状态
- policy snapshot 版本

但在当前原型里，它仍然是前端模拟：

- 更新同步状态
- 更新 Inspector 的 policy 状态
- 更新 Team Overview 的 Gate 状态
- 展示 toast

真实实现时需要接入：

- Electron IPC
- 远端 Team Project policy 拉取
- 本地 `policy_snapshots` 写入
- snapshot 版本和时间戳
- Gate 重新评估
- Event / Trace 记录

## 11. Local Project 卡片的定位

Workbench 左列的 Local Project 卡片只展示本地配置和执行边界。

它回答：

- 当前 Run 基于哪个本地仓库执行
- 测试命令来自哪里
- command safety 是什么
- Coding Agent / Tests 会在哪个本地项目上下文运行
- 该 Local Project 绑定到哪个 Team Project policy

这里不应该放：

- 保存测试命令
- 执行测试入口
- Gate approve
- Agent 执行按钮

这些动作都应出现在当前节点的 Inspector 或 Tests / Agents 模块中。

## 12. 模块跳转逻辑

### 全局 Shell

左侧固定导航包含：

- 工作台
- Team Overview
- Knowledge
- Agents
- Skills
- MCP
- 测试

顶部栏包含：

- Team Project 选择
- Local Project 提示
- 全局搜索
- 主题切换
- Desktop pairing code
- 同步团队
- Redaction
- 新建 Run
- 用户头像

这些是全局，因为它们影响产品上下文，而不是某个局部卡片。

### Workbench 到 Agents

当 Gate 缺少 Knowledge Review，Inspector 应提供 `Run Knowledge Review` 动作，跳到 Agents。

Agents 完成 Review 后，应回写：

- Review Evidence
- Gate Advisory
- Inspector 状态
- 当前 Run 的 Gate 条件

### Workbench 到 Tests

当 Test Evidence 缺失，Inspector 应提供 `执行本地测试` 动作，跳到 Tests。

Tests 完成后回写：

- Test Evidence
- command status
- exit code
- duration
- stdout/stderr 摘要
- Gate 状态

### Workbench 到 Knowledge

当 Inspector 展示 Knowledge Governance 引用时，点击引用应跳到 Knowledge 页面。

Knowledge 页面用于查看：

- source path
- category
- tags
- score
- heading path
- content hash
- Run references
- lightweight graph

### Team Overview 到 Policy Settings

Team Overview 是团队脱敏健康视图，不展示本地 raw log。

Policy 配置入口应该在 Team 页面内的 `Team Project Settings / Policy`，而不是 Workbench。

## 13. Agents 模块边界

Agents 是执行控制台，但不是主流程入口。

它应从 Inspector 的当前节点动作跳入。

### Knowledge Review Agent

职责：

- 做交付评审和知识治理
- 生成 Gate Advisory
- 记录引用、trace、token usage、cost source

需要明确：

- Knowledge Review 是 DevFlow 自己实现的 review agent。
- 模型 provider 只是推理后端。

### Coding Agent

职责：

- 通过 runtime 修改代码
- 管理 worktree
- 接收 permission relay
- 展示 tool timeline
- 产出 diff、bootstrap evidence、test evidence

需要明确：

- Coding Agent 和 Knowledge Review 是两条不同链路。
- Coding Agent 做代码修改。
- Knowledge Review 做交付评审和知识治理。

## 14. Tests 模块边界

Tests 模块负责测试计划和 Test Evidence。

应展示：

- 测试包说明
- 执行本地测试按钮
- progress / health bar
- Evidence 列表
- command
- status
- exit code
- duration
- redacted yes/no
- stdout/stderr 摘要

失败、超时、跳过都必须保存 Evidence，并影响 Gate 状态。

## 15. Skills 与 MCP 边界

### Skills

Skills 是团队能力目录。

每个 Skill 展示：

- name
- description
- stage
- enabled / disabled

Skills 可以支持 Run，但不能绕过 Gate、policy 或 evidence requirements。

### MCP

MCP 是本机工具连接器，不是云端集成市场。

每个 server 展示：

- name
- command
- permission
- enabledLocally
- Enable / Disable

重点是权限、本地执行边界和安全状态。

## 16. 搜索范围

全局搜索必须明确说明它搜索的是当前加载的：

- Run
- Artifact
- Knowledge
- Event

它不是本地文件系统全文搜索。

这是为了避免用户误解搜索框会直接扫描整个本地 repo。

## 17. 关键状态覆盖

原型和后续重构都需要覆盖：

- default
- loading
- empty
- blocked
- failed
- success
- policy unavailable
- missing agent review
- over budget approval

这些状态不应只靠颜色表达。需要同时有：

- 状态标签
- 文案解释
- 下一步动作
- 影响的 Gate 或模块

## 18. 后续重构建议

### 数据模型建议

不要把 Board 节点建模成 `Task / Gate / Artifact / Evidence / Trace` 同级枚举。

建议：

```ts
type WorkflowNodeKind = "task" | "gate" | "review" | "delivery";

type WorkflowNode = {
  id: string;
  runId: string;
  stageId: string;
  kind: WorkflowNodeKind;
  title: string;
  status: string;
  current?: boolean;
  outputs?: ArtifactRef[];
  evidence?: EvidenceRef[];
  traces?: TraceRef[];
  gateImpact?: GateRef[];
  requirements?: GateRequirement[];
};
```

Artifact / Evidence / Trace 应该作为引用或子资源挂在 WorkflowNode 下。

### UI 组件建议

建议拆分：

- `AppShell`
- `TopContextBar`
- `GlobalStatusStrip`
- `RunList`
- `LocalProjectSummary`
- `WorkflowBoard`
- `StageColumn`
- `WorkflowNodeCard`
- `Inspector`
- `InspectorTabsByNodeKind`
- `TeamPolicySettings`
- `PolicySnapshotPanel`
- `KnowledgeReviewAgentPanel`
- `CodingAgentPanel`
- `TestEvidenceTable`

### 交互建议

必须补齐：

- 点击 Run 刷新 Board 和 Inspector。
- 点击 Workflow Node 刷新 Inspector。
- Search result 可跳到对应 Run / Artifact / Knowledge / Event。
- Agents 完成 Review 后提供返回 Gate Inspector。
- Tests 完成后提供返回当前 Test Evidence 节点。
- Team policy 同步后重新评估相关 Gate。

## 19. 当前最重要的设计原则

1. Board 展示流程主节点，不展示所有底层对象。
2. Inspector 是当前节点行动中心。
3. Artifact / Evidence / Trace 是节点输出或依赖，不是主流程卡片。
4. Gate 消费 Evidence 和 Review，不执行工作。
5. Team policy 只在 Team Settings 配置。
6. Local Project 只表达本地执行边界。
7. Agents / Tests / Knowledge 都应从 Inspector 的当前问题跳转进入。
8. 所有阻断状态都必须解释原因和下一步。

