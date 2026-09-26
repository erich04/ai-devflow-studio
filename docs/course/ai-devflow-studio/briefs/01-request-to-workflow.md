<a id="module-1-一句话如何变成工作流"></a>
# 模块 1：一句话如何变成工作流

<a id="teaching-arc"></a>
## 教学主线
- **比喻：** 地铁线路图。用户只说目的地，系统却要把旅程拆成站点、换乘闸门和一张不能跳站的线路图。
- **开场切入：** 你在左侧新建一个 Run，看到的不是一个聊天框，而是一条从“澄清”一直通往“验收”的可追踪路线。
- **核心认识：** AI DevFlow Studio 的核心不是“让 AI 写代码”，而是把一句模糊需求编排成有顺序、有证据、有人工闸门的交付流程。
- **与读者的关系：** 以后让 AI 改流程时，你能明确说“新增一个 stage / node / gate”，而不是笼统地要求“加一步”。

<a id="code-snippets-pre-extracted"></a>
## 代码片段（预先摘录）

文件：`packages/shared/src/workflow.ts`（摘录时第 93–102 行）
```ts
  const nodeIds = {
    clarify: `${input.runId}-clarify`,
    clarifyGate: `${input.runId}-clarify-gate`,
    design: `${input.runId}-design`,
    designGate: `${input.runId}-design-gate`,
    build: `${input.runId}-build`,
    test: `${input.runId}-test`,
    pr: `${input.runId}-pr`,
    accept: `${input.runId}-accept`,
  }
```

文件：`packages/shared/src/workflow.ts`（摘录时第 199–206 行）
```ts
  const edges: WorkflowEdge[] = [
    { id: `${input.runId}-edge-clarify-gate`, source: nodeIds.clarify, target: nodeIds.clarifyGate, kind: 'gate' },
    { id: `${input.runId}-edge-design`, source: nodeIds.clarifyGate, target: nodeIds.design, kind: 'normal' },
    { id: `${input.runId}-edge-design-gate`, source: nodeIds.design, target: nodeIds.designGate, kind: 'gate' },
    { id: `${input.runId}-edge-build`, source: nodeIds.designGate, target: nodeIds.build, kind: 'normal' },
    { id: `${input.runId}-edge-test`, source: nodeIds.build, target: nodeIds.test, kind: 'normal' },
    { id: `${input.runId}-edge-pr`, source: nodeIds.test, target: nodeIds.pr, kind: 'normal' },
    { id: `${input.runId}-edge-accept`, source: nodeIds.pr, target: nodeIds.accept, kind: 'gate' },
```

文件：`apps/desktop/src/app/useDesktopActions.ts`（摘录时第 833–844 行）
```ts
    if (desktopApi) {
      try {
        const persistedRun = await desktopApi.createRun(createInput)
        const nextState = await desktopApi.loadState()
        applyLocalExecutionState(nextState)
        setRuns((previousRuns) =>
          previousRuns.some((run) => run.id === persistedRun.id)
            ? previousRuns.map((run) => (run.id === persistedRun.id ? persistedRun : run))
            : [persistedRun, ...previousRuns],
        )
        setSelectedRunId(persistedRun.id)
        setSelectedNodeId(persistedRun.currentNodeId)
```

<a id="interactive-elements"></a>
## 交互元素
- [x] **代码与白话对照：** 使用 `nodeIds` 片段，保留所有可见源码字符；可以进行 HTML 转义。解释每个属性如何为当前 Run 创建一个有名称的站点。
- [x] **测验：** 结尾设置三个应用题：（1）在哪里插入安全审查节点，才能让开发实现无法跳过它；（2）Gate 与另一个 AI Agent 有何区别；（3）创建 Run 后界面仍是旧状态，可能说明持久化状态的重新加载出了什么问题。
- [ ] **群聊动画**
- [ ] **数据流动画**
- [ ] **拖放练习**
- [x] **其他：** 首屏使用 `assets/devflow-workbench.png` 真实截图；横向路线为澄清 → Gate → 设计 → Gate → 开发 → 测试 → Draft PR → 验收；用概念卡片区分 Agent、任务、门禁和证据。

<a id="required-screens"></a>
## 必需页面
1. 产品首屏：介绍应用的用途、值得学习之处，并展示真实工作台截图。
2. 用八个真实节点 ID 解释地铁线路图比喻，包括六个产品阶段和两个明确的 Gate。
3. 原样展示 `nodeIds` 代码，并提供白话对照。
4. 根据持久化 Run 的片段追踪“创建 Run”操作，用三个编号卡片说明：保存、重新加载权威状态、选中当前节点。
5. 模块结尾的三个情景测验。

<a id="reference-files-to-read"></a>
## 必读参考文件
- `references/interactive-elements.md` → 代码与白话对照块（Code ↔ English Translation Blocks）、单选测验、模式/功能卡片、流程图、术语提示。
- `references/design-system.md` → 配色、字体、间距与布局、模块结构、响应式断点。
- `references/content-philosophy.md` → 全文。
- `references/gotchas.md` → 全文。

<a id="connections"></a>
## 模块衔接
- **上一模块：** 无。从熟悉的可视化工作台和一个具体操作开始。
- **下一模块：** 桌面端的五位角色——解释谁接收 `desktopApi.createRun`，以及权限边界位于何处。
- **语气与样式：** 使用中文，像懂技术的朋友一样讲解，不预设计算机基础。采用青绿色强调色；本模块使用 `var(--color-bg-warm)`。Run、工作流、节点、边、Gate、产物、桌面 API、持久化状态首次出现时必须提供术语提示。只用课程已有 CSS 类，不添加内联 `<style>` 或 `<script>`。
