// Synthetic history of one small Todo project, used by project-memory-full-validation.mts.
// Several decisions change over time, so the final memory has to keep the latest one:
// undo window 5 -> 10 -> 15 s, page size 20 -> 50, retries 3 -> 5, answer language zh -> en,
// date display fixed -> relative, batch delete "no undo" -> "undo the latest batch".
import type { Artifact, CodingAgentEvent, CodingAgentRun, TestEvidence } from '../packages/shared/src/index.ts'

export const DAY_MS = 86_400_000
export type Message = { id: string; role: 'user' | 'assistant'; text: string; createdAt: string }
export type Conversation = { id: string; title: string; messages: Message[] }
export type CommitSpec = { daysAgo: number; minutes: number; subject: string; body?: string; branch?: string }
export type CodingRunFixture = { run: CodingAgentRun; workflow: { title: string; request: string; nodes: Array<{ id: string; title: string; stage: string }> }
  events: CodingAgentEvent[]; testEvidence: TestEvidence[] }
export type ArtifactFixture = { artifact: Artifact; run: { title: string; nodes: Array<{ id: string; stage: string }> }; approved: boolean }

/** Unique strings that let the validation tell which part of a source reached memory. */
export const MARKERS = {
  oldestLongChat: 'OLDEST-MARKER-7Q', newestLongChat: 'NEWEST-MARKER-3K',
  earlyEvent: 'EARLY-EVENT-MARKER', lateEvent: 'LATE-EVENT-MARKER',
  oldCommit: 'OLD40-MARKER', mergeCommit: 'MERGE-MARKER', todayCommit: 'TODAY-MARKER',
  forgotten: 'Bluefin', forgottenNumber: '37',
} as const

export function timeline(now: Date, projectId: string, ownerUserId: string, cwd: string) {
  const at = (daysAgo: number, minutes = 0) => new Date(now.getTime() - daysAgo * DAY_MS + minutes * 60_000).toISOString()
  const chat = (id: string, title: string, daysAgo: number, turns: Array<[string, string]>): Conversation => ({
    id, title, messages: turns.flatMap(([user, assistant], index) => [
      { id: `${id}-u${index}`, role: 'user' as const, text: user, createdAt: at(daysAgo, index * 4) },
      { id: `${id}-a${index}`, role: 'assistant' as const, text: assistant, createdAt: at(daysAgo, index * 4 + 1) },
    ]),
  })

  const legacy = [
    [30, '测试命令是 pnpm test。'],
    [29, '构建产物输出到 dist/ 目录，dist/ 不提交到仓库。'],
    [28, '任务列表每页显示 20 条。'],
    [27, '用户喜欢在 PR 描述里附上界面截图。'],
    [26, '提交信息使用 Conventional Commits 格式（feat/fix/docs/chore）。'],
    [25, 'Node.js 版本固定为 24，CI 使用 GitHub Actions。'],
    [24, '组件放在 src/components，业务逻辑放在 src/tasks。'],
    [23, '样式使用 CSS Modules，不用 Tailwind。'],
    [22, '所有时间以 UTC 存储，显示时转换为本地时区。'],
    [21, '不要在代码里写死 API 地址，从环境变量 VITE_API_BASE 读取。'],
  ].map(([daysAgo, statement]) => ({ statement: String(statement), createdAt: at(Number(daysAgo)) }))

  const conversations: Array<Conversation & { daysAgo: number }> = [
    { daysAgo: 20, ...chat('chat-delete-confirm', '删除确认', 20, [[
      '删除任务前必须弹出二次确认框，按钮文案用“删除”而不是“确定”。删除后给 5 秒的撤销窗口。以后都用中文回答我。',
      '好的：删除前弹确认框，按钮写“删除”，撤销窗口 5 秒，之后用中文回答。']]) },
    { daysAgo: 16, ...chat('chat-env', '本地环境', 16, [[
      '本地开发要先把 .env.example 复制为 .env.local，再设置 VITE_API_BASE=http://localhost:4310。',
      '明白：复制 .env.example 为 .env.local，并设置 VITE_API_BASE。']]) },
    { daysAgo: 15, ...chat('chat-test-command', '测试命令', 15, [[
      '跑测试改用 pnpm test:regression，不要再用 pnpm test，后者会连带跑很慢的 e2e（大约 12 分钟）。',
      '明白，以后回归测试统一用 pnpm test:regression。']]) },
    { daysAgo: 14, ...chat('chat-e2e-motion', 'e2e 偶发失败', 14, [[
      'e2e 测试在 CI 上偶发失败，原因是动画还没结束就点击了按钮。以后 e2e 里统一开启 prefers-reduced-motion 关闭动画。',
      '好的，e2e 统一开启 reduced motion。']]) },
    { daysAgo: 12, ...chat('chat-undo-10', '撤销时长', 12, [[
      '用户反馈 5 秒的撤销窗口太短，来不及点。撤销窗口改成 10 秒。',
      '已记录：撤销窗口从 5 秒改为 10 秒。']]) },
    { daysAgo: 10, ...chat('chat-shortcuts', '快捷键', 10, [[
      '快捷键约定：按 Delete 键删除选中的任务，Ctrl+Z 撤销；Mac 上用 Cmd+Z。',
      '好的：Delete 删除，Ctrl+Z / Cmd+Z 撤销。']]) },
    { daysAgo: 9, ...chat('chat-date-format', '日期格式', 9, [[
      '任务列表里的日期统一显示成 YYYY-MM-DD。',
      '好的，日期显示格式为 YYYY-MM-DD。']]) },
    { daysAgo: 8, ...chat('chat-page-size', '分页大小', 8, [[
      '有了虚拟滚动之后，每页加载的任务数从 20 改成 50，减少翻页请求。',
      '已记录：分页大小从 20 改为 50。']]) },
    { daysAgo: 6, ...chat('chat-language', '回答语言', 6, [[
      '从现在起请用英文回答我，代码注释也写英文。之前说的用中文回答作废。',
      'Understood. From now on I will answer in English and write code comments in English.']]) },
    { daysAgo: 5, ...chat('chat-answer-order', '回答方式', 5, [[
      '回答时先给结论，再给原因，尽量简短。',
      'OK: conclusion first, then the reasons, kept short.']]) },
    { daysAgo: 4, ...chat('chat-date-relative', '日期显示调整', 4, [[
      '日期显示再调整一下：7 天以内显示相对时间（比如“3 天前”），超过 7 天才显示 YYYY-MM-DD。',
      'Recorded: relative time within 7 days, YYYY-MM-DD beyond that.']]) },
    { daysAgo: 2, ...chat('chat-retry', '同步重试', 2, [[
      '同步接口的重试策略改一下：最多重试 5 次，退避上限 30 秒。之前定的 3 次（1s/2s/4s）在移动网络下不够。',
      'Recorded: up to 5 retries with backoff capped at 30 seconds, replacing the earlier 3 retries.']]) },
    { daysAgo: 2, ...chat('chat-bluefin', '内部信息', 2, [[
      `补充一个内部信息：这个项目的内部代号是 ${MARKERS.forgotten}，对外文档不要提这个代号。另外生产数据库连接池上限设为 ${MARKERS.forgottenNumber}。`,
      `Noted: internal codename ${MARKERS.forgotten} (not for external docs); production database pool limit ${MARKERS.forgottenNumber}.`]]) },
    { daysAgo: 1, ...chat('chat-batch-undo', '批量删除撤销', 1, [[
      '批量删除现在也要支持撤销了，推翻之前“批量删除不支持撤销”的决定。规则：15 秒内只能撤销最近一次批量操作。',
      'Recorded: batch delete now supports undoing the most recent batch within 15 seconds; the earlier non-goal is replaced.']]) },
    { daysAgo: 1, ...chat('chat-small-talk', '闲聊', 1, [['谢谢，今天先到这里，辛苦了。', 'Thanks, see you tomorrow.']]) },
  ]

  // A discussion far larger than one document: the oldest part must be left out.
  const longMessages: Message[] = []
  const rounds = 70
  for (let index = 0; index < rounds; index += 1) {
    const minutes = Math.round(index * (34 * 60) / rounds)
    const user = index === 0
      ? `${MARKERS.oldestLongChat}：最早的方案是把分页大小设为 10，用“加载更多”按钮翻页，先不做虚拟滚动。`
      : index === rounds - 1
        ? `${MARKERS.newestLongChat} 最终结论：虚拟列表 overscan 设为 8 行，滚动容器高度固定 600px，行高固定 44px；分页大小保持 50。`
        : `第 ${index} 轮性能排查：在 ${1000 + index * 50} 条任务的列表上连续滚动 30 秒，平均帧率 ${40 + (index % 17)} fps，最长任务 ${80 + (index % 23) * 7} ms。` +
          `这一轮观察到${['滚动到底部时白屏闪烁', '筛选切换后列表重新渲染', '拖动排序时卡顿', '日期列重复计算相对时间', '图片懒加载触发布局抖动'][index % 5]}，` +
          `尝试了${['React.memo 包裹行组件', '把相对时间计算移到 selector 并缓存', '关闭行内动画', '调整 overscan', '把图片尺寸写死'][index % 5]}，` +
          `效果${['明显', '一般', '不明显'][index % 3]}。另外记录一下环境：Chrome ${120 + (index % 6)}，MacBook Air M2，开发模式下测量，生产构建的数字通常好 20% 左右。` +
          '这些数字只是本轮排查的过程记录，后面还会继续调整，先不要当作结论。'
    longMessages.push({ id: `chat-perf-long-u${index}`, role: 'user', text: user, createdAt: at(6, minutes) })
    longMessages.push({ id: `chat-perf-long-a${index}`, role: 'assistant', createdAt: at(6, minutes + 1), text: index === rounds - 1
      ? 'Recorded the final settings: overscan 8 rows, container height 600px, row height 44px, page size 50.'
      : `已记录第 ${index} 轮数据。下一步建议先用 Performance 面板确认长任务来源，再决定是否继续调整；同时保持测量条件一致，避免不同轮次的数据无法比较。` })
  }
  const longConversation: Conversation = { id: 'chat-perf-long', title: '列表性能排查（长讨论）', messages: longMessages }

  const node = { id: 'build', title: '实现', stage: 'build' }
  const codingRun = (id: string, daysAgo: number, title: string, request: string, status: 'completed' | 'failed', summary: string,
    events: string[], test: { status: 'passed' | 'failed'; summary: string }, changedPaths: string[]): CodingRunFixture => {
    const startedAt = at(daysAgo, 30)
    const completedAt = at(daysAgo, 50)
    const run: CodingAgentRun = { id, runId: `wf-${id}`, projectId, nodeId: 'build', requestedBy: ownerUserId, providerId: 'deepseek', engine: 'native',
      status, branchName: `devflow/${id}`, userInstruction: request, prompt: 'p', summary, changedPaths, startedAt, completedAt, redacted: true }
    return {
      run, workflow: { title, request, nodes: [node] },
      events: events.map((message, index) => ({ id: `${id}-e${index}`, codingRunId: id, runId: run.runId, nodeId: 'build', sequence: index + 1,
        kind: 'tool_call' as const, message, timestamp: at(daysAgo, 31 + Math.min(18, index / 25)), redacted: true })),
      testEvidence: [{ id: `${id}-t`, runId: run.runId, projectId, nodeId: 'build', command: 'pnpm test:regression', cwd, status: test.status,
        exitCode: test.status === 'passed' ? 0 : 1, durationMs: 1_000, stdout: '', stderr: '', summary: test.summary, redacted: true, createdAt: at(daysAgo, 49) }],
    }
  }
  const longActivity = Array.from({ length: 420 }, (_, index) => index === 0
    ? `${MARKERS.earlyEvent}: read src/undo/timer.ts to find where the undo timer is created`
    : index === 419
      ? `${MARKERS.lateEvent}: call clearTimeout(undoTimer) in the cleanup of useUndoToast so leaving the page cancels the pending undo`
      : `edit src/undo/use-undo-toast.ts step ${index}: adjust the effect dependencies and re-run the focused undo toast test (iteration ${index})`)
  const codingRuns: Array<CodingRunFixture & { daysAgo: number }> = [
    { daysAgo: 17, ...codingRun('cr-refresh-fail', 17, '删除任务二次确认', '给删除任务加二次确认和撤销', 'failed', '确认框测试失败：删除后列表没有刷新',
      ['edit src/tasks/delete.ts: show ConfirmDialog before deleting'], { status: 'failed', summary: 'delete.test.ts: expected the list to refresh after confirm' }, ['src/tasks/delete.ts']) },
    { daysAgo: 17, ...codingRun('cr-refresh-fix', 17, '删除任务二次确认', '修复删除后列表不刷新', 'completed', '修复：确认删除后调用 refreshTasks()，测试通过',
      ['edit src/tasks/delete.ts: call refreshTasks() after the confirm resolves'], { status: 'passed', summary: '42 passed' }, ['src/tasks/delete.ts', 'src/tasks/delete.test.ts']) },
    { daysAgo: 10, ...codingRun('cr-virtual-row', 10, '虚拟滚动', '任务列表改用虚拟滚动', 'completed', '虚拟滚动行高不一致导致列表跳动，改为固定行高 44px 后正常',
      ['edit src/components/TaskList.tsx: use FixedSizeList with itemSize 44'], { status: 'passed', summary: '57 passed' }, ['src/components/TaskList.tsx']) },
    { daysAgo: 7, ...codingRun('cr-safari-fail', 7, 'IndexedDB 存储', '任务数据迁移到 IndexedDB', 'failed', 'Safari 隐私模式下打开 IndexedDB 报 InvalidStateError，任务无法保存',
      ['edit src/storage/db.ts: open the idb-keyval store on startup'], { status: 'failed', summary: 'storage.safari.test.ts: InvalidStateError when opening IndexedDB in private mode' }, ['src/storage/db.ts']) },
    { daysAgo: 7, ...codingRun('cr-safari-fix', 7, 'IndexedDB 存储', '修复 Safari 隐私模式无法保存', 'completed',
      'IndexedDB 不可用时回退到内存存储，并显示“当前浏览器无法持久保存”的提示',
      ['edit src/storage/db.ts: fall back to an in-memory store when indexedDB.open throws', 'edit src/components/StorageBanner.tsx: show the warning banner'],
      { status: 'passed', summary: '61 passed' }, ['src/storage/db.ts', 'src/components/StorageBanner.tsx']) },
    { daysAgo: 4, ...codingRun('cr-flaky-claim', 4, '撤销提示', '修复撤销提示测试偶发超时', 'failed', 'Agent 报告：所有测试都已通过',
      ['edit src/undo/undo-toast.test.ts: increase the timeout to 20000ms', 'status: all tests pass'],
      { status: 'failed', summary: 'undo-toast.test.ts: test timed out after 10000ms (real timers)' }, ['src/undo/undo-toast.test.ts']) },
    { daysAgo: 4, ...codingRun('cr-flaky-fix', 4, '撤销提示', '修复撤销提示测试偶发超时', 'completed', '撤销提示测试改用 vi.useFakeTimers() 并推进 15000ms，不再依赖真实计时器',
      ['edit src/undo/undo-toast.test.ts: vi.useFakeTimers() and vi.advanceTimersByTime(15000)'], { status: 'passed', summary: '63 passed' }, ['src/undo/undo-toast.test.ts']) },
    { daysAgo: 1, ...codingRun('cr-long-activity', 1, '撤销计时器清理', '切换页面时清理撤销计时器', 'completed', '切换页面时清理遗留的撤销计时器',
      longActivity, { status: 'passed', summary: '64 passed' }, ['src/undo/use-undo-toast.ts']) },
  ]

  const artifact = (id: string, daysAgo: number, kind: Artifact['kind'], title: string, content: string, approved: boolean): ArtifactFixture & { daysAgo: number } => ({
    daysAgo, approved,
    artifact: { id, runId: `wf-${id}`, nodeId: kind === 'agent_review' ? 'gate' : kind, kind, title, summary: '', content, redacted: true, updatedAt: at(daysAgo, 120) } as Artifact,
    run: { title, nodes: [{ id: kind === 'agent_review' ? 'gate' : kind, stage: kind === 'clarification' ? 'clarify' : kind === 'acceptance' ? 'accept' : 'design' }] },
  })
  const artifacts = [
    artifact('art-clarify-undo', 18, 'clarification', '需求澄清：删除与撤销',
      '## 需求澄清：删除与撤销\n- 单条删除需要二次确认（ConfirmDialog 组件），按钮文案“删除”。\n- 删除后可以撤销，撤销窗口 5 秒（后续可能调整）。\n- 非目标：批量删除暂不支持撤销。', true),
    artifact('art-review-1', 16, 'agent_review', '门禁审查：删除与撤销',
      '## 审查结论：需要补充\n- 风险：缺少撤销超时的边界测试（在窗口结束的那一刻点击撤销）。\n- 风险：没有覆盖批量删除场景。', false),
    artifact('art-design-storage', 14, 'design', '存储方案',
      '## 存储方案\n- 任务数据存 IndexedDB（使用 idb-keyval），不再使用 localStorage。原因：localStorage 只有约 5MB，并且同步读写会阻塞主线程。\n- 迁移：首次启动时把 localStorage 里的旧数据导入 IndexedDB，成功后删除旧键。', true),
    artifact('art-design-retry', 11, 'design', '同步重试',
      '## 同步重试\n- 同步接口失败时重试 3 次，指数退避 1s/2s/4s。\n- 超过次数后在界面提示“同步失败，可手动重试”。', true),
    artifact('art-design-undo15', 3, 'design', '撤销窗口调整',
      '## 撤销窗口调整\n- 撤销窗口从 10 秒改为 15 秒。原因：可用性测试中 10 秒对年长用户仍然偏短。\n- 撤销计时器在页面切换时必须清理。\n- 撤销通过 toast 上的“撤销”按钮实现。', true),
    artifact('art-review-2', 3, 'agent_review', '门禁审查：撤销窗口调整',
      '## 审查结论：有条件通过\n- 发现：撤销计时器在页面切换后没有清理，可能导致内存泄漏和误触发撤销。\n- 建议：在组件卸载时调用 clearTimeout。', false),
    artifact('art-accept', 1, 'acceptance', '验收标准：删除与撤销',
      '## 验收标准\n- 单条删除后 15 秒内可以撤销。\n- 批量删除可以撤销最近一次批量操作（15 秒内）。\n- Safari 隐私模式下显示无法持久保存的提示。\n- 回归测试 pnpm test:regression 全部通过。', true),
  ]

  // Real Git history; daysAgo 40 lies outside the 30-day window, the merge commit is skipped.
  const commits: CommitSpec[] = [
    { daysAgo: 40, minutes: 0, subject: `chore(init): 用 Vite 初始化项目 ${MARKERS.oldCommit}` },
    { daysAgo: 20, minutes: 60, subject: 'feat(tasks): 新增任务删除确认弹窗 ConfirmDialog', body: '按钮文案为“删除”，避免用户误点“确定”。' },
    { daysAgo: 20, minutes: 90, subject: 'feat(undo): 删除后显示 5 秒撤销提示' },
    { daysAgo: 19, minutes: 30, subject: 'test(tasks): 补充删除确认测试' },
    { daysAgo: 19, minutes: 80, subject: 'style(tasks): 调整确认弹窗按钮间距' },
    { daysAgo: 18, minutes: 40, subject: 'refactor(tasks): 拆分 useTasks hook' },
    { daysAgo: 17, minutes: 70, subject: 'fix(tasks): 删除确认后刷新列表', body: '确认删除后调用 refreshTasks()，否则列表保留已删除项。' },
    { daysAgo: 16, minutes: 20, subject: 'docs: 补充 README 的本地开发说明', body: '先复制 .env.example 为 .env.local，再设置 VITE_API_BASE。' },
    { daysAgo: 15, minutes: 50, subject: 'ci: 新增 test:regression 脚本', body: 'pnpm test 包含 e2e，耗时约 12 分钟；回归测试只跑单元和组件测试。' },
    { daysAgo: 14, minutes: 10, subject: 'test(e2e): 统一开启 prefers-reduced-motion', body: '动画未结束就点击导致 CI 偶发失败。' },
    { daysAgo: 13, minutes: 30, subject: 'feat(storage): 任务数据迁移到 IndexedDB', body: 'localStorage 只有约 5MB 且阻塞主线程；改用 idb-keyval。' },
    { daysAgo: 13, minutes: 90, subject: 'feat(storage): 首次启动时导入 localStorage 旧数据' },
    { daysAgo: 12, minutes: 40, subject: 'feat(undo): 撤销窗口改为 10 秒', body: '用户反馈 5 秒太短。' },
    { daysAgo: 12, minutes: 70, subject: 'chore: .gitignore 忽略 dist/' },
    { daysAgo: 11, minutes: 30, subject: 'feat(sync): 同步失败时重试 3 次（1s/2s/4s）' },
    { daysAgo: 10, minutes: 20, subject: 'perf(list): 任务列表改用虚拟滚动', body: '超过 500 条任务时滚动明显卡顿，改为只渲染可见区域（react-window）。' },
    { daysAgo: 10, minutes: 60, subject: 'fix(list): 固定行高 44px，修复虚拟滚动跳动' },
    { daysAgo: 10, minutes: 95, subject: 'feat(shortcuts): Delete 删除，Ctrl/Cmd+Z 撤销' },
    { daysAgo: 9, minutes: 40, subject: 'feat(list): 日期显示为 YYYY-MM-DD' },
    { daysAgo: 8, minutes: 30, subject: 'feat(list): 分页大小改为 50' },
    { daysAgo: 7, minutes: 60, subject: 'fix(storage): Safari 隐私模式回退到内存存储', body: 'IndexedDB 在 Safari 隐私模式下不可用（InvalidStateError）。' },
    { daysAgo: 7, minutes: 90, subject: 'feat(storage): 无法持久保存时显示提示条' },
    { daysAgo: 6, minutes: 20, subject: 'docs: 代码注释统一使用英文' },
    { daysAgo: 6, minutes: 50, subject: 'feat(tags): 新增标签筛选', branch: 'feature/tags' },
    { daysAgo: 6, minutes: 55, subject: 'test(tags): 标签筛选测试', branch: 'feature/tags' },
    { daysAgo: 5, minutes: 30, subject: 'perf(list): overscan 设为 8 行' },
    { daysAgo: 5, minutes: 70, subject: 'refactor(list): 相对时间计算移到 selector 并缓存' },
    { daysAgo: 4, minutes: 20, subject: 'feat(list): 7 天内显示相对时间' },
    { daysAgo: 4, minutes: 60, subject: 'test(undo): 撤销提示测试改用 fake timers', body: '真实计时器导致 10 秒超时的偶发失败。' },
    { daysAgo: 3, minutes: 30, subject: 'feat(undo): 撤销窗口改为 15 秒', body: '可用性测试中 10 秒对年长用户仍然偏短。' },
    { daysAgo: 3, minutes: 80, subject: 'fix(undo): 页面切换时清理撤销计时器', body: 'Gate 审查发现计时器没有清理会误触发撤销。' },
    { daysAgo: 2, minutes: 40, subject: 'feat(sync): 重试改为最多 5 次，退避上限 30 秒', body: '移动网络下 3 次不够。' },
    { daysAgo: 2, minutes: 90, subject: 'chore(deps): 升级 react-window 到 1.8.10' },
    { daysAgo: 1, minutes: 30, subject: 'feat(tasks): 批量删除支持撤销最近一次操作' },
    { daysAgo: 1, minutes: 70, subject: 'test(tasks): 批量撤销测试' },
    { daysAgo: 1, minutes: 100, subject: 'style: 统一按钮圆角' },
  ]
  return { at, legacy, conversations, longConversation, codingRuns, artifacts, commits }
}

/** Commits made today: one settled, one so recent that today's document has to wait. */
export function todayCommits(): Array<{ minutesAgo: number; subject: string }> {
  return [
    { minutesAgo: 40, subject: 'fix(undo): 撤销后恢复任务原来的排序位置' },
    { minutesAgo: 5, subject: `docs: 更新撤销功能说明 ${MARKERS.todayCommit}` },
  ]
}

/**
 * Recall questions with the words a correct answer contains. `latest`: among the selected
 * memories about `topic`, the first one naming any of `values` has to name `value`, the
 * newest decision.
 */
export type LatestValue = { topic: RegExp; values: string[]; value: string }
export const RECALL_QUERIES: Array<{ query: string; expect: Array<string | RegExp>; latest?: LatestValue }> = [
  { query: '删除任务时需要注意什么？', expect: [/确认|ConfirmDialog/u] },
  { query: '撤销窗口现在是多少秒？', expect: [/15/u], latest: { topic: /撤销|undo/iu, values: ['5', '10', '15'], value: '15' } },
  { query: '怎么跑回归测试？', expect: ['test:regression'] },
  { query: '删除后列表不刷新怎么办？', expect: ['refreshTasks'] },
  { query: '用户希望用什么语言回答？', expect: [/英文|English/iu] },
  { query: '构建产物放在哪里，要不要提交？', expect: ['dist'] },
  { query: '任务列表为什么改用虚拟滚动？', expect: ['500'] },
  { query: '每页加载多少条任务？', expect: [/50/u], latest: { topic: /分页|每页|page size|per page/iu, values: ['10', '20', '50'], value: '50' } },
  { query: '任务数据存在哪里，为什么不用 localStorage？', expect: [/IndexedDB|idb-keyval/iu, /5\s*MB/iu] },
  { query: 'Safari 隐私模式下有什么问题？', expect: [/内存|in-memory|memory/iu] },
  { query: '同步失败会重试几次？', expect: [/5/u], latest: { topic: /重试|retr/iu, values: ['3', '5'], value: '5' } },
  { query: '任务的日期怎么显示？', expect: [/相对|relative|天前/iu] },
  { query: '批量删除能撤销吗？', expect: [/最近一次|most recent|latest/iu] },
  { query: '撤销提示的测试为什么会偶发超时？', expect: [/fake ?timers|useFakeTimers|假计时器|真实计时器|real timers/iu] },
  { query: 'e2e 测试偶发失败怎么处理？', expect: [/reduced.?motion|动画/iu] },
  { query: '虚拟滚动的 overscan 设置是多少？', expect: [/8/u] },
  { query: '本地开发环境怎么配置？', expect: [/\.env\.local|VITE_API_BASE/u] },
  { query: '提交信息用什么格式？', expect: [/Conventional|feat/iu] },
  { query: '代码注释用什么语言写？', expect: [/英文|English/iu] },
  { query: '回答的时候应该先说什么？', expect: [/结论|conclusion/iu] },
  { query: '删除和撤销的快捷键是什么？', expect: [/Ctrl\+Z|Cmd\+Z/iu] },
  { query: '离开页面时撤销计时器要怎么处理？', expect: [/清理|clearTimeout|clear/iu] },
  { query: '样式用什么方案？', expect: [/CSS Modules/iu] },
  { query: '任务列表的行高是多少？', expect: [/44/u] },
  { query: '项目的内部代号是什么？', expect: [MARKERS.forgotten] },
]
/**
 * Held-out questions: written after the recall settings had been tuned on the questions above,
 * worded differently, some in English. Reported separately and never a pass condition.
 */
export const RECALL_HOLDOUT_QUERIES: Array<{ query: string; expect: Array<string | RegExp> }> = [
  { query: '误删任务以后还能恢复吗，有多长时间？', expect: [/15/u] },
  { query: 'How long is the undo window after deleting a task?', expect: [/15/u] },
  { query: '提交前要跑哪个测试命令？', expect: ['test:regression'] },
  { query: 'Which test command should I run before merging?', expect: ['test:regression'] },
  { query: '为什么不能用 pnpm test？', expect: [/e2e|12\s*分钟/u] },
  { query: 'IndexedDB 打不开时应用会怎么处理？', expect: [/内存|in-memory|memory/iu] },
  { query: '列表里一次加载几条数据？', expect: [/50/u] },
  { query: 'What is the retry policy for sync?', expect: [/5/u] },
  { query: '同步接口的退避上限是多少？', expect: [/30/u] },
  { query: '日期超过一周怎么显示？', expect: [/YYYY/u] },
  { query: '确认弹窗的按钮文案应该写什么？', expect: [/删除/u] },
  { query: 'dist 目录要提交到 git 吗？', expect: ['dist'] },
  { query: 'API 地址可以写死在代码里吗？', expect: [/VITE_API_BASE/u] },
  { query: '时间在数据库里用什么时区存？', expect: [/UTC/u] },
  { query: '组件和业务逻辑分别放在哪个目录？', expect: [/src\/components|src\/tasks/u] },
  { query: 'Node 用哪个版本？', expect: [/24/u] },
  { query: '虚拟列表的容器高度设多少？', expect: [/600/u] },
  { query: 'Why did we switch the list to virtual scrolling?', expect: ['500'] },
  { query: '用户喜欢回答写多长？', expect: [/简短|short|concise/iu] },
  { query: '撤销按钮放在哪里？', expect: [/toast/iu] },
]

/** Page content a correct knowledge page should contain, per page. */
export const PAGE_EXPECTATIONS: Record<string, RegExp[]> = {
  conventions: [/test:regression/u],
  decisions: [/15\s*秒|15 ?s\b|15 seconds/iu, /IndexedDB/iu],
  pitfalls: [/Safari|IndexedDB/iu, /refreshTasks|fake ?timers|useFakeTimers/iu],
  preferences: [/英文|English/iu],
}
/** Late decisions a complete page set reflects; checked across all pages together. */
export const LATE_DECISIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: '撤销窗口 15 秒', pattern: /15\s*秒|15 seconds/iu },
  { name: '重试最多 5 次', pattern: /5\s*次|5 retries|five retries/iu },
  { name: '分页 50 条', pattern: /50/u },
  { name: '批量删除可撤销最近一次', pattern: /最近一次|most recent/iu },
  { name: '7 天内相对时间', pattern: /相对时间|relative/iu },
]

/** A large CI log excerpt for one discussion turn; distinct per turn, ASCII only. */
export function ciLog(turn: number, lines = 70): string {
  return Array.from({ length: lines }, (_, index) =>
    `[ci#${4200 + turn}] ${String(index).padStart(3, '0')} vitest src/tasks/list-${index % 9}.test.ts > renders page ${index % 7} ... ok (${12 + ((index * 7 + turn) % 40)}ms)`).join('\n')
}
