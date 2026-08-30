import { describe, expect, it } from 'vitest'
import type { CodingRuntimeReadiness } from '@ai-devflow/shared'
import { buildCodingReadinessDisplay } from './coding-runtime-readiness-view-model'

function readiness(
  checks: CodingRuntimeReadiness['checks'],
): CodingRuntimeReadiness {
  return {
    projectId: 'local-1',
    runId: 'run-1',
    nodeId: 'build-1',
    status: checks.some((check) => check.status === 'blocked') ? 'blocked' : 'ready',
    engine: 'native',
    executor: 'native-model',
    availability: 'available',
    capabilities: ['cancellation', 'structured_diff', 'workspace_edit', 'workspace_read'],
    providerRequirement: 'saved-provider',
    checks,
    evaluatedAt: '2026-08-30T18:00:00.000Z',
  }
}

describe('Coding Runtime readiness presentation', () => {
  it('uses positive product names for successful readiness checks', () => {
    const display = buildCodingReadinessDisplay(readiness([
      { code: 'executor_unconfigured', status: 'ready', message: 'configured' },
      { code: 'provider_unavailable', status: 'ready', message: 'available' },
      { code: 'team_project_unpaired', status: 'ready', message: 'paired' },
      { code: 'test_command_missing', status: 'ready', message: 'saved' },
      { code: 'budget_policy_missing', status: 'ready', message: 'saved' },
      { code: 'budget_blocked', status: 'ready', message: 'allowed' },
    ]))

    expect(display).toMatchObject({ status: 'ready', statusLabel: 'Ready' })
    expect(display.items.map(({ label, statusLabel }) => [label, statusLabel])).toEqual([
      ['Coding Executor', '已配置'],
      ['Provider', '可用'],
      ['Team Project', '已配对'],
      ['测试命令', '已配置'],
      ['预算策略', '已配置'],
      ['预算评估', '允许执行'],
    ])
    expect(display.items.every((item) => item.diagnosticCode === undefined)).toBe(true)
    expect(display.items.map((item) => item.label).join(' ')).not.toMatch(/unconfigured|unavailable|missing/u)
  })

  it('shows remediation and a diagnostic code only for a blocker', () => {
    const display = buildCodingReadinessDisplay(readiness([
      { code: 'executor_unconfigured', status: 'blocked', message: 'No executor selected.' },
      { code: 'provider_unavailable', status: 'ready', message: 'Provider available.' },
    ]))

    expect(display.status).toBe('blocked')
    expect(display.items[0]).toMatchObject({
      label: 'Coding Executor',
      statusLabel: '未配置',
      diagnosticCode: 'executor_unconfigured',
    })
    expect(display.items[0]?.remediation).toContain('OpenCode')
    expect(display.items[1]?.diagnosticCode).toBeUndefined()
  })

  it('derives the overall conclusion from the same item states', () => {
    const forged = readiness([
      { code: 'budget_blocked', status: 'blocked', message: 'Budget denied.' },
    ])
    forged.status = 'ready'

    expect(buildCodingReadinessDisplay(forged).status).toBe('blocked')
  })
})
