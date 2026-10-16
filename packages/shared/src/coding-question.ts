/** Business input is independent of command approval and final change acceptance. */
export type CodingQuestionInfo = {
  header: string
  question: string
  options: Array<{ label: string; description: string }>
  multiple?: boolean
  custom?: boolean
}

export type CodingQuestionReply = { kind: 'answer'; answers: string[][] } | { kind: 'dismiss' }
export type CodingQuestionRequest = {
  version: 1
  id: string
  revision: string
  codingRunId: string
  projectId: string
  managedWorkspaceId: string
  sessionId: string
  questions: CodingQuestionInfo[]
  status: 'pending' | 'sending' | 'answered' | 'dismissed' | 'expired' | 'invalidated' | 'delivery_unknown'
  requestedAt: string
  expiresAt: string
  stopRequestedAt?: string
  authorityKey?: string
  replyDigest?: string
  answeredBy?: string
  settledAt?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, limit: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > limit || value.includes('\0')) throw new Error('Invalid question text')
  return value
}

export function parseCodingQuestions(value: unknown): CodingQuestionInfo[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('Invalid question count')
  return value.map((item: unknown) => {
    if (!record(item) || !Array.isArray(item.options) || item.options.length > 16 ||
      (item.multiple !== undefined && typeof item.multiple !== 'boolean') ||
      (item.custom !== undefined && typeof item.custom !== 'boolean')) throw new Error('Invalid question schema')
    const options = item.options.map((option: unknown) => {
      if (!record(option)) throw new Error('Invalid question option')
      return { label: text(option.label, 200), description: text(option.description, 2000, true) }
    })
    if (new Set(options.map((option) => option.label)).size !== options.length || (!options.length && item.custom === false)) throw new Error('Ambiguous question options')
    return { header: text(item.header, 200), question: text(item.question, 4000), options,
      ...(typeof item.multiple === 'boolean' ? { multiple: item.multiple } : {}),
      ...(typeof item.custom === 'boolean' ? { custom: item.custom } : {}) }
  })
}

export function validateCodingQuestionReply(questions: CodingQuestionInfo[], value: unknown): CodingQuestionReply {
  if (!record(value)) throw new Error('Invalid question reply')
  if (value.kind === 'dismiss' && Object.keys(value).every((key) => key === 'kind')) return { kind: 'dismiss' }
  if (value.kind !== 'answer' || !Array.isArray(value.answers) || value.answers.length !== questions.length ||
    Object.keys(value).some((key) => key !== 'kind' && key !== 'answers')) throw new Error('Answer every question in order')
  const answers = value.answers.map((answer: unknown, index) => {
    const question = questions[index]!
    if (!Array.isArray(answer) || !answer.length || answer.length > (question.multiple ? 17 : 1)) throw new Error('Invalid answer count')
    const labels = answer.map((label: unknown) => text(label, 4000))
    if (new Set(labels).size !== labels.length || (question.custom === false && labels.some((label) => !question.options.some((option) => option.label === label)))) throw new Error('Invalid answer option')
    return labels
  })
  if (JSON.stringify(answers).length > 32_000) throw new Error('Answers are too large')
  return { kind: 'answer', answers }
}

export type CodingQuestionReceipt = Pick<CodingQuestionRequest, 'id' | 'revision' | 'status' | 'replyDigest' | 'answeredBy' | 'settledAt'>
