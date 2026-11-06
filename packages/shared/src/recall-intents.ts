/**
 * Memory recall for a request that asks for several things (ADR 0030 召回). One query ranks memory
 * by the request's overall meaning, so the memory a secondary ask needs ("comments in the agreed
 * language") falls out of a small budget. The request is split into its clauses; each clause gets
 * its own recall next to the whole request, and the results are merged in turn.
 */
const CLAUSE_SEPARATORS = /[。？！?!；;\n，,]+|(?:另外|此外|同时|并且|还有|以及|顺便)[，,]?/u
/** Clauses recalled beside the whole request, at most. */
export const RECALL_INTENTS_MAX = 3
const MIN_INTENT_CHARACTERS = 4

// Standalone edit-scope instructions constrain the executor. They contain no project-memory
// topic of their own. Keep the original whole request intact, including its scope.
const EDIT_SCOPE_PREFIX = /^(?:(?:请|本次|这次)?(?:只|仅)(?:改动?|更改|修改|编辑)\s*|(?:please\s+)?(?:only\s+(?:edit|modify|change)|(?:edit|modify|change)\s+only)\s+)/iu
const FILE_REFERENCE = /^(?:(?:这(?:些|个|份|一[个份]?)?|当前|该|上述|以上)文件|(?:this|that|these|the current|the specified)\s+files?|[`'"]?[\w./-]+\.[\w-]+[`'"]?)(?:即可|就行|就好)?$/iu
function isFileScopeOnly(part: string) {
  const target = part.replace(EDIT_SCOPE_PREFIX, '')
  return target !== part && FILE_REFERENCE.test(target)
}
// A bare parameter reference ("次数和上限按之前定的来") needs the previous topic.
// Leave named subjects ("注释语言…") and actual questions as independent asks.
const DEPENDENT_PARAMETER = /^(?:(?:次数|上限|下限|数量|间隔|时长|数值|阈值)(?:(?:和|与|及|、)(?:次数|上限|下限|数量|间隔|时长|数值|阈值))*)?(?:按|沿用)(?:我们)?(?:上次|原先|之前|此前)?(?:[商约]?定好?的|说好的)(?:来|做|执行)?$/u

// In "A uses the same duration as B", the value is filed under B. Keep the whole
// request as usual, but use the named reference and property for its clause lookup.
function comparisonSubject(part: string): string {
  const match = /(?:和|与|跟)([^，。；：:（）()]{2,60}?)(?:相同|一样|一致)的(时长|上限|下限|次数|间隔|容量|格式|单位|语言)(?=$|[（(\s])/u.exec(part)
  return match ? `${match[1]!.trim()}${match[2]}` : part
}

/** The clauses of `text`, or none when it is a single ask. Only the user's own words should be split. */
export function splitRecallIntents(text: string): string[] {
  const parts = text.split(CLAUSE_SEPARATORS)
    // A full stop splits only Chinese sentences: in English it is also part of paths and numbers.
    .map((part) => part.replace(/^[\s:：、]+|[\s:：、.]+$/gu, '').trim())
    .filter((part) => [...part].length >= MIN_INTENT_CHARACTERS && !isFileScopeOnly(part))
  const asks: string[] = []
  for (const part of parts) {
    if (asks.length && DEPENDENT_PARAMETER.test(part)) asks[asks.length - 1] += `，${part}`
    else asks.push(part)
  }
  const queries = asks.slice(0, RECALL_INTENTS_MAX).map(comparisonSubject)
  return asks.length > 1 || queries[0] !== asks[0] ? queries : []
}

const TRIVIAL_REPLY = /^(?:好的?|好吧|嗯+|对的?|是的?|行|可以|收到|明白了?|知道了|没问题|谢谢(?:你|了)?|多谢|感谢|不用了?|ok(?:ay)?|thanks?(?: you)?|thx|got it|sure|yes|no)[\s!！。.~～,，]*$/iu
/**
 * A short acknowledgement ("好的", "谢谢", "ok"): project memory recalled for it is noise, so the
 * discussion bar skips background recall. Communication preferences still apply to the reply.
 */
export function isTrivialReply(text: string): boolean {
  return TRIVIAL_REPLY.test(text.trim())
}
