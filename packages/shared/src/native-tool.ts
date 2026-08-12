export const NATIVE_TOOL_CONTRACT_VERSION = 1 as const
export const NATIVE_TOOL_ID_MAX_LENGTH = 200
export const NATIVE_TOOL_MAX_SCHEMA_DEPTH = 4
export const NATIVE_TOOL_MAX_SCHEMA_PROPERTIES = 64
export const NATIVE_TOOL_MAX_ARRAY_ITEMS = 256
export const NATIVE_TOOL_MAX_DEADLINE_MS = 120_000
export const NATIVE_TOOL_MAX_RESULT_BYTES = 256 * 1_024

const MAX_SCHEMA_STRING_LENGTH = NATIVE_TOOL_MAX_RESULT_BYTES
const MAX_VERSION = 2_147_483_647
const identifierPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u
const propertyNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,199}$/u

export type NativeToolStringSchema = {
  type: 'string'
  minLength?: number
  maxLength?: number
  enum?: string[]
}

export type NativeToolNumberSchema = {
  type: 'integer' | 'number'
  minimum?: number
  maximum?: number
}

export type NativeToolBooleanSchema = {
  type: 'boolean'
}

export type NativeToolArraySchema = {
  type: 'array'
  items: NativeToolJsonSchema
  maxItems: number
}

export type NativeToolObjectSchema = {
  type: 'object'
  properties: Record<string, NativeToolJsonSchema>
  required: string[]
  additionalProperties: false
}

export type NativeToolJsonSchema =
  | NativeToolStringSchema
  | NativeToolNumberSchema
  | NativeToolBooleanSchema
  | NativeToolArraySchema
  | NativeToolObjectSchema

export type NativeToolPermissionClass = 'read' | 'edit' | 'execute'
export type NativeToolSideEffectClass = 'none' | 'workspace_write' | 'local_process'
export type NativeToolIdempotency = 'idempotent' | 'reconcilable'

export type NativeToolDefinition = {
  stateVersion: typeof NATIVE_TOOL_CONTRACT_VERSION
  id: string
  version: number
  source: 'native' | 'mcp'
  description: string
  inputSchema: NativeToolObjectSchema
  outputSchema: NativeToolObjectSchema
  permissionClass: NativeToolPermissionClass
  sideEffectClass: NativeToolSideEffectClass
  defaultDeadlineMs: number
  maxResultBytes: number
  idempotency: NativeToolIdempotency
  auditPolicy: 'redacted_metadata_only'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function schemaKeysAreExact(
  schema: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(schema)
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  )
}

function isValidSchema(schema: unknown, depth: number): schema is NativeToolJsonSchema {
  if (!isPlainObject(schema) || depth > NATIVE_TOOL_MAX_SCHEMA_DEPTH) {
    return false
  }

  if (schema.type === 'string') {
    if (!schemaKeysAreExact(schema, ['type'], ['minLength', 'maxLength', 'enum'])) {
      return false
    }
    const minimum = schema.minLength ?? 0
    const maximum = schema.maxLength ?? MAX_SCHEMA_STRING_LENGTH
    if (
      !isBoundedInteger(minimum, 0, MAX_SCHEMA_STRING_LENGTH) ||
      !isBoundedInteger(maximum, 0, MAX_SCHEMA_STRING_LENGTH) ||
      minimum > maximum
    ) {
      return false
    }
    if (schema.enum !== undefined) {
      if (
        !Array.isArray(schema.enum) ||
        schema.enum.length === 0 ||
        schema.enum.length > NATIVE_TOOL_MAX_SCHEMA_PROPERTIES ||
        new Set(schema.enum).size !== schema.enum.length ||
        !schema.enum.every(
          (entry) =>
            typeof entry === 'string' && entry.length >= minimum && entry.length <= maximum,
        )
      ) {
        return false
      }
    }
    return true
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    if (!schemaKeysAreExact(schema, ['type'], ['minimum', 'maximum'])) {
      return false
    }
    if (
      (schema.minimum !== undefined && !isFiniteNumber(schema.minimum)) ||
      (schema.maximum !== undefined && !isFiniteNumber(schema.maximum)) ||
      (schema.minimum !== undefined &&
        schema.maximum !== undefined &&
        schema.minimum > schema.maximum)
    ) {
      return false
    }
    return true
  }

  if (schema.type === 'boolean') {
    return hasExactKeys(schema, ['type'])
  }

  if (schema.type === 'array') {
    return (
      hasExactKeys(schema, ['type', 'items', 'maxItems']) &&
      isBoundedInteger(schema.maxItems, 0, NATIVE_TOOL_MAX_ARRAY_ITEMS) &&
      isValidSchema(schema.items, depth + 1)
    )
  }

  if (schema.type === 'object') {
    if (
      !hasExactKeys(schema, ['type', 'properties', 'required', 'additionalProperties']) ||
      schema.additionalProperties !== false ||
      !isPlainObject(schema.properties) ||
      !Array.isArray(schema.required)
    ) {
      return false
    }
    const properties = schema.properties as Record<string, unknown>
    const propertyKeys = Object.keys(properties)
    if (
      propertyKeys.length > NATIVE_TOOL_MAX_SCHEMA_PROPERTIES ||
      !propertyKeys.every(
        (key) =>
          propertyNamePattern.test(key) && isValidSchema(properties[key], depth + 1),
      ) ||
      schema.required.length > propertyKeys.length ||
      !schema.required.every((key): key is string => typeof key === 'string') ||
      new Set(schema.required).size !== schema.required.length ||
      !schema.required.every((key) => propertyKeys.includes(key))
    ) {
      return false
    }
    return true
  }

  return false
}

function isCompatibleAuthority(
  permissionClass: NativeToolPermissionClass,
  sideEffectClass: NativeToolSideEffectClass,
): boolean {
  if (permissionClass === 'read') {
    return sideEffectClass === 'none'
  }
  if (permissionClass === 'edit') {
    return sideEffectClass === 'workspace_write'
  }
  return sideEffectClass === 'none' || sideEffectClass === 'local_process'
}

export function parseNativeToolDefinition(value: unknown): NativeToolDefinition {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'version',
      'source',
      'description',
      'inputSchema',
      'outputSchema',
      'permissionClass',
      'sideEffectClass',
      'defaultDeadlineMs',
      'maxResultBytes',
      'idempotency',
      'auditPolicy',
    ]) ||
    value.stateVersion !== NATIVE_TOOL_CONTRACT_VERSION ||
    typeof value.id !== 'string' ||
    value.id.length > NATIVE_TOOL_ID_MAX_LENGTH ||
    !identifierPattern.test(value.id) ||
    !isBoundedInteger(value.version, 1, MAX_VERSION) ||
    !['native', 'mcp'].includes(String(value.source)) ||
    typeof value.description !== 'string' ||
    value.description.length === 0 ||
    value.description.length > 500 ||
    value.description.trim() !== value.description ||
    !isValidSchema(value.inputSchema, 1) ||
    value.inputSchema.type !== 'object' ||
    !isValidSchema(value.outputSchema, 1) ||
    value.outputSchema.type !== 'object' ||
    !['read', 'edit', 'execute'].includes(String(value.permissionClass)) ||
    !['none', 'workspace_write', 'local_process'].includes(String(value.sideEffectClass)) ||
    !isCompatibleAuthority(
      value.permissionClass as NativeToolPermissionClass,
      value.sideEffectClass as NativeToolSideEffectClass,
    ) ||
    !isBoundedInteger(value.defaultDeadlineMs, 1, NATIVE_TOOL_MAX_DEADLINE_MS) ||
    !isBoundedInteger(value.maxResultBytes, 1, NATIVE_TOOL_MAX_RESULT_BYTES) ||
    !['idempotent', 'reconcilable'].includes(String(value.idempotency)) ||
    value.auditPolicy !== 'redacted_metadata_only'
  ) {
    throw new Error('invalid_native_tool_definition')
  }

  return JSON.parse(JSON.stringify(value)) as NativeToolDefinition
}

function validatesValue(schema: NativeToolJsonSchema, value: unknown, depth: number): boolean {
  if (depth > NATIVE_TOOL_MAX_SCHEMA_DEPTH + 1) {
    return false
  }
  if (schema.type === 'string') {
    return (
      typeof value === 'string' &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= (schema.maxLength ?? MAX_SCHEMA_STRING_LENGTH) &&
      (schema.enum === undefined || schema.enum.includes(value))
    )
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return (
      isFiniteNumber(value) &&
      (schema.type !== 'integer' || Number.isInteger(value)) &&
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum)
    )
  }
  if (schema.type === 'boolean') {
    return typeof value === 'boolean'
  }
  if (schema.type === 'array') {
    return (
      Array.isArray(value) &&
      value.length <= schema.maxItems &&
      value.every((entry) => validatesValue(schema.items, entry, depth + 1))
    )
  }
  if (schema.type !== 'object') {
    return false
  }
  if (!isPlainObject(value)) {
    return false
  }
  const keys = Object.keys(value)
  return (
    keys.every((key) => Object.hasOwn(schema.properties, key)) &&
    schema.required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => validatesValue(schema.properties[key]!, value[key], depth + 1))
  )
}

export function validateNativeToolValue(schema: NativeToolJsonSchema, value: unknown): boolean {
  return isValidSchema(schema, 1) && validatesValue(schema, value, 1)
}
