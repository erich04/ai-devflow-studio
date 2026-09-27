<a id="module-3-数据的两条旅程"></a>
# 模块 3：数据的两条旅程

<a id="teaching-arc"></a>
## 教学主线
- **比喻：** 机场海关。行李箱里的原件留在本地，只有经过检查、遮住敏感信息的申报单才能进入团队系统；如果网络断了，申报单先进入可靠的待发队列。
- **开场切入：** 同一个 Run 同时服务两种需求：桌面端要保留足够详细的证据，团队 Web 又只应该看到安全、可协作的摘要。
- **核心认识：** “本地优先”不是“永不联网”，而是先明确哪份数据是本地权威，再通过脱敏和 durable outbox 有控制地同步副本。
- **与读者的关系：** 你能要求 AI 把原始日志留在本机、把摘要同步给团队，并判断“页面没更新”究竟是存储、脱敏、排队还是远端接收的问题。

<a id="code-snippets-pre-extracted"></a>
## 代码片段（预先摘录）

文件：`apps/desktop/electron/local-store-workflow.ts`（摘录时第 58–67 行）
```ts
function writeWorkflowRunEnvelope(db: Database, run: WorkflowRun): void {
  const envelope = workflowRunEnvelope(run)
  db.run(
    `
    insert into workflow_runs (id, json, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [run.id, JSON.stringify(envelope), run.createdAt, run.updatedAt],
  )
```

文件：`packages/shared/src/redaction.ts`（摘录时第 135–140 行）
```ts
  for (const { label, pattern } of secretPatterns) {
    value = value.replace(pattern, () => {
      matches.push(label)
      replacementCount += 1
      return `[REDACTED:${label}]`
    })
```

文件：`packages/shared/src/remote-sync-outbox.ts`（摘录时第 125–132 行）
```ts
  return {
    id: input.id,
    ...metadata,
    idempotencyKey: createRemoteSyncIdempotencyKey(metadata),
    status: 'pending',
    generation: 1,
    attemptCount: 0,
    nextAttemptAt: input.createdAt,
```

<a id="interactive-elements"></a>
## 交互元素
- [x] **代码与白话对照：** 使用脱敏循环，六行代码的可见内容必须与源码完全一致。解释模式匹配 → 计数 → 标准脱敏标记。
- [x] **测验：** 三个应用题：（1）原始测试日志含令牌时，哪些内容可以同步；（2）请求已被接收后网络中断，幂等键为什么重要；（3）本地 Run 已存在但 Web 显示旧数据，应按什么顺序检查。
- [ ] **群聊动画**
- [x] **数据流动画：** 这是课程必需的数据流演示。角色为本地 SQLite → 脱敏 → Outbox → API → 团队 Postgres/Web。步骤依次为：本地保存私有证据、生成脱敏摘要、幂等操作入队、传输、保存团队可见记录、渲染团队视图。ID 必须全局唯一：`flow-module3-local`、`flow-module3-redaction`、`flow-module3-outbox`、`flow-module3-api`、`flow-module3-team`；`data-steps` 使用去掉 `flow-` 后的对应后缀。标签内避免使用英文撇号或单引号。
- [ ] **拖放练习**
- [x] **其他：** 用分层切换对比“本地原件”和“团队摘要”。按钮调用必须准确使用 `showLayer('module3-layer-local', this)` 与 `showLayer('module3-layer-team', this)`，分层 ID 必须对应。用卡片说明可重试、需恢复和终态三类失败。

<a id="required-screens"></a>
## 必需页面
1. 海关比喻，用并排卡片对比本地私有数据与团队脱敏数据。
2. 分层切换：哪些字段和证据留在本地，哪些会跨越边界。
3. 原样展示脱敏代码与白话对照，充分使用术语提示。
4. 从 SQLite 到团队 Web 的分步数据流动画。
5. 用原始幂等代码片段和三类失败处理卡片解释持久化待发队列。
6. 模块结尾的三个情景测验。

<a id="reference-files-to-read"></a>
## 必读参考文件
- `references/interactive-elements.md` → 代码与白话对照块（Code ↔ English Translation Blocks）、单选测验、消息流/数据流动画、分层切换演示、模式/功能卡片、术语提示。
- `references/design-system.md` → 配色、字体、间距与布局、动画与过渡、模块结构、响应式断点。
- `references/content-philosophy.md` → 全文。
- `references/gotchas.md` → 全文。

<a id="connections"></a>
## 模块衔接
- **上一模块：** 桌面端的五位角色——将 SQLite 介绍为本地档案室，Main 是负责管理它的角色。
- **下一模块：** 给 Agent 装上护栏——讨论 Agent 在本地权限边界内可以做什么。
- **语气与样式：** 使用中文，像懂技术的朋友一样讲解，采用青绿色强调色。本模块使用 `var(--color-bg-warm)`。本地优先、权威副本、SQLite、原始证据、脱敏、秘密信息、持久化待发队列、API、Postgres、幂等键、可重试、终态首次出现时提供术语提示。不添加样式或脚本，只用已有 CSS 类。
