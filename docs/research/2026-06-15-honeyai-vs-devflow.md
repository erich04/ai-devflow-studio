<a id="honeyai-vs-ai-devflow-studio"></a>

# HoneyAI 与 AI DevFlow Studio 对比

> **历史研究快照，不是当前产品计划。**
>
> 观察于 2026-06-15。[HoneyAI](https://github.com/xiaohanarch/HoneyAI) 是 xiaohanarch 的外部项目，并非 AI DevFlow Studio 维护者编写或拥有。
>
> 下文整合与桥接仅记录当时假设，不是当前承诺；以 [DevFlow 路线图](../roadmap.md)为准，HoneyAI 桥接已延后。

- 状态：historical-research-snapshot。
- 日期：2026-06-15。
- 外部来源：xiaohanarch/HoneyAI。

<a id="snapshot"></a>

## 快照

两者都面向团队 AI 软件交付，但当时处在不同层次：HoneyAI 强项是自托管 DevPipeline 执行引擎，包含需求/设计 IR、实现、Gate、PR、费用、SSE、数据库、Worker、沙箱和适配器；DevFlow 强项是团队工作台，包含 Electron 本地执行方向、工作流画布、管理概览、知识图谱、Skill/MCP、测试、用量及主题交互。

<a id="current-runtime-observation"></a>

## 当时的运行观察

HoneyAI 启动于 http://127.0.0.1:3000，DevFlow 已运行于 http://127.0.0.1:5173。

HoneyAI 页面：

- /t/alice/runs：认证列表，含一条种子 Run 的最小列表。
- /t/alice/runs/<runId>：认证详情，显示标题、描述和状态。
- /prototype/run-detail.html?runId=<runId>：高保真 DevPipeline 原型，展示成熟流程、产物栏、审查 Gate、PR 面板、费用表和 IR 演进链。

DevFlow 的 / 页面是样例驱动桌面工作台，具备侧栏、画布、选中节点 Inspector、产物、事件、Gate/测试动作、指标、Skill/MCP/Knowledge/Test 页面，以及深浅/跟随系统主题。

<a id="difference-matrix"></a>

## 差异矩阵

| 维度 | HoneyAI | AI DevFlow Studio | 当时判断 |
| --- | --- | --- | --- |
| 定位 | 一句话需求到 GitHub PR 的 AI DevPipeline | 团队开发平台、桌面及管理台 | 互补 |
| 用户 | 5–10 人团队，尤其技术负责人和中级工程师 | 开发者日常与负责人/管理者概览 | DevFlow 受众更广 |
| 真实界面 | 最小 Next 列表/详情 | 已实现丰富工作台 | DevFlow 界面更完整 |
| 原型 | 强静态详情/配置原型 | 已实现界面 | 可借鉴 HoneyAI 交互 |
| 流程 | 需求、设计、编码/单测三阶段，风险阶段间有 Gate | 澄清、设计、开发、测试、PR、验收六阶段 | DevFlow 覆盖团队完整周期 |
| 执行 | Worker、编排、沙箱、LLM 适配器 | 当时本地 Agent 计划中，API/Worker 为占位 | HoneyAI 执行后端更成熟 |
| 数据 | Postgres/Drizzle、产物、事件、Gate、租户、费用事件 | TypeScript 契约/样例，已文档化 Postgres/SQLite 边界 | HoneyAI 持久化基础更强 |
| 可观察性 | 已设计并部分接通 SSE、事件、IR、费用 | 界面已有事件卡与 Inspector | 各有后端与操作界面优势 |
| 知识 | skill/rule/command/script/hook/hint/template/context 资产 | Git Markdown 知识库与轻量图谱 | DevFlow 产品概念更明确 |
| Skill/MCP | Skill 属于资产，MCP 非当时核心 | 独立一级页面 | DevFlow 适配 Codex/团队工具管理 |
| 测试 | 第三阶段含单测，原型将 SIT 放 V2 | 独立证据阶段和页面 | DevFlow QA 流程更明确 |
| 管理 | 有租户/Run/费用，缺成熟管理看板 | 外壳已有团队概览 | DevFlow 更利于团队协作 |
| 部署 | k3s/ECS 上自托管 Next.js，配 Postgres/Redis/MinIO | 桌面及 Web/API/Worker | 运维边界不同 |

<a id="recommended-convergence-historical-hypothesis"></a>

## 推荐整合：历史假设

当时不建议立刻合并项目，而是设想 HoneyAI 作为执行引擎与领域事实源、DevFlow 作为团队体验和桌面。桥接适配器将 HoneyAI 的 Run、Node、Gate、Artifact、Event 和费用映射进 DevFlow 画布/看板，复用后端投入并避免重写桌面。这是历史假设，不是现行架构承诺。

<a id="what-to-reuse-from-honeyai"></a>

## 可借鉴 HoneyAI 的部分

Run/Node/Gate 状态机，RequirementIR/DesignIR/ImplementationIR，产物及 blob，阶段费用事件，SSE 事件与 Run 流端点，GitHub PR 和租户隔离，以及原型中的执行栏、产物栏、审查 Gate、PR 横幅、费用表、工具轨迹和 IR 演进链。

<a id="what-to-keep-from-devflow-studio"></a>

## 保留 DevFlow 的部分

Electron 开发者客户端、六阶段术语、画布/Inspector、负责人概览、知识图谱/Git Markdown、一级 Skill/MCP、深浅与系统主题、单元及 Playwright 测试框架。

<a id="main-tension"></a>

## 主要术语冲突

Skill 有多重含义：HoneyAI 中属于更广的 Asset；DevFlow 中是可复用团队流程能力，MCP 服务器另为工具连接器。建议术语为：

- Asset（资产）：HoneyAI 中任意可复用已存内容。
- Skill（技能）：可影响 Agent 工作流的流程能力。
- MCP Server：带权限与审计策略的可调用工具连接器。
- Knowledge Base（知识库）：规范、词汇、样例、决定的 Git/Markdown 事实源。

<a id="next-mvp-bridge-historical-proposal"></a>

## 最小桥接：历史提案

当时设想的小范围验证：增加 HoneyAI 适配包，将演示 API/数据库映射为 WorkflowRun，在画布显示真实 Run；未接真实动作前禁用 Gate/测试按钮，并增加快照及 Playwright 测试，以证明可组合而不承诺全面迁移。
