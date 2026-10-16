import { chmod, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { CodingCandidateWorkspace, atomicCodingFile, codingDigest, codingFilePath, removeCodingFile, snapshotCodingTree, type CodingFileEntry, type CodingRevision } from './coding-candidate-workspace'

export type CodingApproval = { id: string; revisionDigest: string; objectiveVersion: number; policyVersion: number; expiresAt: string }
export type CodingVerificationResult = { exitCode: number | null; status: 'passed' | 'failed' | 'timed_out' | 'cancelled'; logId: string }
export type CodingDeliveryEvidence = {
  schemaVersion: 1; id: string; revisionDigest: string; testPlanDigest: string; approvalId: string
  status: 'technical_completed' | 'verified_no_change' | 'manual_accepted' | 'test_failed' | 'evidence_invalid' | 'delivery_conflict'
  targetDigest: string; verificationBefore: string | null; verificationAfter: string | null; deliveryAfter: string | null
  result?: CodingVerificationResult; error?: string; startedAt: string; completedAt: string
  verificationDirectory?: string; environmentDigest?: string
  manualAcceptance?: { plan: string; notes: string; actorId: string; confirmedAt: string }
}
type Transaction = { schemaVersion: 1; revision: CodingRevision; approval: CodingApproval; status: 'applying' | 'applied' | 'rolling_back' | 'rolled_back' | 'completed' | 'conflict'; appliedPaths: string[]; evidence?: CodingDeliveryEvidence }
const same = (left: CodingFileEntry | null | undefined, right: CodingFileEntry | null | undefined) => (left?.hash ?? null) === (right?.hash ?? null) && (left?.mode ?? null) === (right?.mode ?? null)
const transactionPath = (workspace: CodingCandidateWorkspace, approvalId: string) => path.join(workspace.root, 'transactions', `${codingDigest(approvalId)}.json`)
const save = async (workspace: CodingCandidateWorkspace, transaction: Transaction) => atomicCodingFile(transactionPath(workspace, transaction.approval.id), Buffer.from(JSON.stringify(transaction)))

async function put(workspace: CodingCandidateWorkspace, entry: CodingFileEntry | null, relative: string): Promise<void> {
  if (!entry) await removeCodingFile(workspace.identity.delivery, relative)
  else { const full = await codingFilePath(workspace.identity.delivery, relative, true); await atomicCodingFile(full, await workspace.blob(entry.hash), entry.mode); await chmod(full, entry.mode) }
}

async function rollback(workspace: CodingCandidateWorkspace, transaction: Transaction): Promise<boolean> {
  const observed = await snapshotCodingTree(workspace.identity.delivery, transaction.revision.base.excludedPaths)
  const current = new Map(observed.files.map(file => [file.path, file])), base = new Map(transaction.revision.base.files.map(file => [file.path, file]))
  const operations = new Map(transaction.revision.operations.map(operation => [operation.path, operation]))
  // Prove every byte is either the baseline or this transaction's write. Never overwrite external work.
  for (const relative of new Set([...current.keys(), ...base.keys(), ...operations.keys()])) {
    const operation = operations.get(relative)
    if (operation ? !same(current.get(relative), operation.before) && !same(current.get(relative), operation.after) : !same(current.get(relative), base.get(relative))) {
      transaction.status = 'conflict'; await save(workspace, transaction); return false
    }
  }
  transaction.status = 'rolling_back'; await save(workspace, transaction)
  const reverse = [...transaction.revision.operations].sort((a, b) => Number(a.before !== null) - Number(b.before !== null) || (a.before === null ? b.path.length - a.path.length : a.path.length - b.path.length))
  for (const operation of reverse) {
    const actual = (await snapshotCodingTree(workspace.identity.delivery, transaction.revision.base.excludedPaths)).files.find(file => file.path === operation.path)
    if (!same(actual, operation.before)) {
      if (!same(actual, operation.after)) { transaction.status = 'conflict'; await save(workspace, transaction); return false }
      await put(workspace, operation.before, operation.path)
    }
  }
  const restored = (await snapshotCodingTree(workspace.identity.delivery, transaction.revision.base.excludedPaths)).digest === transaction.revision.base.digest
  transaction.status = restored ? 'rolled_back' : 'conflict'; await save(workspace, transaction); return restored
}

/** Restart reconciliation does not replay an approval or a test with unknown effects. */
export async function recoverCodingDelivery(workspace: CodingCandidateWorkspace): Promise<{ status: 'clean' | 'restored' | 'delivery_conflict'; evidence: CodingDeliveryEvidence[] }> {
  let entries: string[]
  try { entries = await readdir(path.join(workspace.root, 'transactions')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'clean', evidence: [] }; throw error }
  const evidence: CodingDeliveryEvidence[] = []; let restored = false
  for (const file of entries.filter(item => item.endsWith('.json'))) {
    const transaction = JSON.parse(await readFile(path.join(workspace.root, 'transactions', file), 'utf8')) as Transaction
    if (transaction.evidence) evidence.push(transaction.evidence)
    if (transaction.status === 'completed' || transaction.status === 'rolled_back') continue
    if (!await rollback(workspace, transaction)) return { status: 'delivery_conflict', evidence }
    restored = true
  }
  return { status: restored ? 'restored' : 'clean', evidence }
}

export async function applyAndVerifyCodingRevision(input: {
  workspace: CodingCandidateWorkspace; revision: CodingRevision; approval: CodingApproval
  assertAuthority(): Promise<void>
  verify(directory: string): Promise<CodingVerificationResult>
  manualAcceptance?: NonNullable<CodingDeliveryEvidence['manualAcceptance']>
}): Promise<CodingDeliveryEvidence> {
  const { workspace, revision, approval } = input
  if (input.manualAcceptance && (!input.manualAcceptance.plan.trim() || !input.manualAcceptance.notes.trim() || !input.manualAcceptance.actorId || !Number.isFinite(Date.parse(input.manualAcceptance.confirmedAt)))) throw new Error('Invalid human validation evidence')
  const { digest, ...body } = revision
  if (codingDigest(JSON.stringify(body)) !== digest || revision.base.digest !== workspace.identity.base.digest ||
    approval.revisionDigest !== digest || approval.objectiveVersion !== revision.objectiveVersion || approval.policyVersion !== revision.policyVersion ||
    !Number.isFinite(Date.parse(approval.expiresAt)) || Date.now() >= Date.parse(approval.expiresAt)) throw new Error('Invalid or expired coding approval')
  await input.assertAuthority()
  if ((await workspace.inspect()).digest !== revision.target.digest) throw new Error('Candidate changed after freeze')
  if ((await snapshotCodingTree(workspace.identity.delivery, revision.base.excludedPaths)).digest !== revision.base.digest) throw new Error('Delivery differs from approved baseline')
  await mkdir(path.join(workspace.root, 'transactions'), { recursive: true, mode: 0o700 })
  // This file is consumed once, even if the operation subsequently fails or verification outlives TTL.
  const transaction: Transaction = { schemaVersion: 1, revision, approval, status: 'applying', appliedPaths: [] }
  const handle = await import('node:fs/promises').then(fs => fs.open(transactionPath(workspace, approval.id), 'wx', 0o600))
  try { await handle.writeFile(JSON.stringify(transaction)); await handle.sync() } finally { await handle.close() }
  const evidence: CodingDeliveryEvidence = { schemaVersion: 1, id: `evidence-${codingDigest(approval.id)}`, revisionDigest: digest, testPlanDigest: revision.testPlanDigest,
    approvalId: approval.id, status: 'evidence_invalid', targetDigest: revision.target.digest, verificationBefore: null, verificationAfter: null, deliveryAfter: null, startedAt: new Date().toISOString(), completedAt: '' }
  try {
    for (const operation of revision.operations) {
      await input.assertAuthority()
      const actual = (await snapshotCodingTree(workspace.identity.delivery, revision.base.excludedPaths)).files.find(file => file.path === operation.path)
      if (!same(actual, operation.before)) throw new Error('Delivery changed during application')
      await put(workspace, operation.after, operation.path)
      transaction.appliedPaths.push(operation.path); await save(workspace, transaction)
    }
    if ((await snapshotCodingTree(workspace.identity.delivery, revision.base.excludedPaths)).digest !== revision.target.digest) throw new Error('Applied content does not match revision')
    transaction.status = 'applied'; await save(workspace, transaction)
    const verification = path.join(workspace.root, `verify-${codingDigest(approval.id)}`)
    evidence.verificationDirectory = verification
    evidence.environmentDigest = codingDigest(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.versions.node, testPlanDigest: revision.testPlanDigest }))
    // Materialize the exact applied bytes via their verified blobs, never a linked worktree.
    await workspace.materialize(revision.target, verification)
    evidence.verificationBefore = (await snapshotCodingTree(verification, revision.base.excludedPaths)).digest
    if (input.manualAcceptance) evidence.manualAcceptance = input.manualAcceptance
    else evidence.result = await input.verify(verification)
    evidence.verificationAfter = (await snapshotCodingTree(verification, revision.base.excludedPaths)).digest
    evidence.deliveryAfter = (await snapshotCodingTree(workspace.identity.delivery, revision.base.excludedPaths)).digest
    await input.assertAuthority()
    if (evidence.deliveryAfter !== revision.target.digest) evidence.status = 'delivery_conflict'
    else if (evidence.verificationBefore !== revision.target.digest || evidence.verificationAfter !== revision.target.digest) evidence.status = 'evidence_invalid'
    else if (evidence.manualAcceptance) evidence.status = 'manual_accepted'
    else if (evidence.result?.status !== 'passed' || evidence.result.exitCode !== 0) evidence.status = 'test_failed'
    else evidence.status = revision.operations.length ? 'technical_completed' : 'verified_no_change'
  } catch (error) { evidence.error = error instanceof Error ? error.message : 'Verification interrupted' }
  if (['technical_completed', 'verified_no_change', 'manual_accepted'].includes(evidence.status)) transaction.status = 'completed'
  else {
    try { if (!await rollback(workspace, transaction)) evidence.status = 'delivery_conflict' }
    catch (error) { evidence.status = 'delivery_conflict'; evidence.error = error instanceof Error ? error.message : 'Recovery incomplete'; transaction.status = 'conflict' }
  }
  evidence.completedAt = new Date().toISOString(); transaction.evidence = evidence; await save(workspace, transaction)
  return evidence
}
