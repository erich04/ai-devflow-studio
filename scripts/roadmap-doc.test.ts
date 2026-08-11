import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const roadmapPath = join(process.cwd(), 'docs/roadmap.md')
const releaseEvidencePaths = [
  'docs/releases/v1.4.0/walkthrough.json',
  'docs/releases/v1.4.0/required-gates.json',
  'docs/releases/v1.4.0/real-opencode.json',
]

describe('product roadmap source of truth', () => {
  it('keeps one roadmap with explicit major-version charters', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')

    expect(markdown).toContain('the single source of truth')
    expect(markdown).toContain('## Product North Star')
    expect(markdown).toContain('## Major Version Charters')
    expect(markdown).toContain('small-team self-hosted AI DevFlow workbench')
    expect(markdown).toContain('| 0.x | Engineering foundation')
    expect(markdown).toContain('| 1.x | Governed self-hosted delivery')
    expect(markdown).toContain('| 2.x | DevFlow-native Agent Runtime')
    expect(markdown).toContain('Do not create a parallel roadmap')
  })

  it('records the released v1.4 truth instead of the former candidate state', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const currentRelease = markdown.match(
      /## Current Release[\s\S]*?(?=\n## (?:Now \/ Next \/ Later|Completed Milestones))/u,
    )?.[0]

    expect(currentRelease).toBeDefined()
    expect([...markdown.matchAll(/^## Current Release$/gmu)]).toHaveLength(1)
    expect([...markdown.matchAll(/^### Now —/gmu)]).toHaveLength(1)
    expect(currentRelease).toContain('`v1.4.0` is the released baseline')
    expect(currentRelease).toContain('docs/releases/v1.4.0/')
    expect(currentRelease).toContain('b7986d4faec2f8f1bcc220a0341cb0686286209e')
    expect(currentRelease).toContain('e746843c1943755c50c8fb060bdf533b06442232')
    expect(currentRelease).not.toContain('`v1.3.0` is the released baseline')
    expect(currentRelease).not.toContain('V1.4 candidate preparation')
    expect(currentRelease).not.toContain('No V1.4 signoff, tag, or Release is claimed yet')

    for (const relativePath of releaseEvidencePaths) {
      const evidence = JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as {
        candidateSha?: unknown
        status?: unknown
      }

      expect(evidence.candidateSha).toBe('b7986d4faec2f8f1bcc220a0341cb0686286209e')
      expect(evidence.status).toBe('passed')
    }
  })

  it('separates one-shot model work, the Agent Runtime, and coding executors', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const executionModel = markdown.match(
      /## 2\.x Agent Execution Model[\s\S]*?(?=\n## 2\.x Planned Milestones)/u,
    )?.[0]

    expect(executionModel).toBeDefined()
    expect(executionModel).toContain('Single-Call LLM Operation')
    expect(executionModel).toContain('DevFlow Agent Runtime')
    expect(executionModel).toContain('Coding Executor')
    expect(executionModel).toContain('deterministic Workflow remains the outer authority')
    expect(executionModel).toContain('OpenCode')
    expect(executionModel).toContain('DevFlow-owned Coding Agent')
    expect(executionModel).toContain('additional CLI adapters')
    expect(executionModel).toContain('implementation candidates, not committed integrations')
    expect(executionModel).toContain('does not by itself satisfy the V2.2 Multi-Agent claim')
    expect(executionModel).toContain('explicitly evolves ADR 0009')
  })

  it('defines finite 1.x and 2.x lines with the Agent Runtime direction', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')

    expect(markdown).toContain('## Now / Next / Later')
    expect(markdown).toContain('## 1.x Completion Gate')
    expect(markdown).toContain('## 2.x Planned Milestones')
    expect(markdown).toContain('### v2.0: Native Agent Runtime Foundation')
    expect(markdown).toContain('### v2.1: Evaluated Retrieval And Memory')
    expect(markdown).toContain('### v2.2: Multi-Agent And Execution Tenancy')
    expect(markdown).toContain('## 2.x Completion Gate')
    expect(markdown).toContain('The scoped V1.5 contract and authority decision are now approved')
    expect(markdown).toContain('v1.5-github-delivery-prd.md')
    expect(markdown).toContain('0013-github-app-delivery-authority.md')
    expect(markdown).toContain('Public SaaS, billing, enterprise SSO')
    expect(markdown).not.toContain('### v1.6 Candidate:')
    expect(markdown).not.toContain('### v1.7 Candidate:')
  })
})
