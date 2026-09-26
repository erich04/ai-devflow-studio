# Coding Agent、Engine、Executor 与 DevFlow Native 的关系

本文解释 AI DevFlow Studio 中几个容易混淆的名称。它们不处在同一层，也不是同义词。

## 当前界面名称与配置范围

统一产品名称是 **DevFlow Native（内置编码执行器）**，旧称 Native Coding Agent / Native Executor。
`native-model` 是保持兼容的内部配置值，v2 是实现版本；它们不是新的产品或架构。

| 入口 | 选择位置 | 使用范围 |
| --- | --- | --- |
| 开发实现 | Agents → 项目执行工具 | OpenCode 或 DevFlow Native；在托管工作树执行代码修改 |
| 需求澄清 / 方案设计 | 节点详情 → 澄清执行器 / 设计执行器、模型 | 各节点独立选择 Direct Provider 或 OpenCode；OpenCode 只读调查仓库 |
| 右侧聊天 | 新对话执行方式 | 独立选择 Direct Provider 或 OpenCode，不随开发实现设置切换 |

模型提供方（Provider）是模型 API 的配置，可以由多个入口明确选择并共用；执行器选择和权限仍然独立。
方案设计必须读取需求 Gate 已批准的澄清正文，生成产物后停在方案评审 Gate。
以下架构图中的 `Native Coding Executor` / `Native Coding Decision Provider` 保留为技术层术语，
面向用户时统一称 DevFlow Native。

## 一张图看懂当前结构

```mermaid
flowchart TB
    Workflow["工作流：开发实现任务"] --> Agent["编码 Agent<br/>面向用户的代码修改能力与启动入口"]

    Agent --> Runtime["Electron 编码运行时<br/>组装上下文、预算检查、权限传递、工作树与证据归档"]
    Runtime --> Contract{"编码执行器契约<br/>能力协商、事件、取消、恢复与统一终态"}

    Contract --> Compatibility["兼容执行器<br/>兼容 1.x 的包装层"]
    Compatibility --> Engine["编码引擎适配器<br/>历史内部接口"]
    Engine --> Fake["模拟引擎<br/>确定性自动测试"]
    Engine --> OpenCode["OpenCode HTTP / ACP<br/>外部编码 Agent 运行时"]

    Contract --> Native["原生编码执行器<br/>DevFlow 自有的窄执行器"]
    Native --> Decision{"原生编码决策提供方"}
    Decision --> Deterministic["确定性模型提供方<br/>离线验收与测试"]
    Decision --> Model["Agent 模型提供方<br/>例如 DeepSeek；必须明确配置为原生编码模型提供方"]
    Native --> Tools["本地工具<br/>受控读取 / 写入 / 已保存测试"]

    Runtime --> Worktree["托管 Git 工作树<br/>实际代码修改位置"]
    Compatibility --> Worktree
    Native --> Worktree

    Worktree --> Outputs["本地证据<br/>编码轨迹 · 差异产物 · 测试证据"]
    Outputs --> SQLite["Electron 本地 SQLite"]

    Outputs -. "只能形成证据，不能自行批准" .-> Gate["工作流 / 人工 Gate / 交付<br/>继续拥有最终流程与发布权限"]
```

## 各个名称分别是什么

| 名称 | 所在层次 | 准确定义 | 不是什么 |
| --- | --- | --- | --- |
| Agent Provider | 模型调用层 | 将提示词或结构化请求交给模型 API，例如 DeepSeek | 不是代码执行器，也不直接修改仓库 |
| Coding Agent | 产品能力层 | 工作流中“执行代码修改”的入口和整体能力名称 | 不是某一个固定类，也不等于 DeepSeek |
| Electron Coding Runtime | 编排与治理层 | 负责上下文、预算、权限、工作树、事件、差异和测试证据 | 不负责人工批准 Gate 或发布代码 |
| Coding Executor | 当前统一契约层 | V2.0 引入的执行器接口；统一能力描述、事件、取消、恢复和终态结果 | 不是某个具体模型或进程 |
| Compatibility Executor | 兼容层 | 将旧的 `CodingEngineAdapter` 包装成当前 `Coding Executor` | 不是新的第二套产品契约 |
| Coding Engine Adapter | 历史内部实现层 | 1.x 用来连接 Fake Engine 或 OpenCode HTTP/ACP 的旧接口 | 不应再被当成当前最高层抽象 |
| OpenCode | 外部执行实现 | 在兼容执行路径中真正完成代码工作的外部 Agent 运行时 | 其内部完整轨迹并不归 DevFlow 控制 |
| Native Coding Executor | DevFlow 自有执行实现 | 使用受控 Native Tools 的窄执行器，执行固定且有界的 plan/read/edit/test/repair 流程 | 目前不是 Claude Code 式通用多轮 Agent 循环 |
| Native Coding Decision Provider | Native 决策层 | 为 Native Executor 返回结构化的 plan/edit/repair 决定 | 不直接写文件；实际副作用由 Native Tools 执行 |
| Native Tools | 本地能力层 | Electron 主进程 控制的读、写和测试能力，带权限、范围和审计约束 | 不是 Agent，也不是 Provider |

## DeepSeek 在哪里

当前保存的 DeepSeek Provider 首先用于需求澄清、方案生成，以及基于知识的门禁审查（Knowledge-Grounded Gate Review）等模型调用。门禁审查以检索到的知识 为依据，对当前 Gate、门禁条件和阶段产物进行审查。

它**不会因为被选为 工作流模型提供方，就自动成为 Coding Agent 的代码执行后端**：

- 走 OpenCode 路径时，真正执行代码的是 OpenCode，模型配置属于该外部执行路径；
- 走 Native Coding 路径时，只有明确选择 `native-provider` 并指定相应 Provider，DeepSeek 才会作为 `Native Coding Decision Provider`；
- 即使 DeepSeek 参与 Native Coding，它也只产生受限的结构化决定，文件读写与测试仍由 Electron 主进程 授权的 Native Tools 完成。

## 从点击按钮到保存证据

```text
点击“Coding Agent”（编码 Agent）
  → Electron Coding Runtime 校验当前开发实现任务
  → 组装编码简报
  → 做预算与能力检查
  → 创建托管工作树
  → 选择满足能力要求的编码执行器
  → 兼容执行器/OpenCode 或原生执行器执行
  → 权限申请按需等待人工处理
  → 运行保存的测试命令
  → 归档编码轨迹、差异产物和测试证据
  → 工作流再根据证据进入后续测试、PR 和人工 Gate
```

## 最重要的三条边界

1. **Provider 负责模型决定，Executor 负责执行契约，Tool 负责具体副作用。**
2. **Coding Agent 是面向用户的整体能力名称，不是与 Executor 并列的另一个底层引擎。**
3. **任何 Executor 都只能产生代码和证据，不能批准 Gate、发布、合并或扩大自身权限。**

## 代码与决策依据

- [ADR 0015：受治理的编码执行器契约](../../adr/0015-governed-coding-executor.md)
- [`CONTEXT.md` 中的 Coding Executor / Coding Agent 术语](../../../CONTEXT.md)
- [`apps/desktop/electron/main.ts`](../../../apps/desktop/electron/main.ts)：Compatibility 与 Native Executor 的选择
- [`apps/desktop/electron/coding-runtime.ts`](../../../apps/desktop/electron/coding-runtime.ts)：编码运行时编排
- [`apps/desktop/electron/native-coding-executor.ts`](../../../apps/desktop/electron/native-coding-executor.ts)：Native Coding Executor
- [`packages/shared/src/coding-executor.ts`](../../../packages/shared/src/coding-executor.ts)：统一合同
