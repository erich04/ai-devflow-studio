import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('V2.0 Native Agent Runtime contract', () => {
  it('records the bounded runtime and observable trajectory decision', () => {
    const adr = read('docs/adr/0014-bounded-agent-runtime.md')

    expect(adr).toContain('Status: Accepted')
    expect(adr).toContain('ADR 0008')
    expect(adr).toContain('Deterministic Workflow remains the outer authority')
    expect(adr).toContain('Agent Runtime is not a Workflow')
    expect(adr).toContain('success')
    expect(adr).toContain('step_limit')
    expect(adr).toContain('budget_exhausted')
    expect(adr).toContain('checkpoint')
    expect(adr).toContain('optimistic concurrency')
    expect(adr).toContain('does not persist hidden reasoning')
    expect(adr).toContain('deterministic, no-cost fake runtime')
  })

  it('evolves the managed coding adapter into one governed executor contract', () => {
    const adr = read('docs/adr/0015-governed-coding-executor.md')

    expect(adr).toContain('Status: Accepted')
    expect(adr).toContain('ADR 0009')
    expect(adr).toContain('Coding Executor')
    expect(adr).toContain('capability negotiation')
    expect(adr).toContain('OpenCode')
    expect(adr).toContain('DevFlow-owned Coding Agent')
    expect(adr).toContain('same terminal result contract')
    expect(adr).toContain('never publish, merge, approve a Gate, or widen scope')
    expect(adr).toContain('does not claim OpenCode\'s private internal trajectory')
  })

  it('keeps Tool and MCP execution behind main-owned authority', () => {
    const adr = read('docs/adr/0016-tool-mcp-execution-authority.md')

    expect(adr).toContain('Status: Accepted')
    expect(adr).toContain('McpServerDefinition')
    expect(adr).toContain('LocalMcpInstallation')
    expect(adr).toContain('must never be used as process-spawn authority')
    expect(adr).toContain('Electron main')
    expect(adr).toContain('ToolCapabilityGrant')
    expect(adr).toContain('strict input and output schema validation')
    expect(adr).toContain('deadline')
    expect(adr).toContain('cancellation')
    expect(adr).toContain('organization, project, user, session, and Local Project')
    expect(adr).toContain('stdio')
    expect(adr).toContain('remote MCP transports are deferred')
  })

  it('defines a scoped V2.0 product contract and measurable exit gate', () => {
    const prd = read('docs/product/prd/v2.0-native-agent-runtime-prd.md')

    expect(prd).toContain('Status: Approved for implementation')
    expect(prd).toContain('bounded first-party Agent loop')
    expect(prd).toContain('one deliberately narrow DevFlow-owned Coding Agent')
    expect(prd).toContain('trusted local MCP installation')
    expect(prd).toContain('checkpoint and resume')
    expect(prd).toContain('versioned scenario dataset')
    expect(prd).toContain('quality, cost, latency, human intervention, recovery, and isolation')
    expect(prd).toContain('Default verification is deterministic and no-cost')
    expect(prd).toContain('Workflow and human Gate authority remain outside the Agent loop')
    expect(prd).toContain('Public SaaS')
    expect(prd).toContain('V2.1')
    expect(prd).toContain('V2.2')
  })

  it('promotes the exact V2.0 contract set through the single Roadmap', () => {
    const roadmap = read('docs/roadmap.md')

    for (const path of [
      'docs/product/prd/v2.0-native-agent-runtime-prd.md',
      'docs/adr/0014-bounded-agent-runtime.md',
      'docs/adr/0015-governed-coding-executor.md',
      'docs/adr/0016-tool-mcp-execution-authority.md',
      'docs/plans/v2.0-native-agent-runtime.md',
    ]) {
      expect(roadmap).toContain(path)
    }

    expect(roadmap).toContain('### Now — Implement V2.0 Native Agent Runtime')
    expect(roadmap).toContain('Slices 1–3 are complete')
    expect(roadmap).toContain('### Next — Add Trusted Local MCP Execution')
  })

  it('provides an executable TDD slice plan before product code starts', () => {
    const plan = read('docs/plans/v2.0-native-agent-runtime.md')

    for (const slice of [
      'Slice 0 — Contract Freeze',
      'Slice 1 — Runtime Domain And Deterministic Kernel',
      'Slice 2 — Durable Desktop Runtime',
      'Slice 3 — Native Tool Registry',
      'Slice 4 — Trusted Local MCP',
      'Slice 5 — Governed Coding Executor',
      'Slice 6 — Narrow Native Coding Agent',
      'Slice 7 — Runtime UX And Team Projection',
      'Slice 8 — V2.0 Evaluation And Completion Gate',
    ]) {
      expect(plan).toContain(slice)
    }

    expect(plan).toContain('RED')
    expect(plan).toContain('GREEN')
    expect(plan).toContain('Desktop schema 18')
    expect(plan).toContain('Team schema 16')
    expect(plan).toContain('no raw prompt, source, patch, stdout, stderr, credential, or absolute path')
    expect(plan).toContain('OpenCode and native executor parity')
    expect(plan).toContain('V2.0 completion evidence')
    expect(plan).toContain('| Slice 2 | Complete |')
    expect(plan).toContain('| Slice 3 | Complete |')
    expect(plan).toContain('Desktop schema 19')
  })

  it('adds stable V2.0 domain language without redefining workflow authority', () => {
    const context = read('CONTEXT.md')

    for (const term of [
      '## Agent Runtime',
      '## Agent Trajectory',
      '## Agent Checkpoint',
      '## Agent Stop Reason',
      '## Tool Definition',
      '## Tool Capability Grant',
      '## Local MCP Installation',
      '## Coding Executor',
      '## Coding Executor Capability',
      '## Agent Evaluation Scenario',
    ]) {
      expect(context).toContain(term)
    }

    expect(context).toContain('The deterministic Workflow remains authoritative')
    expect(context).toContain('Team MCP metadata is not local execution authority')
  })
})
