import type { CodingHarnessCommand, CodingHarnessSnapshot } from '../packages/shared/src/index.ts'

type PermissionDecision = Pick<Extract<CodingHarnessCommand, { type: 'permission' }>, 'type' | 'permissionId' | 'decision'>
type ChildView = Pick<CodingHarnessSnapshot, 'status' | 'permission' | 'question'>

/** Apply the same frozen operator policy to child cards shown by the real UI. */
export async function handleEvaluationChildControls(snapshot: Pick<CodingHarnessSnapshot, 'children'>, host: {
  get(codingRunId: string): Promise<ChildView>
  command(body: PermissionDecision, codingRunId: string): Promise<unknown>
}): Promise<{ handled: boolean; unansweredChild?: string }> {
  let handled = false
  for (const child of snapshot.children) {
    if (!['waiting_input', 'waiting_permission'].includes(child.status)) continue
    const current = await host.get(child.id)
    if (current.status === 'waiting_input' && current.question) return { handled, unansweredChild: child.id }
    if (current.status === 'waiting_permission' && current.permission) {
      await host.command({ type: 'permission', permissionId: current.permission.id, decision: 'rejected' }, child.id)
      handled = true
    }
  }
  return { handled }
}
