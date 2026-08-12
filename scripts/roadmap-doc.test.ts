import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const roadmapPath = join(process.cwd(), 'docs/roadmap.md')
const releaseEvidencePaths = [
  'docs/releases/v1.5.0/walkthrough.json',
  'docs/releases/v1.5.0/required-gates.json',
  'docs/releases/v1.5.0/github-sandbox.json',
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

  it('records the released v1.5 truth instead of the former candidate state', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const currentRelease = markdown.match(
      /## Current Release[\s\S]*?(?=\n## (?:Now \/ Next \/ Later|Completed Milestones))/u,
    )?.[0]

    expect(currentRelease).toBeDefined()
    expect([...markdown.matchAll(/^## Current Release$/gmu)]).toHaveLength(1)
    expect([...markdown.matchAll(/^### Now —/gmu)]).toHaveLength(1)
    expect(currentRelease).toContain('`v1.5.0` is the released baseline')
    expect(currentRelease).toContain('docs/releases/v1.5.0/')
    expect(currentRelease).toContain('f461f9d9de300b8e4a15fe31be8f518bde37b2b8')
    expect(currentRelease).toContain('bd7de6f82c3a60092816bd947f5590e9f148c3ae')
    expect(currentRelease).not.toContain('`v1.4.0` is the released baseline')
    expect(currentRelease).not.toContain('release and 1.x completion gate remain pending')

    for (const relativePath of releaseEvidencePaths) {
      const evidence = JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as {
        candidateSha?: unknown
        status?: unknown
      }

      expect(evidence.candidateSha).toBe('f461f9d9de300b8e4a15fe31be8f518bde37b2b8')
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
    expect(markdown).toContain(
      'V1.5 and the finite 1.x line are released and complete',
    )
    expect(markdown).toContain('### Now — Implement V2.0 Native Agent Runtime')
    expect(markdown).not.toContain('Slice 7, the candidate-bound completion gate, remains in progress')
    expect(markdown).toContain('v1.5-github-delivery-prd.md')
    expect(markdown).toContain('0013-github-app-delivery-authority.md')
    expect(markdown).toContain('Public SaaS, billing, enterprise SSO')
    expect(markdown).not.toContain('### v1.6 Candidate:')
    expect(markdown).not.toContain('### v1.7 Candidate:')
  })

  it('records V1.5 as released and makes V2.0 the single active priority', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const currentRelease = markdown.match(
      /## Current Release[\s\S]*?(?=\n## Now \/ Next \/ Later)/u,
    )?.[0]
    const priorities = markdown.match(
      /## Now \/ Next \/ Later[\s\S]*?(?=\n## Completed Milestones)/u,
    )?.[0]

    expect(currentRelease).toContain('`v1.5.0` is the released baseline')
    expect(currentRelease).toContain('The finite 1.x product line is complete')
    expect(currentRelease).not.toContain('release and 1.x completion gate remain pending')
    expect(priorities).toContain('### Now — Implement V2.0 Native Agent Runtime')
    expect(priorities).toContain('### Next — Add Trusted Local MCP Execution')
    expect(markdown).not.toContain('current V1.4 runtime already implements every layer')
    expect(currentRelease).toContain('real private GitHub sandbox')
    expect(markdown).toContain('### v1.5: GitHub Delivery Integration')
    expect(markdown).not.toContain('Implemented Milestone Awaiting Release')
    expect(markdown).not.toContain('2.x implementation remains blocked')
    expect(markdown).not.toContain('v1.5 planned')
    expect(markdown).not.toContain('Decide GitHub App versus scoped user token before implementation')
  })
})
