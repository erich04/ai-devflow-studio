import type { AgentReviewContext, AgentReviewEvidenceCitation, AgentReviewMissingEvidenceDetail } from './domain'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function citesNonGoal(content: string, start: number): boolean {
  // Recognize the owned stage document's section, not arbitrary keyword matches
  // inside a requirement. This flags review; it never dismisses a finding.
  const headings = [...content.slice(0, start).matchAll(/^#{1,6}\s+(.+)$/gmu)]
  const heading = headings.at(-1)?.[1]?.trim()
  return heading !== undefined && /^(?:non[- ]?goals?|非目标)(?:\s*[:：])?$/iu.test(heading)
}

export function locateReviewMissingEvidence(context: AgentReviewContext, missing: readonly string[], raw: unknown): AgentReviewMissingEvidenceDetail[] {
  const details = Array.isArray(raw) ? raw.slice(0, 100) : []
  return missing.map((_summary, index) => {
    const matches = details.map(object).filter((detail) => detail?.index === index)
    const detail = matches.length === 1 ? matches[0] : undefined
    const sources = [
      { id: 'run-request', title: '原始需求', content: context.run.request, contentDigest: context.manifest.runRequest.contentDigest },
      ...context.subjectArtifacts,
    ]
    const citations: AgentReviewEvidenceCitation[] = []
    let invalidCitation = false
    let nonGoal = false
    const rawCitations = Array.isArray(detail?.citations) ? detail.citations : []
    if (rawCitations.length > 3) invalidCitation = true
    for (const item of rawCitations.slice(0, 3)) {
      const candidate = object(item)
      const source = sources.find((entry) => entry.id === candidate?.sourceId)
      const quote = candidate?.quote
      if (!source || typeof quote !== 'string' || quote.trim().length < 4 || quote.length > 600) {
        invalidCitation = true
        continue
      }
      const start = source.content.indexOf(quote)
      if (start < 0) { invalidCitation = true; continue }
      if (source.content.indexOf(quote, start + 1) >= 0) { invalidCitation = true; continue }
      nonGoal ||= citesNonGoal(source.content, start)
      citations.push({ sourceId: source.id, title: source.title, quote, start, end: start + quote.length,
        contentDigest: source.contentDigest,
        ...('updatedAt' in source ? { updatedAt: source.updatedAt } : {}),
      })
    }
    const reported = detail?.assessment
    const assessment: AgentReviewMissingEvidenceDetail['assessment'] = invalidCitation || !citations.length ? 'unverified'
      : reported === 'conflicting_decision' ? 'conflicting_decision'
        : nonGoal ? 'explicit_non_goal'
          : reported === 'gap' ? 'gap' : 'unverified'
    return { index, assessment, citations, requiresReview: assessment !== 'gap' }
  })
}
