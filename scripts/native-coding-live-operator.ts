import type { CodingHarnessCommand, CodingHarnessSnapshot } from '../packages/shared/src/index.ts'
import type { NativeCodingSession } from '../apps/desktop/electron/native-coding-session.ts'

type PermissionDecision = Pick<Extract<CodingHarnessCommand, { type: 'permission' }>, 'type' | 'permissionId' | 'decision'>
type ChildView = Pick<CodingHarnessSnapshot, 'status' | 'permission' | 'question'>

export type EvaluationTestInputPolicy = 'approve_exact_content'

/** Opt-in authorization for isolated evaluations whose external scorer restores
 * its own frozen tests. Product permissions still bind the exact content digest. */
export function evaluationPermissionDecision(permissionId: string, session: Pick<NativeCodingSession, 'objectiveVersion' | 'permissions'> | undefined, policy?: EvaluationTestInputPolicy): 'approved' | 'rejected' {
  const permission = session?.permissions.find((item) => item.id === permissionId)
  return policy === 'approve_exact_content' && permission?.kind === 'test_inputs' && permission.decision === 'pending' &&
    permission.objectiveVersion === session?.objectiveVersion && Date.parse(permission.expiresAt) > Date.now()
    ? 'approved' : 'rejected'
}

/** Apply the same frozen operator policy to child cards shown by the real UI. */
export async function handleEvaluationChildControls(snapshot: Pick<CodingHarnessSnapshot, 'children'>, host: {
  get(codingRunId: string): Promise<ChildView>
  command(body: PermissionDecision, codingRunId: string): Promise<unknown>
  decidePermission?(permissionId: string, codingRunId: string): Promise<'approved' | 'rejected'>
}): Promise<{ handled: boolean; unansweredChild?: string }> {
  let handled = false
  for (const child of snapshot.children) {
    if (!['waiting_input', 'waiting_permission'].includes(child.status)) continue
    const current = await host.get(child.id)
    if (current.status === 'waiting_input' && current.question) return { handled, unansweredChild: child.id }
    if (current.status === 'waiting_permission' && current.permission) {
      const decision = await host.decidePermission?.(current.permission.id, child.id) ?? 'rejected'
      await host.command({ type: 'permission', permissionId: current.permission.id, decision }, child.id)
      handled = true
    }
  }
  return { handled }
}
