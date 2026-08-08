import type { DesktopPairingCode } from '@ai-devflow/shared'

const pairingCodeKeys = [
  'attemptsRemaining',
  'code',
  'createdAt',
  'createdByUserId',
  'expiresAt',
  'id',
  'organizationId',
  'projectId',
] as const

const invalidPairingCodeResponse = 'Pairing code response was invalid.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoundedString(
  value: Record<string, unknown>,
  key: Exclude<(typeof pairingCodeKeys)[number], 'attemptsRemaining'>,
): string {
  const result = value[key]
  if (typeof result !== 'string' || result.trim().length === 0 || result.length > 512) {
    throw new Error(invalidPairingCodeResponse)
  }
  return result
}

export function parseDesktopPairingCodePayload(
  value: unknown,
  expectedProjectId: string,
): DesktopPairingCode {
  if (!isRecord(value)) {
    throw new Error(invalidPairingCodeResponse)
  }

  const actualKeys = Object.keys(value).sort()
  if (
    actualKeys.length !== pairingCodeKeys.length ||
    actualKeys.some((key, index) => key !== pairingCodeKeys[index])
  ) {
    throw new Error(invalidPairingCodeResponse)
  }

  const projectId = readBoundedString(value, 'projectId')
  const createdAt = readBoundedString(value, 'createdAt')
  const expiresAt = readBoundedString(value, 'expiresAt')
  const attemptsRemaining = value.attemptsRemaining
  if (
    projectId !== expectedProjectId ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.parse(createdAt) ||
    !Number.isInteger(attemptsRemaining) ||
    (attemptsRemaining as number) < 0 ||
    (attemptsRemaining as number) > 5
  ) {
    throw new Error(invalidPairingCodeResponse)
  }

  return {
    id: readBoundedString(value, 'id'),
    organizationId: readBoundedString(value, 'organizationId'),
    projectId,
    createdByUserId: readBoundedString(value, 'createdByUserId'),
    code: readBoundedString(value, 'code'),
    expiresAt,
    createdAt,
    attemptsRemaining: attemptsRemaining as number,
  }
}
