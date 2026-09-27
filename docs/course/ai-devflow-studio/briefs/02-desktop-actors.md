<a id="module-2-桌面端的五位角色"></a>
# 模块 2：桌面端的五位角色

<a id="teaching-arc"></a>
## 教学主线
- **比喻：** 剧院。Renderer 是观众看见的舞台，Preload 是只传指定口令的舞台监督，Electron Main 是后台总控，共享包是剧本规则，SQLite 是保存演出记录的档案室。
- **开场切入：** 点击“新建 Run”后，React 界面没有资格直接碰文件、数据库或 Node.js；它必须把请求交给后台总控。
- **核心认识：** 安全边界不是靠团队“记得小心”，而是由 Electron 的进程分工和一个很窄的 `contextBridge` 接口写进结构里。
- **与读者的关系：** 当功能坏掉或 AI 把逻辑放错层时，你能判断该查 Renderer、IPC、Main、共享领域规则还是 SQLite，而不是在整个仓库里乱搜。

<a id="code-snippets-pre-extracted"></a>
## 代码片段（预先摘录）

文件：`apps/desktop/electron/preload.ts`（摘录时第 10–18 行）
```ts
const desktopApi: DevFlowDesktopApi = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke(ipcChannels.loadState),
  loadDesktopPairing: () => ipcRenderer.invoke(ipcChannels.loadDesktopPairing),
  pairDesktop: (input) => ipcRenderer.invoke(ipcChannels.pairDesktop, input),
  loadRemoteSnapshot: (input) => ipcRenderer.invoke(ipcChannels.loadRemoteSnapshot, input),
  listWorkRequests: (input) => ipcRenderer.invoke(ipcChannels.listWorkRequests, input),
  materializeWorkRequest: (input) =>
    ipcRenderer.invoke(ipcChannels.materializeWorkRequest, input),
```

文件：`apps/desktop/electron/preload.ts`（摘录时第 112 行）
```ts
contextBridge.exposeInMainWorld('aiDevFlowDesktop', desktopApi)
```

文件：`apps/desktop/electron/main.ts`（摘录时第 2131–2140 行）
```ts
  ipcMain.handle(ipcChannels.createRun, async (_, payload: unknown) => {
    const input = parseCreateRunInput(payload)
    const created = createWorkflowRunFromRequest({
      ...input,
      runId: `run-${randomUUID()}`,
      now: new Date().toISOString(),
    })
    const store = await getStore()
    const result = await store.createWorkflow({
      run: created.run,
```

<a id="interactive-elements"></a>
## 交互元素
- [x] **代码与白话对照：** 使用 `preload.ts` 第 10–18 行。把 `invoke` 解释为调用指定的后台对讲频道，并等待一次回复。
- [x] **测验：** 三个架构与排障题：（1）新增“读取本地 Git 状态”功能应放在哪个边界之后；（2）界面显示创建成功，重启后却不存在，应先检查哪里；（3）为什么暴露整个 `ipcRenderer` 会削弱这个设计。
- [x] **群聊动画：** 这是课程必需的群聊演示。按顺序展示：Renderer 请求 Preload 创建 Run → Preload 仅转发指定频道 → Electron Main 校验载荷 → Shared 工作流返回节点和边 → SQLite 确认持久化 → Main 返回保存后的 Run → Renderer 重新加载并绘制。容器 ID 必须唯一，使用 `chat-module2`；按钮只用 `.chat-next-btn`、`.chat-all-btn`、`.chat-reset-btn`。
- [ ] **数据流动画**
- [ ] **拖放练习**
- [x] **其他：** 展示 `apps/desktop/src`、`apps/desktop/electron`、`packages/shared` 和本地 SQLite 的可视化文件树；提供包含五位角色卡片的可点击架构图。

<a id="required-screens"></a>
## 必需页面
1. 剧院比喻及五位角色卡片。
2. 带注释的文件树，说明各项职责所在位置。
3. 包含七条简短消息、角色特点清晰的群聊动画。
4. 原样展示 Preload 代码及白话对照，将暴露桥接接口的单行代码作为徽标或提示块。
5. 可点击架构图；把 Main 处理器原始代码放在紧凑的源码面板或第二个对照块中。
6. 模块结尾的三个情景测验。

<a id="reference-files-to-read"></a>
## 必读参考文件
- `references/interactive-elements.md` → 代码与白话对照块（Code ↔ English Translation Blocks）、单选测验、群聊动画、交互式架构图、可视化文件树、术语提示。
- `references/design-system.md` → 配色、字体、间距与布局、模块结构、响应式断点。
- `references/content-philosophy.md` → 全文。
- `references/gotchas.md` → 全文。

<a id="connections"></a>
## 模块衔接
- **上一模块：** 一句话如何变成工作流——介绍了创建 Run 操作和工作流图。
- **下一模块：** 数据的两条旅程——追踪保存后的 Run 如何进入本地私有存储，以及如何脱敏后同步给团队。
- **语气与样式：** 使用中文，像懂技术的朋友一样讲解，采用青绿色强调色。群聊和架构图共用稳定的角色配色：Renderer 为 `actor-1`，Preload 为 `actor-4`，Main 为 `actor-2`，Shared 为 `actor-3`，SQLite 为 `actor-5`。本模块使用 `var(--color-bg)`。React、Renderer、Preload、Electron Main、Node.js、IPC、contextBridge、共享包、SQLite、进程边界、载荷首次出现时提供术语提示。不添加样式或脚本。
