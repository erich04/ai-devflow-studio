import { describe, expect, it } from 'vitest'
import {
  parseNativeToolDefinition,
  validateNativeToolValue,
  type NativeToolDefinition,
} from './native-tool'

const definition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'repo.read_text',
  version: 1,
  source: 'native',
  description: 'Read one bounded repository-relative UTF-8 file.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 240 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 65_536 },
    },
    required: ['path', 'maxBytes'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 240 },
      content: { type: 'string', maxLength: 65_536 },
      truncated: { type: 'boolean' },
    },
    required: ['path', 'content', 'truncated'],
  },
  permissionClass: 'read',
  sideEffectClass: 'none',
  defaultDeadlineMs: 5_000,
  maxResultBytes: 65_536,
  idempotency: 'idempotent',
  auditPolicy: 'redacted_metadata_only',
}

describe('Native Tool contract', () => {
  it('parses one exact bounded native Tool definition', () => {
    expect(parseNativeToolDefinition(definition)).toEqual(definition)
  })

  it('uses the same bounded Tool contract for an installation-owned MCP Tool', () => {
    const mcpDefinition = { ...definition, id: 'fixture.echo', source: 'mcp' as const }
    expect(parseNativeToolDefinition(mcpDefinition)).toEqual(mcpDefinition)
  })

  it.each([
    ['extra definition field', { ...definition, command: 'cat' }],
    ['unknown source', { ...definition, source: 'renderer' }],
    ['unbounded deadline', { ...definition, defaultDeadlineMs: 0 }],
    ['unbounded result', { ...definition, maxResultBytes: 1_000_000 }],
    [
      'schema ref',
      { ...definition, inputSchema: { ...definition.inputSchema, $ref: '#/unsafe' } },
    ],
    [
      'schema union',
      { ...definition, inputSchema: { ...definition.inputSchema, oneOf: [] } },
    ],
    [
      'open object schema',
      { ...definition, inputSchema: { ...definition.inputSchema, additionalProperties: true } },
    ],
    [
      'unknown required key',
      { ...definition, inputSchema: { ...definition.inputSchema, required: ['missing'] } },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseNativeToolDefinition(value)).toThrowError('invalid_native_tool_definition')
  })

  it('validates exact input and output values without coercion', () => {
    expect(
      validateNativeToolValue(definition.inputSchema, {
        path: 'src/index.ts',
        maxBytes: 1024,
      }),
    ).toBe(true)
    expect(
      validateNativeToolValue(definition.outputSchema, {
        path: 'src/index.ts',
        content: 'export {}',
        truncated: false,
      }),
    ).toBe(true)

    for (const value of [
      { path: 'src/index.ts', maxBytes: '1024' },
      { path: 'src/index.ts', maxBytes: 1024, command: 'cat' },
      { path: 'src/index.ts' },
      { path: '', maxBytes: 1024 },
      { path: 'src/index.ts', maxBytes: 65_537 },
    ]) {
      expect(validateNativeToolValue(definition.inputSchema, value)).toBe(false)
    }
  })
})
