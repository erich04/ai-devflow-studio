import type { EnforcementPolicyRevision, OrganizationEnforcementPolicy } from '@ai-devflow/shared'

export class EnforcementPolicyConflictError extends Error {
  constructor() { super('Team Policy changed; reload the current policy before saving.') }
}

export function assertPolicyRevision(current: OrganizationEnforcementPolicy, expected?: EnforcementPolicyRevision): void {
  if (expected && (current.id !== expected.id || current.version !== expected.version || current.updatedAt !== expected.updatedAt)) {
    throw new EnforcementPolicyConflictError()
  }
}
