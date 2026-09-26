<a id="module-5-为什么-gate-不肯放行"></a>
# 模块 5：为什么 Gate 不肯放行

<a id="teaching-arc"></a>
## 教学主线
- **比喻：** 机场登机口。手里有一张“看起来像登机牌”的纸还不够；姓名、航班、时间、状态和登机口都必须与当前旅程相符。
- **开场切入：** AI 说“测试通过了”并不会让流程自动前进；系统只信属于当前 Run、当前 Node、最新版本且状态终结的结构化证据。
- **核心认识：** Gate 做的是 fail-closed 状态转换：缺证据、证据过期、证据作用域不匹配或最新版失败，都会明确给出 blocker，而不是猜测后继续。
- **与读者的关系：** 当按钮灰掉或流程卡住时，你能读 blocker 找缺失的不变量，也能要求 AI 修复证据链，而不是绕过检查。

<a id="code-snippets-pre-extracted"></a>
## 代码片段（预先摘录）

文件：`packages/shared/src/workflow-transition.ts`（摘录时第 96–107 行）
```ts
export function evaluateWorkflowCommand(input: EvaluateWorkflowCommandInput): WorkflowCommandDecision {
  const command = input.command
  const blockers = baseBlockers(input.run, command)
  if (blockers.length > 0) {
    return { allowed: false, blockers }
  }

  const node = input.run.nodes.find((candidate) => candidate.id === command.nodeId)!
  const invariantBlocker = evaluateCurrentNodeInvariant(input.run, node)
  if (invariantBlocker) {
    return { allowed: false, blockers: [invariantBlocker] }
  }
```

文件：`packages/shared/src/workflow-transition.ts`（摘录时第 199–213 行）
```ts
    const testEvidence = input.evidence.testEvidence.find(
      (candidate) => candidate.id === command.evidenceId,
    )
    if (!testEvidence) {
      return blocked('test_evidence_missing', `Test evidence not found: ${command.evidenceId}`)
    }
    if (
      testEvidence.runId !== input.run.id ||
      testEvidence.projectId !== input.run.projectId ||
      testEvidence.nodeId !== node.id
    ) {
      return blocked('evidence_scope_mismatch', 'Test evidence does not belong to the current test node')
    }
    if (testEvidence.status === 'running') {
      return blocked('test_result_not_terminal', 'A running test cannot complete a workflow transition')
```

文件：`packages/shared/src/workflow-transition.ts`（摘录时第 644–659 行）
```ts
  if (!latestTest) {
    return [blocker('test_evidence_missing', 'Test evidence for the workflow test node is required')]
  }
  if (latestTest.status !== 'passed') {
    return [blocker('latest_test_not_passed', 'The latest matching test evidence must be passing')]
  }
  const hasMatchingTestReport = input.evidence.artifacts.some(
    (artifact) =>
      artifact.id === `artifact-${latestTest.id}` &&
      artifact.runId === input.run.id &&
      artifact.nodeId === testNode?.id &&
      artifact.kind === 'test_report' &&
      testNode?.artifactIds.includes(artifact.id),
  )
  if (!hasMatchingTestReport) {
    return [blocker('test_report_missing', 'The latest passing test report must be attached')]
```

<a id="interactive-elements"></a>
## 交互元素
- [x] **代码与白话对照：** 原样使用第 96–107 行。解释两层检查：先检查通用阻断项，再检查当前节点不变量；任一阻断项都会使 Gate 不放行。
- [x] **测验：** 三个排障情景：（1）旧测试通过，但最新测试失败；（2）通过的测试证据属于另一个 Run；（3）测试通过，但缺少对应报告产物。每题应选择正确的阻断原因和恢复办法，而不是猜文件名。
- [ ] **群聊动画**
- [ ] **数据流动画**
- [ ] **拖放练习**
- [x] **其他：** 提供可点击架构图或证据检查面板，分别用卡片展示 Run 身份、项目身份、节点身份、终态、最新测试、已关联报告。用链条表现“每个封条都匹配才放行”。不要虚构代码缺陷。

<a id="required-screens"></a>
## 必需页面
1. 登机口比喻，以及声明和证据的区别。
2. 可视化阻断检查流程：基础阻断项 → 节点不变量 → 证据作用域 → 证据状态 → 下一节点不变量。
3. 原样展示命令评估器代码与白话对照。
4. 基于真实测试证据检查条件的可点击证据面板。
5. 用有源码依据的阻断原因卡片，强调“以最新结果为准”和必须关联报告。
6. 模块结尾的三个排障测验。

<a id="reference-files-to-read"></a>
## 必读参考文件
- `references/interactive-elements.md` → 代码与白话对照块（Code ↔ English Translation Blocks）、单选测验、交互式架构图、提示框、模式/功能卡片、术语提示。
- `references/design-system.md` → 配色、字体、间距与布局、模块结构、响应式断点。
- `references/content-philosophy.md` → 全文。
- `references/gotchas.md` → 全文。

<a id="connections"></a>
## 模块衔接
- **上一模块：** 给 Agent 装上护栏——限制 Agent 可以尝试的操作。
- **下一模块：** 一枚可信 Draft PR 的诞生——把编码、差异、测试和审批证据组织为对外发布的结果。
- **语气与样式：** 使用中文，像懂技术的朋友一样讲解，采用青绿色强调色。本模块使用 `var(--color-bg-warm)`。Gate、失败时拒绝放行、状态转换、命令、阻断项、不变量、证据作用域、终态、测试证据、产物、最新测试首次出现时提供术语提示。不添加自定义样式或脚本。
