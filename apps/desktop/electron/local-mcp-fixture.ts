import { evaluateAgentScenario } from '@ai-devflow/shared'

const MAX_SCENARIO_JSON_LENGTH = 32 * 1_024

export const LOCAL_MCP_FIXTURE_SERVER_INFO = {
  name: 'devflow.fixture-mcp',
  version: '1.0.0',
} as const

export const LOCAL_MCP_FIXTURE_TOOL = {
  name: 'scenario.evaluate',
  description: 'Evaluate one strict scenario observation using the deterministic shared evaluator.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scenarioJson: { type: 'string', minLength: 2, maxLength: MAX_SCENARIO_JSON_LENGTH },
      observationJson: { type: 'string', minLength: 2, maxLength: MAX_SCENARIO_JSON_LENGTH },
    },
    required: ['scenarioJson', 'observationJson'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      passed: { type: 'boolean' },
      failures: {
        type: 'array',
        maxItems: 64,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
    required: ['passed', 'failures'],
  },
} as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function evaluateLocalMcpFixtureTool(value: unknown): {
  passed: boolean
  failures: string[]
} {
  if (!isPlainRecord(value)) throw new Error('local_mcp_fixture_input_invalid')
  const keys = Object.keys(value).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'observationJson' ||
    keys[1] !== 'scenarioJson' ||
    typeof value.scenarioJson !== 'string' ||
    value.scenarioJson.length < 2 ||
    value.scenarioJson.length > MAX_SCENARIO_JSON_LENGTH ||
    typeof value.observationJson !== 'string' ||
    value.observationJson.length < 2 ||
    value.observationJson.length > MAX_SCENARIO_JSON_LENGTH
  ) {
    throw new Error('local_mcp_fixture_input_invalid')
  }
  try {
    return evaluateAgentScenario({
      scenario: JSON.parse(value.scenarioJson) as never,
      observed: JSON.parse(value.observationJson) as never,
    })
  } catch {
    throw new Error('local_mcp_fixture_input_invalid')
  }
}
