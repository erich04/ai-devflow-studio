<a id="ai-devflow-studio-roadmap"></a>

# AI DevFlow Studio 路线图

本路线图是大版本范围、当前发布、活动优先级、里程碑顺序、已完成里程碑及明确延后工作的唯一事实来源。

需求文档定义里程碑结果，计划定义实施与验证，ADR 记录架构决定，发布证据证明实际交付。其他文件不建立并行路线图；研究和提案只有被本文正式纳入后，才改变产品顺序。

<a id="documentation-map"></a>

## 文档职责图

按职责使用以下文件：

- `docs/roadmap.md`：唯一版本规划入口，负责版本线目标、当前发布事实、里程碑顺序、完成门禁及延后范围。
- `docs/product/prd/`：面向用户的里程碑契约；需求文档本身不决定路线图优先级。
- `docs/plans/`：实施前对照当前代码检查的可执行计划。
- `docs/releases/`：实际发布版本的不可变、绑定候选的证据。
- `CONTEXT.md`：稳定领域语言，如 Run、Gate、Artifact、Skill、MCP Server、Knowledge Base、Test Evidence。
- `docs/adr/`：已接受架构决策与权衡，解释选择原因，不追踪交付进度。
- `docs/engineering/`：工程实践、测试策略、演示/冒烟复现和重复失败经验。
- `docs/knowledge/`：DevFlow 可索引、可审查的 Markdown 知识源，包含标准、规则、ADR 摘要及可复用清单。
- `docs/research/`：研究、比较及调查产物，可为路线决策提供依据，但不是活动计划。
- `README.md`：项目入口、应用/包结构及日常命令。

<a id="product-north-star"></a>

## 产品方向

DevFlow Studio 是**小团队自行托管的 AI 开发流程工作台**。外层确定性工作流治理身份、策略、费用、证据和人工 Gate。

2.x 在该交付模型内增加 DevFlow 原生、可观察、可评估的 Agent 运行时。

桌面端拥有私有仓库执行及完整本地证据的权威；API/Postgres 拥有团队身份、策略、协作意图和脱敏投影的权威。产品演进增强 Agent 能力时，不能削弱这些权限与脱敏规则。

<a id="invariants-across-version-lines"></a>

### 跨版本不变量

- Workflow、Run、Gate、Evidence 保持为确定性外层控制模型。
- Electron 主进程拥有本地源码执行、凭据及完整运行时状态。
- API/Postgres 拥有团队身份、策略、协作命令和脱敏投影。
- Agent、工具、技能、MCP 服务、检索结果或记忆记录均不能绕过人工 Gate。
- 默认 CI 保持确定且无费用；真实提供方签收显式且有界。
- 知识检索和 Agent 记忆不会自动成为治理证据。
- 2.x 执行租户隔离指自托管产品内部组织/项目/用户/会话隔离，不代表公共 SaaS 或托管共享基础设施。

<a id="major-version-charters"></a>

## 大版本范围

| 版本线 | 核心问题 | 包含范围 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- |
| 0.x | 工程基础 | 真实 Electron 执行、持久本地状态、团队同步、知识治理、Gate 策略、受管外部编码 Agent 适配器、运行时可观察性及发布纪律。 | 模拟与显式授权的真实编码路径可在受管工作树执行，保存可审计证据、遵守人工 Gate、仅同步脱敏摘要，并通过可复现验证。 | v0.9.0 完成。 |
| 1.x | 受治理的自托管交付 | 已认证团队试点、桌面配对、项目作用域、策略/预算、持久同步、仓库知识、Web 协作命令、可复现生命周期及人工批准 GitHub 交付。 | 一个已认证工作请求变成一个正式本地 Run，达到经测试和证据支持的交付，只有明确人工批准后才发布分支及 PR。V1.5 是计划内最后一个 1.x 功能里程碑。 | v1.5.0 完成。 |
| 2.x | DevFlow 原生 Agent 运行时 | 有界自有 Agent 循环、原生工具/MCP 执行、可插拔编码执行器、轨迹与评估、限定上下文/记忆、经评估 RAG、多 Agent 编排及租户范围执行。 | 基准场景证明有界单/多 Agent、原生/委托编码、工具/MCP、经评估检索与记忆、失败恢复、租户隔离及可审计轨迹，同时保持工作流/Gate 权限。 | V2.2 完成。 |

各版本线是有限产品契约，不要求不断增加版本。完成门禁通过即结束；剩余想法转为维护、证据支持的新增工作或另行批准的未来范围。

<a id="current-release"></a>

## 当前发布

`v2.3.0` 是已发布基线，GitHub 发布时间为 2026-09-14T03:39:57Z。附注标签指向签收提交 `3b50144b473595d9764139068e312224a393bd82`，直接父提交为候选 `9cec16052149c2a11749f28458152e423bca260b`；不可变证据在 `docs/releases/v2.3.0/release-*`，发布结果见 [GitHub Release v2.3.0](https://github.com/erich04/ai-devflow-studio/releases/tag/v2.3.0)。

负责人于 2026-09-13 明确要求 V2.3，汇集已有原生编码、引导、提供方、批准及已验证交付改进，不新增自动多 Agent 或托管 SaaS 范围。正式签收披露 #124/#125 非阻断观察，包含真实 DeepSeek/原生编码、17/17 样例测试、一次 Web 批准 Draft PR、验收、重启恢复及持久撤销。分发仍包含未签名 macOS Apple Silicon 便携归档；不能据此称 Developer ID 签名、公证或 Windows 安装器已验证。

当前源码包含发布后的改动，尚未发布的分支修复不能自动归入 `v2.3.0` 安装包。实际发布以 [GitHub Releases](https://github.com/erich04/ai-devflow-studio/releases) 为准。

历史 V2.2 发布：2026-08-27 发布的 `v2.2.0` 标签指向 `b4792f45873dd0b3a29b0d08cace68c699e489e0`，候选为 `e7ba425c4c57e736a40d3231bdfe3e70ee33a5a9`，正式记录在 `docs/releases/v2.2.0/release-*`。

历史 V1.5 发布：附注标签解析为签收提交 `bd7de6f82c3a60092816bd947f5590e9f148c3ae`，直接父提交为候选 `f461f9d9de300b8e4a15fe31be8f518bde37b2b8`。

不可变发布证据位于 `docs/releases/v1.5.0/`；该发布提交的全部自有包版本为 `1.5.0`。候选绑定本地矩阵、精确 SHA CI、打包桌面走查、重启/撤销检查，以及真实私有 GitHub 沙箱 Draft PR 走查均通过。已发布桌面归档包 SHA-256 为 `3e44cdfe6d07aa355c259821e2b36f857cbd3ac239bde2ea7c3cdc34abfc449b`。

[GitHub Release](https://github.com/erich04/ai-devflow-studio/releases/tag/v1.5.0) 包含绑定签收的发布产物。

| 层面 | 当前状态 |
| --- | --- |
| 已发布基线 | `v2.3.0` 已签收、打标签并发布 |
| 发布证据 | `docs/releases/v2.3.0/release-*` |
| V1.5 产品契约 | `docs/product/prd/v1.5-github-delivery-prd.md` |
| V1.5 执行历史 | `docs/plans/v1.5-github-delivery.md` 及四份不可变发布证据 |
| 已完成版本线 | 1.x 受治理自托管交付 |
| 发布后的修复 | 草稿 PR #178 验证进行中；未宣称合并或发布 |
| 已完成 2.x 里程碑 | V2.0 原生 Agent 运行时基础；V2.1 经评估检索与记忆；V2.2 多 Agent 与执行租户隔离 |
| 完成证据 | `docs/releases/v2.0.0/`；`docs/releases/v2.1.0/`；`docs/releases/v2.2.0/` |
| 当前 2.x 状态 | V2.3 已发布；后续修复逐项验证 |
| 下一门禁 | 完成真实仓库全流程与逐项证据核验，再关闭已解决 Issue |

有限 1.x 产品线已完成。最终走查证明一个已认证工作请求形成一个正式本地 Run、一个经过测试的提交、一个人工批准 Draft PR，冷重启不重复远端效果，并完成验收及带版本凭据撤销证明。

V2.0 已完成。候选 `dfc74831552a0e8910529420c6383b6474e8a12c` 通过冻结的 15 场景求值器、原生/OpenCode 一致性、零泄露扫描、精确 SHA 首次五作业 Verify、真实 Postgres、Docker 生命周期、Windows、macOS、Electron、打包桌面及专属产物完整性门禁；不可变记录在 `docs/releases/v2.0.0/`。

V2.1 契约集已冻结。V2.1 切片 1 已完成；切片 2 证明确定性无费用混合检索：Recall@K、nDCG@K、平均倒数排名均为 `1.0`，相对词法检索的综合提升为 `0.5`，引用精度与忠实度保持 `1.0`，隔离/提供方违规均为零。切片 3 完成保留数据的结构 21 → 22 迁移、原子当前快照激活、过期身份失效、严格损坏状态拒绝及有界本地重建。

切片 4 完成桌面主进程拥有的限定范围记忆候选、接纳、修订、冲突、检索、过期、删除标记及重启安全清除。切片 5 持久保存精确有界运行时上下文，在外部动作前和持久工具授权预留时双重核验；渲染投影 v2 只提供知识引用/持久记忆来源元数据。

独立严格桌面投影显示有界工作记忆、候选及持久记忆生命周期，包括冲突、实际过期、删除/清除状态、精确修订/头版本和白名单陈述；不包含作用域会话、不透明能力、已删内容、权限摘要、原始输出或本地路径。主进程拥有的人工候选接纳绑定所选运行时、候选 ID、内容及来源摘要，只在主进程构建固定私有用户-项目权限，只返回刷新后的渲染投影。

精确版本陈述修订还绑定所选运行时、当前修订/头版本及当前内容/来源摘要，保留主进程拥有的可见性、敏感度、保留规则和作用域权限。精确版本删除先要求渲染进程明确确认，再在主进程构建人工权限，先提交删除标记再清除派生状态；重启后恢复精确待清除任务，不重建删除权限。

打包桌面已证明一个已接受运行时观察和惰性候选原子提交；精确接纳/修订/删除跨冷重启保留，`memoryRestartDuplicateEffects` 为零，本地 MCP/原生工具计数不增加。

<a id="now--next--later"></a>

## 当前 / 下一步 / 后续

<a id="completed--v21-evaluation-and-completion-gate"></a>

### 已完成：V2.1 评估与完成门禁

V1.5 和有限 1.x 线已发布并完成；V2.0 已有不可变求值器/门禁证据。V2.1 切片 1–5 提供经评估检索、严格引用/记忆契约、崩溃安全本地索引、受管理的记忆生命周期、有界运行时上下文、精确桌面人工动作及打包冷重启零重复证明，切片 6 团队投影也完成。

Team 结构 18 只保存严格单调、脱敏的生命周期/质量元数据，生命周期头与已接受上下文质量各有独立版本；桌面结构 27 经仅元数据 ID 发件箱重新推导，Web 只读 Team Memory 显示质量/生命周期字段，无本地内容或控制权限。

- 冻结精确候选、语料、契约、迁移及产物摘要。
- 要求确定性检索/引用/记忆质量底线，并且隔离、脱敏、删除、付费提供方及重复副作用违规为零。
- 运行完整单元/类型/构建、真实 Postgres、Docker 生命周期、Windows、macOS、Electron、打包重启、迁移保留及专属产物门禁。
- 不可变完成证据只作为通过候选的干净直接子提交记录。

V2.1 契约集已冻结于：

- `docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md`
- `docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md`
- `docs/adr/0018-scoped-agent-memory-lifecycle.md`
- `docs/plans/v2.1-evaluated-retrieval-memory.md`
- `scripts/fixtures/v2.1-retrieval-memory-evaluation.json`

V2.1 切片 1–6 已完成。主进程拥有的不透明能力控制接纳、修订和删除；检索前完成作用域/生命周期过滤；重启安全清除不能复活旧修订；渲染投影 v2 仍仅含元数据；打包桌面冷重启后检索/提供方/工具/记忆效果重复为零。团队投影严格仅元数据且单调，API 和 Web 均不能控制本地执行或记忆。

候选 `2c11faa09f35c4930b3c4cf489469b696ccd84ea` 通过精确求值器、完整本地矩阵、首次五作业 Verify `31712135602` 及专属桌面产物完整性门禁；不可变记录在 `docs/releases/v2.1.0/`。

已被替代的实施阶段标记 `### Now — Run V2.1 Evaluation And Completion Gate`、`| Active milestone | V2.1 Slice 7 — Evaluation And Completion Gate |`、`| Next gate | Freeze the exact V2.1 candidate and run the full completion matrix |` 仅为审计保留原文，分别表示当时运行 V2.1 完成评估、活动切片 7、下一步冻结候选并运行矩阵。以上当前状态表及下方唯一“当前”标题才有现行效力。

<a id="now--release-v23-workflow-improvements"></a>

### 当前：验证并交付已报告问题的修复

V2.0、V2.1 和 V2.2 均已完成，有限的已接受 2.x 线已结束。候选 `c765147be5e86b5b931999c552d951a0c9002562` 通过精确十场景单/多 Agent 比较求值器、完整本地/PG16/Docker/打包矩阵、首次五作业 Verify `31764135684` 及专属桌面产物门禁。不可变 V2.2 完成记录在 `docs/releases/v2.2.0/`。

这些是里程碑完成证据；另行发布的 `v2.2.0` 使用 `docs/releases/v2.2.0/release-*` 及 `docs/plans/v2.2-release-signoff.md`，不重写任何记录。

V2.3 已按 `docs/plans/v2.3-release-signoff.md` 和 `docs/guides/devflow-studio-v2.3-walkthrough.md` 完成独立发布，证据不重写。当前优先级是逐项修复并验证已报告的工作台布局、节点内容层级、会话用量、长时运行及中文文档问题，以真实仓库完整流程补齐证据，再关闭实质解决的 Issue。草稿 PR #178 尚未合并；#135 正式 Developer ID 签名安装验证按负责人决定保留待验证。此维护工作不新增多 Agent/公共 SaaS 范围，也不自动形成新发布。

V2.2 契约集已冻结于：

- `docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md`
- `docs/adr/0019-bounded-multi-agent-coordination.md`
- `docs/plans/v2.2-multi-agent-execution-tenancy.md`
- `scripts/fixtures/v2.2-multi-agent-evaluation.json`

切片 0–6 已完成。共享纯领域层强制冻结 DAG、收窄专职 Agent 权限、不可变交接、单调转换、共享限额和精确租户隔离，保持确定性 V2.0 单 Agent 基线。

桌面结构 28 保存精确的监督 Agent 协调会话及冻结图，以带版本 CAS 应用任务/结果/交接/汇合/检查点变更，提交前强制 256 KiB 元数据边界，重启后重建精确轨迹并拒绝篡改历史。

切片 3 将固定三角色专职注册表绑定主进程不透明任务权限，原子启动子运行时，从已接受转换推导终态结果/用量，精确依赖只汇合一次，无交接的快速失败归因，且只允许一次经 `task_retried` 检查点的确定性 `repository_read` 恢复。同进程和冷重启重放不重复已接受的启动、结果、交接或重试。

切片 4 增加精确并发读者/单写者仲裁、原子预留子预算，将原生工具、可信本地 MCP 和编码执行器授权绑定精确活动专职租约，拒绝转移/重复权限，并在完成或有界恢复前单调结算释放、过期、取消。完整单元、生产构建和 Electron 冒烟通过，V2.0 单 Agent 路径不变。

切片 5 增加严格仅元数据桌面投影，以及主进程拥有的固定计划创建、恢复、专职启动和经确认取消。父取消返回前将全部子运行时和活动租约终态化。打包桌面以部分三任务 DAG 和一个已启动只读专职 Agent 关闭，冷启动不新增会话、任务、运行时、审计或检查点，记录 `coordinationRestartDuplicateEffects: 0`，取消精确子任务，再完成不变的单 Agent/GitHub 交付路径。通用运行时启动恢复通过持久关系归属排除协调会话拥有的运行时，不使用 ID 前缀推断。

切片 6 将 Team 结构 18 迁移到 19，不伪造协调状态；经桌面结构 29 仅 ID 发件箱推导严格仅元数据摘要，保存单调生命周期/质量/用量/违规元数据及不可变审计，呈现精确键的只读 Web 投影。种子/Postgres 一致性、完整单元/类型/构建、真实 PG16、Docker 冒烟及保留数据生命周期迁移/回退均通过。该里程碑不包含开放式群体、远端执行器、托管租户或新发布权限。

<a id="next--require-a-new-charter-for-any-feature-line"></a>

### 下一步：新功能线必须另定范围

- 不自动发布后续 2.x 功能里程碑。未来范围须定义新的有限契约，并经本路线图明确纳入。

<a id="later--evidence-promoted-maintenance-or-a-separately-approved-charter"></a>

### 后续：证据支持的维护或另行批准的范围

- 不自动创建额外功能里程碑。上方 V2.3 已有明确负责人授权；未来功能仍需单独批准并纳入本路线图，遵守相同契约、测试驱动、候选及不可变证据规则。
- 新增 1.x 工作仅限发布缺陷、安全修复、依赖维护或真实试点证据支持的加固；没有计划中的 V1.6 功能里程碑。

<a id="completed-milestones"></a>

## 已完成里程碑

### V2.3：工作流改进发布

已于 2026-09-14 发布。签收提交为 `3b50144b473595d9764139068e312224a393bd82`，直接父候选为 `9cec16052149c2a11749f28458152e423bca260b`。发布汇集原生编码执行器 v2、OpenCode 适配、组织/项目引导、提供方诊断、需求澄清与方案设计，以及有证据支持的测试、PR 和验收流程。

`docs/releases/v2.3.0/release-required-gates.json`、`release-walkthrough.json` 和 `release-github-sandbox.json` 均绑定该候选。独立走查记录见 [V2.3 验收报告](guides/devflow-studio-v2.3-walkthrough-result-2026-09-14.md)，披露了当时的非阻断观察和验证边界；未签名便携包的成功不能替代正式 Developer ID 安装验证。

<a id="v20-native-agent-runtime-foundation"></a>

<a id="v20-native-agent-runtime-foundation-1"></a>

### v2.0：原生 Agent 运行时基础

- 完成契约集：`docs/product/prd/v2.0-native-agent-runtime-prd.md`、`docs/adr/0014-bounded-agent-runtime.md`、`docs/adr/0015-governed-coding-executor.md`、`docs/adr/0016-tool-mcp-execution-authority.md`、`docs/plans/v2.0-native-agent-runtime.md`。
- 增加有界检查点运行时、可观察轨迹、精确停止原因、原生工具注册表、不透明范围授权、可信本地 stdio MCP 及受治理编码执行器一致性。
- 增加窄范围自有编码 Agent、持久桌面恢复、仅元数据团队投影、只读 Web 可见性，以及重启安全权限/工具执行，不绕过工作流/Gate。
- 候选 `dfc74831552a0e8910529420c6383b6474e8a12c` 通过冻结 15 场景无费用求值器：质量/恢复、原生/OpenCode 一致性通过，付费提供方调用及隔离/脱敏泄露为零。
- 精确 SHA 的首次 Verify 在 Docker、生命周期、Postgres/Linux 打包、Windows、macOS 通过，再独立验证专属桌面三件产物。不可变完成证据在 `docs/releases/v2.0.0/`。
- 切片 7 已完成冻结 15 场景求值器；切片 8 已完成绑定候选的不可变发布记录。

<a id="v21-evaluated-retrieval-and-memory"></a>

<a id="v21-evaluated-retrieval-and-memory-1"></a>

### v2.1：经评估的检索与记忆

- 完成确定性混合检索/重排及精确当前引用校验；Recall@K、nDCG@K、MRR 达到 `1.0`，相对词法综合提升 `0.5`。
- 完成限定作用域、不可变、可过期、先写删除标记的记忆，具备精确人工接纳/修订/删除、重启安全清除及动作/授权前过期防护。
- 完成仅元数据单调团队投影和只读 Web 展示，无本地内容或控制权限。
- 候选 `2c11faa09f35c4930b3c4cf489469b696ccd84ea` 通过冻结无费用求值器、零泄露/隔离/删除扫描、完整本地及精确 SHA 跨平台矩阵、专属桌面产物验证；记录在 `docs/releases/v2.1.0/`。
- 切片 7 已完成精确直接子提交完成记录；V2.2 完成有限 2.x 线。

<a id="v22-multi-agent-and-execution-tenancy"></a>

<a id="v22-multi-agent-and-execution-tenancy-1"></a>

### v2.2：多 Agent 与执行租户隔离

- 完成有界监督 Agent 和固定专职协调模型，具有不可变 DAG、收窄权限、精确租户隔离、共享预算/资源仲裁、确定性交接、取消、失败归因及重启安全恢复。
- 完成桌面结构 29 和 Team 结构 19 持久化、仅元数据同步和只读 Web 展示，不增加工作流、Gate、发布或渲染进程执行权限。
- 候选 `c765147be5e86b5b931999c552d951a0c9002562` 通过冻结十场景求值器：综合质量从 `0.5` 提升到 `0.75`，费用/延迟倍数均 `1.25`，新增人工干预和付费调用为零，权限、隔离、终止、重放及脱敏违规均零。
- 候选通过完整本地、PG16、Docker、打包桌面及首次五作业精确 SHA Verify。专属桌面归档 SHA-256 为 `809285036a6fc6589f521ae5006c9db8611d5747acb4bd029b2d5facb04dbfe6`；不可变完成记录在 `docs/releases/v2.2.0/`。
- 切片 7 及 V2.2 已完成，不自动推导新的功能里程碑；V2.3 的后续明确授权见当前发布章节。

<a id="v01-fixture-backed-team-workbench"></a>

### v0.1：基于样例的团队工作台

- 建立初始桌面界面：侧栏导航、工作流画布、检查器、Run 列表、状态指标，以及团队概览、知识、技能、MCP、测试基础视图。
- 增加 Run、Node、Gate、Artifact、Agent Event、Skill、MCP 服务、token 用量、知识库和知识图谱共享领域类型。
- 增加浅色、深色及跟随系统主题。
- 增加核心 UI 流程的单元和浏览器 Playwright 覆盖。

<a id="v02-local-test-execution-slice"></a>

### v0.2：本地测试执行切片

- Electron 主进程 IPC 支持选择本地项目、检测元数据、保存/运行测试命令及加载本地状态。
- SQLite 持久化本地项目、工作流 Run、产物、事件及测试证据。
- 检测常见 JavaScript 包管理器测试命令。
- 证据保存前脱敏 stdout/stderr 敏感内容。

<a id="v021-real-electron-demo-loop"></a>

### v0.2.1：真实 Electron 演示流程

- 增加 `corepack pnpm dev:electron` 真实桌面开发入口。
- 增加 `corepack pnpm test:electron-smoke`，覆盖真实窗口、预加载 API、受控 IPC、本地 Shell 执行及 SQLite 持久化。
- 增加测试命令安全检查，阻止破坏性 Shell 模式。
- 增加 SQLite 结构版本追踪。
- 从界面移除把 HoneyAI/OpenCode 当活动产品的样例说法。
- 测试视图增加命令、退出码、耗时、脱敏状态及输出摘要。

<a id="v02-final-local-state-stabilization"></a>

### v0.2 收尾：本地状态稳定

- 新 Run 立即持久保存，不只留在 React 状态。
- 保存 Gate 批准并生成批准事件。
- SQLite 保存 MCP 服务启停状态。
- SQLite 保存 Electron 主题，浏览器预览回退 localStorage。
- 分离种子样例和真实 SQLite 状态，避免本地 Run 混入样例产物/事件。
- 搜索框过滤 Run、产物、事件和知识标签。
- 增加 `DataOrigin = 'seed' | 'local' | 'remote' | 'adapter'` 及本地执行状态类型，使 v0.3 可增加远端同步而不替换本地切片。

<a id="v02-final-validation-stabilization"></a>

### v0.2 收尾：验证稳定

- 稳定真实 Electron 冒烟中选择新建 Run 和 Gate 的路径。
- 修复冒烟等待后，`corepack pnpm verify` 多次通过。
- 变更仅限测试稳定与文档，不增加 v0.3 后端功能。

<a id="v03-team-backend-synchronization"></a>

### v0.3：团队后端同步

- 增加团队结构、初始 Postgres 迁移、演示种子 CLI 及带演示种子回退的 `pg` 仓储选择器。
- API 从直接样例改为仓储/路由边界，提供 Run、团队概览、Skills、MCP 定义及脱敏摘要。
- Web 管理控制台经客户端连接 `/api/team/overview`，不直接导入样例。
- Electron SQLite 保持本地/离线/私有边界，只同步已批准摘要或脱敏证据。
- 增加远端同步 IPC/客户端，加载团队快照及上传 Run/测试证据摘要，原始 stdout/stderr/cwd 保持私有。
- 显式同步后，桌面团队概览及顶部项目/费用指标使用远端项目、成员和费用汇总。
- 增加演示会话及租户/项目/成员角色边界，Web/Electron 显式演示请求头和 `DEVFLOW_REQUIRE_AUTH=true` Postgres 冒烟；此为历史演示契约。
- 增加 `corepack pnpm test:postgres-smoke` 和真实 Postgres 服务 GitHub Actions。
- 增加 `corepack pnpm test:cross-platform` 及 Windows CI 类型/单元/审计保障。

<a id="v04-knowledge-governance"></a>

### v0.4：知识治理

- 增加 `KnowledgeSourceFile`、`KnowledgeDocument`、`KnowledgeReference`、`KnowledgeGovernanceCheck` 类型。
- 为标准、测试证据规则、PR 清单、ADR、Skill/MCP 规则增加 Markdown 索引。
- 增加标准/术语节点和 `defines` 关系的轻量图谱投影。
- 共享引用/检查辅助函数将 Run、产物、测试证据及 Gate 决策关联到相关标准。
- 桌面检查器增加治理检查，知识页增加 Git Markdown 索引、图谱、标签、来源路径及当前 Run 引用。
- 在 `docs/knowledge/` 增加代表性 Markdown 来源。

<a id="v04x-knowledge-retrieval--rag-ready-hardening"></a>

### v0.4.x：知识检索与 RAG 准备加固

- 章节级知识片段使用稳定内容哈希，识别来源版本。
- 在工作流上下文与知识引用之间增加检索推荐层。
- 词法检索元数据包含策略、评分、来源章节和内容哈希。
- 治理检查仍依赖证据；Run 级检索引用本身既不满足也不违反标准。
- 增加 ADR 0007，在未来 RAG 前固定检索推荐和治理证据边界。

<a id="v05-knowledge-review-agent-workbench"></a>

### v0.5：知识审查 Agent 工作台

- 增加共享知识审查核心，支持确定性模拟及 OpenAI 兼容提供方。
- Electron 经预加载 IPC 运行本地 Agent，SQLite 保存 Review、Trace、Token Usage、`agent_review` 产物和事件。
- API 使用相同共享核心及 Postgres 仓储运行后端 Agent。
- 提供方凭据流程只向 UI 返回掩码元数据。
- 桌面 Agent 工作台及检查器 `Agent Review` 动作显示提供方状态、历史、轨迹、仅警告 Gate 建议及费用来源。
- Web 管理控制台展示并可经服务端动作触发后端知识审查。
- Electron `RemoteAgentReviewSummary` 脱敏同步使本地审查摘要进入团队状态，不上传提示词、原始轨迹、本地路径或命令输出。
- ADR 0008 固定仅警告 Gate 建议及双运行时共享核心边界。

<a id="v060--v06x-opencode-coding-adapter-foundation"></a>

### v0.6.0 / v0.6.x：OpenCode 编码适配器基础

- 技术试探比较 `opencode serve` HTTP 与 `opencode acp`，选择 HTTP 为首个受管传输。
- 增加编码 Run、事件、权限请求/决定、受管工作区、依赖准备证据、差异产物和脱敏远端摘要类型。
- SQLite 结构 v4 保存编码 Run、权限、工作区、依赖证据及差异。
- 确定性模拟编码框架创建受管 Git 工作树、请求权限、批准后写标记文件、捕获脱敏差异并归档依赖证据。
- 共享开发任务资格辅助函数将启动限定于 DevFlow 实现任务节点。
- 模拟运行时从 Run 产物、知识引用、治理检查、Gate 决定及已有测试证据组装编码上下文。
- 推送 IPC/预加载订阅状态、事件和权限，`subscribeCodingRun` 仍提供快照/重放。
- 权限超时过期，已批准模拟编码后保存工作树测试证据。
- 桌面 Agents 支持运行模拟编码、批准/拒绝权限、取消及打开/删除受管工作树。
- 已测试 HTTP 适配器封装会话创建、权限、回复、中止、发送提示词及获取差异。
- 同一接口下增加环境开关控制的真实 `opencode-http` 适配器，包含受管 `opencode serve` 生命周期、环境注入、权限回复、中止、脱敏差异、依赖准备及默认跳过的 `test:opencode-smoke`。
- macOS 上以 OpenCode `1.17.5`、火山引擎 Ark `double/ark-code-latest` 手工签收真实运行时，包括 `bash -> edit -> bash -> bash` 多步权限和工作树差异/测试证据。
- 经 Electron、API 路由、Postgres 概览增加脱敏 `RemoteCodingAgentSummary` 同步。
- 增加 ADR 0009 和 v0.6 计划/研究文档。

<a id="v07-configurable-gate-enforcement-policy"></a>

### v0.7：可配置门禁执行策略

- 增加 `EnforcementAction`、组织策略下限、项目覆盖夹取、有效策略来源、受保护 Gate 检测和 `canApproveGateNow`。
- 默认只警告，人工批准仍是开箱行为。
- 推荐执行预设提供确定性的缺失审查、测试标准及 API 契约阻断规则。
- 校验器禁止项目覆盖定义下限/硬阻断，概率性 Agent 意见绝不能硬阻断。
- 知识审查及远端摘要增加策略意见。
- Postgres 结构 v3 增加执行策略、Gate 覆盖决定及 Agent 策略意见表。
- API 增加策略读写、执行求值及 Gate 覆盖路由。
- Web 团队控制台增加策略面板及应用推荐预设动作。
- Electron SQLite 结构 v5 保存策略快照及 Gate 覆盖。
- 预加载 IPC 支持策略加载/求值/覆盖；主进程批准处理器写入前复核策略。
- 2026-06-18 对已提交状态完成 `verify`、`build`、临时 Postgres 策略/覆盖冒烟和真实 Electron 直接批准拒绝冒烟签收。
- 增加 ADR 0010。

<a id="v07x-enforcement-ux-and-reconciliation-hardening"></a>

### v0.7.x：门禁体验与状态核对加固

- 检查器完善策略来源、阻断原因、硬阻断处理建议及暂定/已确认覆盖展示。
- `corepack pnpm dev:electron` 显式传入应用路径，不回退 Electron 默认应用。
- 团队项目无权威策略缓存时使用 `blocked_policy_unavailable`；纯本地项目仍默认只警告。
- 桌面批准前尽力在线刷新策略；失败保留最后缓存，无缓存则阻止。
- `/api/sync/run-summary` 拒绝 `approval` 摘要，使批准类写入必须经过 Gate 执行路径。
- 服务器确认覆盖记为已接受，网络失败保留暂定，服务器拒绝显示拒绝/阻断。
- 增加 v0.7.5 测试策略、演示/冒烟复现及贡献签收文档。
- Gate 执行路径提取为专用 Hook 和检查器面板，降低 `App.tsx` 耦合，不作广泛 UI 重构。

<a id="v08-policy-aware-delivery-automation"></a>

### v0.8：遵循策略的交付自动化

- 增加共享处理建议模型，根据 Gate 执行、知识治理检查、Agent 策略意见、测试证据及知识引用确定性生成建议。
- 人工批准重试的编码简报增加处理建议上下文，渲染输入仅限 ID 和用户指令。
- 增加 Electron `startRetryAttempt` IPC、SQLite 重试持久化、检查器行动入口及 Agents 重试历史。
- API/Web 管理报告增加脱敏策略交付摘要，含警告、阻断、覆盖、处理建议、重试和证据缺口计数。
- 保持人工批准交付范围，无自动修复循环、Gate 绕过、真实 MCP 策略执行或 HoneyAI 桥接。
- 2026-06-19 完成发布式验证：`corepack pnpm verify`、`corepack pnpm build`、临时 Postgres 冒烟，以及从处理建议重试到测试证据的 Electron 冒烟。

<a id="v081-release-signoff-and-version-alignment"></a>

### v0.8.1：发布签收与版本对齐

- 仓库设为公开以解除候选 GitHub Actions 阻断，运行 `27863202387` 通过 macOS、Windows、Postgres 集成。
- 修复 CI 发现的仅 Windows 知识样例路径规范化失败。
- 自有包对齐 `0.8.1`，自动验证通过后建立附注 `v0.8.1` 标签。
- 最终人工走查保留为标签后验收清单，因为当时电脑操作能读取 Electron，但不能可靠点击完整流程。
- 见 `docs/plans/v0.8.1-release-signoff.md`。

<a id="v09-real-opencode-runtime--observability--demo-readiness"></a>

### v0.9：真实 OpenCode 运行时、可观察性与演示准备

- 对本地 OpenCode `1.17.5` 复核真实契约，记录不含秘密的火山引擎 Ark OpenAI 兼容配置。
- 加固生命周期：用户取消为 `cancelled`，权限/运行超时为 `timed_out`，可用时使用 POSIX 进程组；工作树清理记录 `deleted`/`cleanup_failed`，不吞失败。
- Agents 显示运行时标签、终态、权限时间线、变更路径、依赖/测试证据和清理状态，不暴露原始工作树/源码路径。
- v0.9.x 工具/技能时间线记录有权限依据的 `tool_call` / `tool_result` 事件及脱敏元数据。缺少技能元数据时标为推断/未知，不伪造内部技能调用栈。
- 双路径签收完成 v0.9：确定性模拟引擎 `verify`、`build`、临时 Postgres、默认无费用冒烟跳过，以及配置的火山引擎真实冒烟。2026-06-20 发布后真实冒烟也通过：提供方 `double` / 模型 `ark-code-latest`，约 1 分 38 秒，`bash -> edit -> bash` 权限、样例测试证据及工作树清理。
- 见 `docs/plans/v0.9-real-runtime-observability.md`。

<a id="v10-team-pilot-foundation"></a>

### v1.0：团队试点基础

- 从项目展示打包转为最小自托管团队试点：小团队登录、建项目、桌面配对、同步脱敏流程摘要并在 Web 查看。
- v1.0a 正式定义 `User`、`AuthAccount`、认证会话及身份支持的团队投影，不创建并行成员来源。
- v1.0b 完成 GitHub OAuth/最小项目、首用户组织 owner 初始化、会话 Cookie、退出登录及仅 owner 建项目。
- v1.0c 完成一次性配对码、限定桌面 Bearer Token、凭据边界存储及脱敏认证同步。
- v1.0d 完成 API/Web/Postgres Compose、`.env.example`、自托管指南及 CI Docker 冒烟。
- 保留 v0.9 验证规则：默认 CI/`verify` 用模拟引擎，真实 OpenCode/付费调用仅显式冒烟签收。
- v1.0.0 本地确定性验证及 GitHub Actions Docker、Postgres、Windows、macOS 签收通过。
- 见 `docs/plans/v1.0-team-pilot-foundation.md` 和 `docs/plans/v1.0-release-signoff.md`。

<a id="v11-runtime-cost--budget-guard"></a>

### v1.1：运行时费用与预算守卫

- 真实 OpenCode 路径增加项目/Run/用户/提供方费用汇总，模拟验证仍无费用。
- 增加项目预算阈值及超限真实运行的 lead 批准。
- Electron 编码运行时在提供方调用前估算费用，付费工作前调用团队预算求值器。
- Postgres 保存预算策略、批准及脱敏编码费用摘要。
- 团队费用汇总和远端编码摘要包含脱敏运行时费用。
- 见 `docs/plans/v1.1-runtime-cost-budget-guard.md`。

<a id="v12-runtime-cost-ux--budget-administration"></a>

### v1.2：费用体验与预算管理

- Web 团队控制台支持查看/保存预算策略。
- 支持创建和列出预算批准。
- 桌面预算轨迹显示预计/当前/上限费用、原因及批准 ID。
- 对 `requires_lead_approval` 增加明确的 `Retry with approval`（使用批准重试）流程。
- 保持 v1.1 边界：桌面只传批准 ID，团队 API/运行时在求值前解析完整批准记录。
- 默认 CI 不做付费真实验证。2026-06-21 v1.2 签收在本地火山/豆包配置运行发布专用真实冒烟，补充工具轨迹命令元数据路径脱敏后确认原始输出 `opencode smoke passed; changed paths: devflow-opencode-smoke.txt`。
- 见 `docs/plans/v1.2-runtime-cost-ux-budget-administration.md`。

<a id="v13-delivery-flow-verification-and-release-hardening"></a>

### v1.3：交付流程验证与发布加固

- 已发布 `v1.3.0`，包含基于请求的六阶段流程、可信主进程命令、原子本地证据写入、项目绑定同步、本地优先合并、脱敏和最终验收检查。
- 对绑定候选的 macOS、Windows、Postgres、Docker、Electron、构建/输出、已配对电脑操作及一次明确授权真实 OpenCode 冒烟完成签收。
- 在签收提交 `06f3cc3` 发布；发布后 `main` 修复附注标签检出工作流，未移动标签。
- PR 交付保留为人可读产物，真实 GitHub 发布留给 V1.5。

<a id="v14-pilot-trust-boundary"></a>

### v1.4：试点信任边界

- 已发布 `v1.4.0`，附注标签解析到签收提交 `e746843c1943755c50c8fb060bdf533b06442232`，直接父提交为候选 `b7986d4faec2f8f1bcc220a0341cb0686286209e`。
- 真实付费编码/知识审查在预算权威缺失、无效、未认证、超范围或不可用时拒绝继续。
- 持久同步发件箱为脱敏团队投影提供有界退避、重启恢复、不可变项目作用域、幂等交付及操作员恢复状态。
- 有界本地 Markdown 接入 Gate、Review、Coding，不隐式上传仓库内容；V1.4 API Review 知识来源仍为 `none`。
- 完成已认证 Web 工作请求、Run 选择、桌面配对及 Gate 命令，不产生第二工作流权威。
- 完成可复现未签名试点部署、保留数据升级、升级失败恢复、有限回退及打包桌面验证。
- 候选绑定本地矩阵、精确 SHA CI、打包电脑操作及一次明确授权真实 OpenCode 冒烟通过，无自动重试。
- 契约与历史保留在 `docs/product/prd/v1.4-pilot-trust-boundary-prd.md`、`docs/plans/v1.4-pilot-trust-boundary.md`、`docs/plans/v1.4-release-signoff.md`。
- 不可变发布证据见 `docs/releases/v1.4.0/`。

<a id="v15-github-delivery-integration"></a>

### v1.5：GitHub 交付集成

- 增加项目到仓库交付设置，正式受管工作树和预期本地提交作为分支发布/GitHub 比较来源。
- PR 交付包提供 Draft PR 标题、正文、证据链接和审查上下文，是交接产物，不是源码或 Git 身份。
- 采用 GitHub App，OAuth 仍只负责身份；App 凭据留在既有 Team/桌面凭据边界。
- 分支发布和 PR 创建必须明确人工批准。
- 推送/创建保持幂等、可审计、可恢复，绑定预期项目、仓库、分支、提交和证据版本。
- 提供并验证最小交付凭据撤销路径；更丰富管理体验留给证据支持的维护。
- 不静默合并、强推、扩大仓库权限，不把 GitHub 状态视为正式本地 Run 权威。
- 保留显式 Revise、Resume、Retry、Stop，不复用旧批准，不让后台调度恢复人工恢复状态。
- `v1.5.0` 发布于签收提交 `bd7de6f82c3a60092816bd947f5590e9f148c3ae`，直接父提交为候选 `f461f9d9de300b8e4a15fe31be8f518bde37b2b8`。
- 候选绑定本地、打包、精确 SHA CI、Postgres、Docker 生命周期、重启、撤销、脱敏和真实私有 GitHub 沙箱门禁通过。
- 不可变完成证据在 `docs/releases/v1.5.0/`，绑定签收产物已发布于 `v1.5.0` GitHub Release。
- 契约/权限决定在 `docs/product/prd/v1.5-github-delivery-prd.md`、`docs/adr/0013-github-app-delivery-authority.md`、`docs/plans/v1.5-github-delivery.md`。

<a id="1x-completion-gate"></a>

## 1.x 完成门禁

一位未编写或修改冻结候选、且不是维护者的独立操作员，仅按文档中的 Web 和打包桌面步骤，就能将一个已认证工作请求推进为一个正式本地 Run，1.x 产品线才算完成。运行前 App 安装和秘密注入可由准备人员进行；运行开始后通过 Shell、直接 API、SQL、GitHub CLI 修复，或未记录的维护者干预，均使门禁失败。

Run 必须无需临时维护者协助，完成受治理本地实现、测试证据、人工批准 GitHub Draft PR 发布及验收。还需验证脱敏、显式发布权限、有界恢复、可撤销凭据、确定性默认 CI，核心路径没有未解决 P0/P1 缺陷。

门禁后 1.x 默认转维护，不自动产生 V1.6/V1.7 功能里程碑。

<a id="2x-agent-execution-model"></a>

## 2.x Agent 执行模型

该模型解释确定性流程控制、有界模型使用、自主 Agent 工作及修改代码的执行如何配合。它是稳定的 2.x 方向，不能据此称当时 1.x 运行时已实现每一层。

| 层 | 负责内容 | 使用时机 | 产品定位 |
| --- | --- | --- | --- |
| 确定性工作流 | Run 状态、身份、策略、预算、证据、人工 Gate，以及动作能否启动/推进。 | 每条受治理交付路径。 | 1.x 已存在，2.x 仍是外层控制面。 |
| 单次 LLM 操作 | 一次有界提供方请求，使用已组装上下文并校验结果，没有自主工具循环。 | 输入足够完成窄范围摘要、分类、审查或产物生成。 | 知识审查是示例；持久轨迹和产物不代表迭代 Agent 循环。 |
| DevFlow Agent 运行时 | 有界观察、决策、行动、检查点、评估和停止循环。 | 需探索、响应工具/MCP 结果、修订计划或选择已批准执行器。 | V2.0 已实现，由 DevFlow 拥有；区别于工作流和编码执行器。 |
| 编码执行器 | 限定仓库读取/修改、命令、测试及结构化差异/测试/终态结果。 | 已批准工作需检查或修改代码。 | OpenCode 和窄范围自有编码 Agent 实现相同受治理执行契约。 |

确定性工作流仍是外层权威，开始前建立作用域、策略、预算和人工批准，随后保存接受的证据并控制阶段转换。运行时只能选择当前 Run 已允许的能力；运行时和编码执行器都不能自行发布、合并、扩大作用域或绕过人工 Gate。

<a id="routing-rules"></a>

### 路由规则

1. 有界输入已足够，且不需自主探索/工具迭代时，使用单次 LLM 操作。
2. 下一步依赖观察、检索、工具/MCP 结果、检查点状态或迭代评估时，使用 DevFlow 运行时。
3. 已批准工作需检查/修改仓库、运行命令或产出测试/差异证据时，使用编码执行器。
4. 执行器事件/结果交回运行时评估，同时交回确定性工作流用于证据、策略复核及人工 Gate 决策。

1.x 编码路径直接调用已有 `CodingEngineAdapter`；2.x 运行时只能从当前 Run 已通过能力/策略批准的集合中选择执行器。

<a id="executor-adoption"></a>

### 执行器采用

- V2.0 增加 DevFlow 运行时，保留 OpenCode 为首个外部编码执行器；DevFlow 拥有编排、上下文、工具/MCP 策略、检查点、评估及路由。
- V2.0 同一契约后增加刻意窄范围的自有编码 Agent，证明原生代码循环，不宣称与 OpenCode 功能对等。
- 后续可评估其他 CLI 适配器；Codex CLI 和 Kimi Code 是候选，不是已承诺集成。
- 选择必须基于能力、受策略限制、可观察、可取消，并使用同一质量、延迟、费用、干预和恢复场景衡量。

OpenCode 仍是外部 Agent 运行时；DevFlow 只评估适配器暴露的事件、差异、测试证据和终态结果，不宣称掌握其私有内部轨迹。

单个 DevFlow Agent 委托 OpenCode 本身不足以满足 V2.2 多 Agent 声明，仍要求自有协调、交接、终止和比较评估。

ADR 0015 在原生执行器实施前，已明确演进并替代 ADR 0009 的仅外部编码 Agent 定义；ADR 0014/0016 冻结运行时及工具/MCP 权限边界。

<a id="2x-planned-milestones"></a>

## 2.x 规划里程碑

以下保留结果契约，不是预先批准的实施设计。每个里程碑在产品代码开始前需要限定范围需求及必要 ADR；实际完成结果见上方已完成里程碑。

### v2.0：原生 Agent 运行时基础

- 有界自有 Agent 循环，明确成功、失败、取消、超时、预算及步数上限停止原因。
- 保存检查点、恢复和可审计轨迹，不暴露隐藏推理。
- 将 `CodingEngineAdapter` 演进为统一编码执行契约，涵盖能力、范围请求、权限/工具事件、取消、测试/差异证据及终态结果。
- 现有适配器接口保留 OpenCode 为首个外部执行器。
- 增加一个刻意窄范围的自有编码 Agent，证明原生仓库工具、测试反馈、修复及确定性停止，不宣称功能对等。
- 原生 Agent 实施前批准演进 ADR 0009 和 `CONTEXT.md` 的 ADR。
- 为明确接受的场景增加原生工具注册/执行，以及有界 MCP 发现、定义校验、生命周期、权限、期限、取消及审计。
- 定义并强制场景所需执行作用域，不削弱组织、项目、凭据或桌面权威边界。
- 建立可复现场景数据集及单 Agent 质量/费用/延迟基线。
- 工作流及人工 Gate 权限保持在非确定 Agent 循环之外。

V2.0 完成要求：一个自有 Agent 通过原生工具/MCP 完成基准工作，可从检查点恢复、确定性停止并产出可审计轨迹。同一运行时还须经 OpenCode 和窄范围自有执行器完成受治理编码场景，结构化事件、取消、证据和 Gate 行为可比较。

### v2.1：经评估的检索与记忆

- 在词法基线上增加向量检索、混合排序、重排、引用及检索评估。
- 增加租户、用户、项目、会话范围的短期/长期记忆。
- 定义权限、冲突、版本、保留、过期、接纳、删除及审计语义。
- 工作流状态、仓库知识和 Agent 记忆保持独立产品概念。
- 用带版本语料衡量质量/引用忠实度，不把有向量数据库视为完成。

V2.1 完成要求：相对词法/无记忆基线，检索和记忆改善指定基准结果，且引用、隐私和跨租户隔离无回退。

### v2.2：多 Agent 与执行租户隔离

- 一个有界监督 Agent 加少量专职 Agent，不建立开放式群体。
- 采用有依赖任务图、限定上下文、基于证据交接、汇合、环检测、终止、取消传播及共享预算。
- 增加能力范围委托、有界资源控制、执行隔离及跨租户反向测试；具体机制由需求和 ADR 确定。
- 归因失败，按质量、费用、延迟和人工干预，将所选多 Agent 场景与 V2.0 单 Agent 基线比较。

V2.2 只有在所选任务可衡量地优于单 Agent，同时不违反费用、终止、证据或租户隔离约束时才完成。

<a id="2x-completion-gate"></a>

## 2.x 完成门禁

文档化、可重复场景覆盖有界原生循环、已接受的原生 MCP、经评估 RAG/记忆及有依据的多 Agent 协调，才算 2.x 完成。场景还须在已有工作流/Gate 权限模型内证明执行租户隔离、失败恢复及可审计轨迹。

原生和委托编码执行器共用治理契约，不能形成独立交付权威。V2.2 后默认转真实试点、面试/演示文档、安全/依赖维护和证据驱动修复。

不会自动新增后续功能版本；上方 V2.3 属于另行明确批准且已完成的发布。公共 SaaS 或实质不同产品方向仍需单独批准未来大版本范围。

<a id="evidence-promoted-maintenance-backlog"></a>

## 证据支持的维护待办

负责人在 2026 年 9 月 open issue 处理期间明确纳入 #128：一个已认证、自托管 Postgres 部署可选择启用独立组织。ADR 0023 和多组织验证记录定义范围/证据。这是实现工作，不是已发布版本或公共托管 SaaS 范围；上方发布基线不变。

以下条目仅在试点证据、发布风险或安全要求支持后安排版本，不再预留自动 V1.6/V1.7：

- 超出已验证 V1.4 生命周期的备份/恢复及回退指引。
- 超出最小已验证 1.x 路径的凭据撤销管理，以及成员管理、审计审查体验。
- 更多认证和配对反向冒烟覆盖。
- 两到三个桌面端冲突可见性及协作恢复。
- Windows 真实 OpenCode 受管工作树验证。
- 签名/公证安装器、自动更新及更广公开分发。

<a id="explicitly-deferred"></a>

## 明确延后

- 公共 SaaS、计费、企业 SSO、托管共享基础设施多租户及提供方凭据托管。
- 自动云部署、大组织管理或 10 个以上客户端并发。
- HoneyAI 适配器或执行引擎桥接。
- 仓库文件监听、应用内 Markdown 编辑器及隐式远端知识同步。
- 替代 GitHub、CI、Issue 跟踪或人的交付责任。

<a id="knowledge-evolution"></a>

## 知识演进

知识是跨版本能力，不另建路线图：

- v0.4 引入 Git/Markdown 治理、片段、词法检索、引用及“检索命中不等于治理证据”的规则。
- v1.4 将有界真实仓库 Markdown 接入本地 Gate、Review、Coding，不隐式上传原文。
- v2.1 已增加经评估混合检索和 Agent 记忆，同时保留知识来源、权限、脱敏及删除语义。

Git 中 Markdown 仍是团队标准和可复用知识的可审查事实来源，DevFlow 索引并引用，不静默替换。Agent 和人工 Gate 可将检索知识用作上下文，但是否满足标准仍由证据与策略决定。

<a id="tracking-policy"></a>

## 追踪规则

- 不建并行路线图。所有版本目标、当前发布事实、里程碑顺序、完成门禁及延后范围统一使用本文。
- 需求定义用户结果，`docs/plans/` 定义实施/验证；本文列入当前、下一步或后续前，不取得路线优先级。
- ADR 记录架构决定，`CONTEXT.md` 记录领域语言，`docs/research/` 保存调查/比较。
- 只保留一个“当前发布”章节及一个活动“当前”优先级。
- 发布后第一次文档修改更新“当前发布”“已完成里程碑”“当前”，不移动或重写发布标签/证据。
- 计划里程碑完成后，将持久摘要移入“已完成里程碑”，当前发布章节不残留候选说法。
- 未经本文纳入的提案、需求、计划、ADR 或研究，不改变产品顺序。
