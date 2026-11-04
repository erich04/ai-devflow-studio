import { describe, expect, it } from 'vitest'
import { isTrivialReply, RECALL_INTENTS_MAX, splitRecallIntents } from './recall-intents'

describe('recall intents', () => {
  it('splits a request that asks for several things into its clauses', () => {
    expect(splitRecallIntents('撤销窗口现在是多少秒？代码注释用什么语言写？')).toEqual(['撤销窗口现在是多少秒', '代码注释用什么语言写'])
    expect(splitRecallIntents('删除任务时需要注意什么，每页加载多少条任务')).toEqual(['删除任务时需要注意什么', '每页加载多少条任务'])
    expect(splitRecallIntents('把归档的撤销时长设成和删除一样；另外注释按项目约定的语言写。只改这个文件。'))
      .toEqual(['把归档的撤销时长设成和删除一样', '注释按项目约定的语言写'])
    expect(splitRecallIntents('Set the archive undo window to the delete one, and write comments in the agreed language.'))
      .toEqual(['Set the archive undo window to the delete one', 'and write comments in the agreed language'])
  })

  it('leaves a single ask whole and drops fragments too short to search', () => {
    expect(splitRecallIntents('撤销窗口现在是多少秒？')).toEqual([])
    expect(splitRecallIntents('How long is the undo window after deleting a task?')).toEqual([])
    expect(splitRecallIntents('好的，谢谢')).toEqual([])
    expect(splitRecallIntents('')).toEqual([])
  })

  it('does not spend a query on edit scope, but keeps substantive questions about files', () => {
    expect(splitRecallIntents('实现同步重试，次数和上限按我们定好的来，只改这个文件。')).toEqual([])
    expect(splitRecallIntents('实现同步重试，次数和上限按之前定好的来，注释用英文，只改 src/sync.ts。')).toEqual(['实现同步重试，次数和上限按之前定好的来', '注释用英文'])
    expect(splitRecallIntents('Implement sync retries; only edit this file.')).toEqual([])
    expect(splitRecallIntents('只改这个文件会影响回滚吗？配置文件在哪？')).toEqual(['只改这个文件会影响回滚吗', '配置文件在哪'])
  })

  it('recalls at most a few clauses', () => {
    const many = Array.from({ length: 6 }, (_, index) => `第 ${index} 件事要处理`).join('；')
    expect(splitRecallIntents(many)).toHaveLength(RECALL_INTENTS_MAX)
    expect(splitRecallIntents(many)[0]).toBe('第 0 件事要处理')
  })

  it('recognises a short acknowledgement and nothing longer', () => {
    for (const text of ['好的', '好', '嗯嗯', '谢谢！', '收到。', 'OK', 'thanks', 'Thank you!', '没问题']) expect(isTrivialReply(text)).toBe(true)
    for (const text of ['好的，那撤销窗口改成 10 秒', '谢谢，另外每页加载多少条？', 'ok, what is the retry policy?', '不']) expect(isTrivialReply(text)).toBe(false)
  })
})
