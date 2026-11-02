import type { DesktopPairingCredential } from './domain'
/** Coding permission follows trusted project membership; it is not the Lead-only design gate. */
export function canDecideCodingPermission(pairing: DesktopPairingCredential | null | undefined, projectId: string): boolean {
  return Boolean(pairing && pairing.localProjectId === projectId && pairing.projectId && pairing.userId && pairing.projectMemberships.some(m => m.projectId === pairing.projectId && m.userId === pairing.userId))
}
