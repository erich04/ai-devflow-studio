/** UX prose checks; callers exclude raw material and technical disclosures. */
export function scanFirstLayerText(text: string, modelNames: readonly string[] = []): Array<{ rule: string; match: string }> {
  for (const word of [...modelNames, 'DevFlow Native', 'DevFlow', 'OpenCode', 'DeepSeek', 'Owner', 'Lead', 'Member', 'Draft PR', 'PR', 'CI']) if (word) text = text.split(word).join(' ')
  const rules: Array<[string, RegExp]> = [
    ['fraction', /(?<![\w./:-])\d+\s*\/\s*\d+(?![\w./:-])/gu], ['hash', /\b[0-9a-f]{12,}\b/giu],
    ['machine-time', /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/gu],
    ['internal-id', /\b(?:coding-run|coding-permission|coding-event|coding-change-review|change-set|cs-|test-evidence|evidence-|artifact-|workspace-|execution-authorization|runtime-budget-approval|run-)[A-Za-z0-9_-]*/gu],
    ['state', /\b(?:pending|approved|rejected|expired|superseded|queued|preparing|bootstrapping|running|applying|testing|completed|failed|timed_out|interrupted|cancelled|waiting_permission|waiting_input|stale|current|unavailable|unrecorded|passed|initial|repair|revision|change_review|analysis|patch|opaque|metered)\b/giu],
    ['attempt', /第\s*\d+\s*次(?:尝试|通过)/gu], ['english-sentence', /\b[A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){2,}\b/gu],
  ]
  return rules.flatMap(([rule, pattern]) => [...text.matchAll(pattern)].map(m => ({ rule, match: m[0] })))
}
