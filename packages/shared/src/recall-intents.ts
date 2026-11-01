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

/** The clauses of `text`, or none when it is a single ask. Only the user's own words should be split. */
export function splitRecallIntents(text: string): string[] {
  const parts = text.split(CLAUSE_SEPARATORS)
    // A full stop splits only Chinese sentences: in English it is also part of paths and numbers.
    .map((part) => part.replace(/^[\s:：、]+|[\s:：、.]+$/gu, '').trim())
    .filter((part) => [...part].length >= MIN_INTENT_CHARACTERS)
  return parts.length > 1 ? parts.slice(0, RECALL_INTENTS_MAX) : []
}

const TRIVIAL_REPLY = /^(?:好的?|好吧|嗯+|对的?|是的?|行|可以|收到|明白了?|知道了|没问题|谢谢(?:你|了)?|多谢|感谢|不用了?|ok(?:ay)?|thanks?(?: you)?|thx|got it|sure|yes|no)[\s!！。.~～,，]*$/iu
/**
 * A short acknowledgement ("好的", "谢谢", "ok"): project memory recalled for it is noise, so the
 * discussion bar skips background recall. Communication preferences still apply to the reply.
 */
export function isTrivialReply(text: string): boolean {
  return TRIVIAL_REPLY.test(text.trim())
}
