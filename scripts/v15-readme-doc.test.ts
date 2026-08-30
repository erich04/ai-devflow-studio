import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hasV20CompletionEvidence = existsSync('docs/releases/v2.0.0/required-gates.json') &&
  existsSync('docs/releases/v2.0.0/agent-runtime-evaluation.json')
const hasV21CompletionEvidence = existsSync('docs/releases/v2.1.0/required-gates.json') &&
  existsSync('docs/releases/v2.1.0/retrieval-memory-evaluation.json')
const hasV22CompletionEvidence = existsSync('docs/releases/v2.2.0/required-gates.json') &&
  existsSync('docs/releases/v2.2.0/multi-agent-evaluation.json')

describe('release README truth', () => {
  it('records the published V1.5 baseline and formal V2.2 closeout', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('`v1.5.0` remains the published baseline')
    if (hasV22CompletionEvidence) {
      expect(readme).toContain('The V2.0,')
      expect(readme).toContain('V2.1, and V2.2 feature milestones are complete')
      expect(readme).toContain('preparing the formal')
      expect(readme).toContain('`v2.2.0` release')
      expect(readme).toContain('after a new exact candidate passes the formal signoff')
    } else if (hasV21CompletionEvidence) {
      expect(readme).toContain(
        'V2.0 Native Agent Runtime and V2.1 Evaluated Retrieval and Memory are complete',
      )
      expect(readme).toContain('V2.2')
      expect(readme).toContain('Multi-Agent and Execution Tenancy is now the active priority')
    } else if (hasV20CompletionEvidence) {
      expect(readme).toContain('V2.0 Native Agent Runtime is complete')
      expect(readme).toContain('V2.1 Evaluated Retrieval and Memory is now the active priority')
    } else {
      expect(readme).toContain('V2.0 Native Agent Runtime implementation is now the active priority')
      expect(readme).toContain('Slice 7 is complete')
      expect(readme).toContain('Slice 8 evaluation and completion gate is in progress')
    }
    expect(readme).toContain('Delivery Intent')
    expect(readme).toContain('signed Web approval')
    expect(readme).toContain('GitHub App')
    expect(readme).toContain('Draft pull request')
    expect(readme).toContain('never merges')
    expect(readme).not.toContain('planned GitHub delivery integration')
    expect(readme).not.toContain(
      'The PR stage creates a reviewable handoff artifact. It does not silently push, open, merge, or publish a real GitHub pull request.',
    )
  })

  it('indexes the two V1.5 deterministic/package gates and current operator walkthrough', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('corepack pnpm test:v15-github-delivery')
    expect(readme).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
    expect(readme).toContain('docs/guides/devflow-studio-v1.5-walkthrough.md')
    expect(readme).toContain('Team schema v21')
    expect(readme).toContain('Desktop schema v33')
    expect(readme).toContain('trusted local stdio MCP')
    expect(readme).toContain('Memory Candidate is promoted, revised, tombstoned, purged, and reopened')
    expect(readme).toContain('memoryRestartDuplicateEffects: 0')
    expect(readme).toContain('provider-authoritative expiry')
    expect(readme).toContain('verified publication adoption')
  })
})
