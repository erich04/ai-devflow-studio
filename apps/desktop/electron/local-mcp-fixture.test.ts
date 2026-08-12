import { describe, expect, it } from 'vitest'
import { evaluateLocalMcpFixtureTool } from './local-mcp-fixture.js'

describe('packaged Local MCP fixture Tool', () => {
  it('evaluates one exact bounded scenario through the shared deterministic evaluator', () => {
    const scenario = {
      stateVersion: 1,
      id: 'local-mcp-fixture-scenario',
      version: 1,
      name: 'Local MCP fixture scenario',
      objective: 'Evaluate one bounded Local MCP observation.',
      executorKind: 'native',
      expected: {
        stopReason: 'success',
        maxSteps: 1,
        requiredEventTypes: ['runtime_started', 'runtime_stopped'],
        evidenceKinds: ['native_tool_audit'],
        cleanupStatus: 'completed',
      },
      metricDimensions: [
        'quality',
        'cost',
        'latency',
        'human_intervention',
        'recovery',
        'isolation',
      ],
    }
    const observed = {
      stopReason: 'success',
      steps: 1,
      eventTypes: ['runtime_started', 'runtime_stopped'],
      evidenceKinds: ['native_tool_audit'],
      cleanupStatus: 'completed',
      metrics: {
        qualityPassed: true,
        costUsd: 0,
        latencyMs: 0,
        humanInterventions: 0,
        recoverySucceeded: true,
        isolationViolations: 0,
      },
    }

    expect(evaluateLocalMcpFixtureTool({
      scenarioJson: JSON.stringify(scenario),
      observationJson: JSON.stringify(observed),
    })).toEqual({ passed: true, failures: [] })
    expect(() => evaluateLocalMcpFixtureTool({
      scenarioJson: JSON.stringify(scenario),
      observationJson: JSON.stringify(observed),
      extra: true,
    })).toThrow('local_mcp_fixture_input_invalid')
  })
})
