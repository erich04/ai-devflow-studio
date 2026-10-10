import { describe, expect, it, vi } from 'vitest'
import {
  AgentProviderRequestError,
  buildAgentReviewContext,
  createOpenAiCompatibleAgentProvider,
  describeAgentProviderFailure,
  runKnowledgeReviewAgent,
} from './agent-review'
import { artifacts, runs } from './fixtures'

const review = {
  conclusion: '建议通过', summary: '完整结论', risks: [], missingEvidence: [],
  suggestedTests: [], confidence: 0.7,
}
const valid = JSON.stringify(review)

async function input() {
  const run = runs[0]!
  const node = run.nodes.find((item) => item.id === 'n-design-gate')!
  return {
    context: await buildAgentReviewContext({
      run, node, artifacts, testEvidence: [], knowledgeDocuments: [], knowledgeChunks: [],
    }),
    request: {
      id: 'review-json-output', runId: run.id, nodeId: node.id, projectId: run.projectId,
      requestedBy: 'u-ling', runtime: 'electron' as const,
    },
  }
}

function fixture(content: unknown, finishReason: string | null = 'stop', knownUsage = true) {
  const fetcher = vi.fn(async () => Response.json({
    choices: [{ finish_reason: finishReason, message: { content, reasoning_content: 'private reasoning' } }],
    ...(knownUsage ? { usage: { prompt_tokens: 99, completion_tokens: 123 } } : {}),
  }))
  return {
    fetcher,
    provider: createOpenAiCompatibleAgentProvider({
      model: 'gpt-4.1-mini', apiKey: 'fixture-key', baseUrl: 'http://127.0.0.1:9/v1', fetcher,
    }),
  }
}

describe('review JSON output classification (#201)', () => {
  it.each([
    ['plain JSON', valid],
    ['prose followed by JSON', `Here is the review:\n${valid}`],
    ['Markdown fence', `\`\`\`json\n${valid}\n\`\`\``],
    ['JSON followed by prose', `${valid}\nEnd of review.`],
  ])('keeps accepting an intact report in %s', async (_name, content) => {
    const { provider, fetcher } = fixture(content)
    const result = await runKnowledgeReviewAgent({ ...await input(), provider })
    expect(result.review).toMatchObject(review)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each([
    ['empty', '', 'empty_content'],
    ['whitespace', '  \n ', 'empty_content'],
    ['missing content', null, 'missing_content'],
    ['prose only', 'I cannot produce JSON for this request.', 'invalid_json'],
    ['two objects', `${valid}\n${valid}`, 'invalid_json'],
    ['braces before JSON', `Note {see below}.\n${valid}`, 'invalid_json'],
    ['braces after JSON', `${valid}\nAlso see {appendix}.`, 'invalid_json'],
    ['unescaped quote', valid.replace('完整结论', 'a "quoted" word'), 'invalid_json'],
    ['raw newline in string', valid.replace('完整结论', 'line1\nline2'), 'invalid_json'],
    ['trailing comma', valid.slice(0, -1) + ',}', 'invalid_json'],
    ['unfinished JSON with stop', '{"conclusion":"ok","summary":"s","risks":["a', 'invalid_json'],
    ['array', `[${valid}]`, 'not_json_object'],
    ['null', 'null', 'not_json_object'],
    ['string', '"report"', 'not_json_object'],
    ['number', '42', 'not_json_object'],
    ['missing fields', '{"conclusion":"ok","summary":"s"}', 'invalid_review_schema'],
    ['wrong field type', JSON.stringify({ ...review, risks: 'none' }), 'invalid_review_schema'],
  ])('classifies %s after two bounded retries without losing billed usage', async (_name, content, cause) => {
    const { provider, fetcher } = fixture(content)
    const onAttemptUsage = vi.fn(async () => undefined)
    const failure: unknown = await runKnowledgeReviewAgent({
      ...await input(), provider, onAttemptUsage,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentProviderRequestError)
    expect(failure).toMatchObject({
      code: 'invalid_model_output', sanitizedCause: cause, retryable: true,
      deliveryState: 'response_received', billingState: 'confirmed',
      usage: { inputTokens: 99, outputTokens: 123 },
      responseMetadata: {
        httpStatus: 200, finishReason: 'stop',
        contentLength: typeof content === 'string' ? content.length : 0,
        reasoningLength: 'private reasoning'.length,
        outputLimitMode: 'explicit', durationMs: expect.any(Number),
      },
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(onAttemptUsage).toHaveBeenCalledTimes(3)
    expect(onAttemptUsage.mock.calls[0]).toMatchObject([{ inputTokens: 99, outputTokens: 123 }])
    expect(JSON.stringify(failure)).not.toMatch(/private reasoning|fixture-key|完整结论/)
    // Error.cause is not enumerable; check it separately from persisted metadata.
    let causeInChain: unknown = failure
    while (causeInChain instanceof Error) {
      expect(causeInChain.message).not.toMatch(/private reasoning|fixture-key|完整结论|quoted|line1/)
      causeInChain = causeInChain.cause
    }
  })

  it('keeps usage unknown when malformed output has no provider usage', async () => {
    const { provider } = fixture('', 'stop', false)
    const onAttemptUsage = vi.fn(async () => undefined)
    await expect(runKnowledgeReviewAgent({ ...await input(), provider, onAttemptUsage })).rejects.toMatchObject({
      sanitizedCause: 'empty_content', billingState: 'unknown',
    })
    expect(onAttemptUsage).toHaveBeenCalledTimes(3)
    expect(onAttemptUsage.mock.calls[0]).toMatchObject([{ costUsd: null, usageStatus: 'unknown' }])
  })

  it.each([
    ['length', 'output_length'],
    ['content_filter', 'content_filter'],
    ['insufficient_system_resource', 'insufficient_system_resource'],
    [null, 'incomplete_response'],
  ])('uses finish_reason %s before diagnosing the body', async (finishReason, cause) => {
    const { provider } = fixture('', finishReason)
    await expect(runKnowledgeReviewAgent({ ...await input(), provider })).rejects.toMatchObject({
      sanitizedCause: cause, usage: { inputTokens: 99, outputTokens: 123 },
    })
  })

  it.each([
    ['empty_content', '模型未返回正文，未保存本次报告。'],
    ['not_json_object', '模型返回的正文不是报告对象，未保存本次报告。'],
    ['invalid_json', '模型返回的正文格式有误，无法解析，未保存本次报告。'],
    ['invalid_review_schema', '模型返回的审查报告字段缺失或格式不符合要求，未保存本次报告。'],
  ])('explains %s without assuming truncation', (cause, description) => {
    const failure = new AgentProviderRequestError({
      code: 'invalid_model_output', sanitizedCause: cause, deliveryState: 'response_received',
      billingState: 'confirmed', retryable: true,
    })
    expect(describeAgentProviderFailure(failure)).toBe(description)
  })
})
