<a id="module-4-给-agent-装上护栏"></a>
# 模块 4：给 Agent 装上护栏

<a id="teaching-arc"></a>
## 教学主线
- **比喻：** 登山队出发许可。队员拿到指定路线、有效证件、氧气与时间预算，还要按检查点回报；“有能力爬山”不等于“可以走任何路线”。
- **开场切入：** Coding Agent 不是在你的仓库里无限自由地“自己想办法”，它运行在一个绑定 Run、Node、策略版本和受管工作区的任务合同里。
- **核心认识：** 可靠 Agent = 明确 scope + 可核对 authority + 硬 bounds + 短时 capability + 可恢复 checkpoint，而不是更长的 prompt。
- **与读者的关系：** 你能把“让 Agent 安全一点”改写成可实现的要求：限制资源范围、工具权限、并发、成本、超时和停止原因。

<a id="code-snippets-pre-extracted"></a>
## 代码片段（预先摘录）

文件：`packages/shared/src/agent-runtime.ts`（摘录时第 45–53 行）
```ts
export type AgentRuntimeBounds = {
  maxSteps: number
  maxWallTimeMs: number
  maxToolCalls: number
  maxToolResultBytes: number
  maxTrajectoryMetadataBytes: number
  maxCheckpointBytes: number
  maxTokens: number
  maxCostUsd: number
}
```

文件：`apps/desktop/electron/agent-coordination-plan.ts`（摘录时第 54–68 行）
```ts
const coordinationBounds: CoordinationBounds = {
  maxSpecialists: 3,
  maxTaskNodes: 3,
  maxDependencyEdges: 2,
  maxDelegationDepth: 1,
  maxParallelSpecialists: 2,
  maxAcceptedHandoffs: 4,
  maxSpecialistRetries: 1,
  maxHandoffSummaryBytes: 4_096,
  maxSteps: supervisorBounds.maxSteps,
  maxWallTimeMs: supervisorBounds.maxWallTimeMs,
  maxToolCalls: supervisorBounds.maxToolCalls,
  maxTokens: supervisorBounds.maxTokens,
  maxCostUsd: supervisorBounds.maxCostUsd,
}
```

文件：`apps/desktop/electron/native-tool-registry.ts`（摘录时第 48–61 行）
```ts
export type NativeToolCapabilityGrantRecord = {
  stateVersion: 1
  id: string
  runtimeId: string
  capabilityId: string
  capabilityVersion: number
  requestDigest: string
  permissionClass: NativeToolPermissionClass
  resourceKind: NativeToolResourceScope['kind']
  resourceId: string
  status: 'active' | 'consumed' | 'denied' | 'expired' | 'cancelled'
  grantedAt: string
  expiresAt: string
  settledAt: string | null
}
```

<a id="interactive-elements"></a>
## 交互元素
- [x] **代码与白话对照：** 原样使用 `AgentRuntimeBounds`，解释每个硬上限如何在“探险失控前停止队伍”。
- [x] **测验：** 三个结尾情景：（1）令牌预算还有余额，但工具调用目标属于另一个工作区；（2）专职 Agent 等待权限时超时；（3）AI 因任务较大而提出递归委派。答案必须运用作用域、默认拒绝、有限任务图的原则。
- [ ] **群聊动画**
- [ ] **数据流动画**
- [x] **拖放练习：** 将四个标签“作用域（Scope）”“权限依据（Authority）”“上限（Bounds）”“能力授权（Capability Grant）”分别匹配到路线边界、精确的 Run/Node/版本、资源预算、短时工具权限。使用唯一容器 ID `dnd-module4`，按钮必须以该 ID 调用 `checkDnD('dnd-module4')` 和 `resetDnD('dnd-module4')`。
- [x] **其他：** 可点击架构图：监督 Agent → 两个并行只读专职 Agent → 一个受限实现 Agent → 检查点/评估。为读取、受管工作区编辑、已保存测试、确定性评估提供权限徽标；用概念卡片说明明确的停止原因。

<a id="required-screens"></a>
## 必需页面
1. 将登山探险比喻对应到作用域、权限依据、上限、能力授权和检查点。
2. 原样展示上限类型的代码与白话对照。
3. 将四类护栏与职责匹配的拖放练习。
4. 可点击的受限协调图及真实限制：3 个专职 Agent、2 个并行、委派深度 1、重试 1 次。
5. 能力授权生命周期及明确的停止原因卡片。
6. 模块结尾的三个情景测验。

<a id="reference-files-to-read"></a>
## 必读参考文件
- `references/interactive-elements.md` → 代码与白话对照块（Code ↔ English Translation Blocks）、单选测验、拖放匹配、交互式架构图、权限/配置徽标、模式/功能卡片、术语提示。
- `references/design-system.md` → 配色、字体、间距与布局、模块结构、响应式断点。
- `references/content-philosophy.md` → 全文。
- `references/gotchas.md` → 全文。

<a id="connections"></a>
## 模块衔接
- **上一模块：** 数据的两条旅程——建立了本地权限与私有证据的边界。
- **下一模块：** 为什么 Gate 不肯放行——说明即使 Agent 已完成，没有作用域匹配的证据也不能推进工作流。
- **语气与样式：** 使用中文，像懂技术的朋友一样讲解，采用青绿色强调色。本模块使用 `var(--color-bg)`。Agent 运行时、作用域、权限依据、版本、上限、能力授权、摘要指纹、令牌、检查点、委派深度、监督 Agent、专职 Agent、权限首次出现时提供术语提示。不添加自定义样式或脚本。
