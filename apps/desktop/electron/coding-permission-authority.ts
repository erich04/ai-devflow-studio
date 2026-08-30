import type { DesktopPairingCredential } from '@ai-devflow/shared'
import type { ReplyCodingPermissionInput } from './ipc-contract.js'

export function resolveTrustedCodingPermissionReply(input: {
  input: ReplyCodingPermissionInput
  projectId: string
  pairing: DesktopPairingCredential | null
}): ReplyCodingPermissionInput {
  const pairing = input.pairing
  const hasBoundMembership = pairing?.projectMemberships.some(
    (membership) =>
      membership.projectId === pairing.projectId &&
      membership.userId === pairing.userId,
  ) ?? false
  if (
    !pairing ||
    pairing.localProjectId !== input.projectId ||
    pairing.userId.trim().length === 0 ||
    !hasBoundMembership
  ) {
    throw new Error('Coding permission reply requires the current trusted project pairing')
  }

  return {
    ...input.input,
    decidedBy: pairing.userId,
  }
}
