import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicCodingFile, codingDigest, type CodingCandidateWorkspace, type CodingFileEntry, type CodingManifest, type CodingRevision } from './coding-candidate-workspace'

type MergeEdit = { path: string; before: CodingFileEntry | null; after: CodingFileEntry | null; bytes: string | null }
type MergeJournal = { id: string; parentBefore: CodingManifest; childDigest: string; objectiveVersion: number; edits: MergeEdit[]; status: 'applying' | 'completed'; result?: { childChangeSetId: string; parentRevision: string; changedPaths: string[] } }
const same = (a: CodingFileEntry | null | undefined, b: CodingFileEntry | null | undefined) => (a?.hash ?? null) === (b?.hash ?? null) && (a?.mode ?? null) === (b?.mode ?? null)
const exec = promisify(execFile)

/** Three-way merge against the child's immutable base, never blindly reapply a stale patch. */
export async function mergeCodingChild(input: { parent: CodingCandidateWorkspace; child: CodingCandidateWorkspace; revision: CodingRevision; expectedParentRevision: string; objectiveVersion: number; assertWriter(): Promise<void> }) {
  const { parent, child, revision } = input
  const journalFile = path.join(parent.root, 'merges', `${codingDigest(revision.id)}.json`)
  let journal: MergeJournal | undefined
  try { journal = JSON.parse(await readFile(journalFile, 'utf8')) as MergeJournal } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (journal?.childDigest !== undefined && journal.childDigest !== revision.digest) throw new Error('Child ChangeSet identity changed')
  if (journal?.status === 'completed') return journal.result!
  if (journal && journal.objectiveVersion !== input.objectiveVersion) throw new Error('Interrupted child merge requires reconciliation before changing the goal')
  await input.assertWriter()
  if (!journal) {
    const current = await parent.inspect()
    if (current.digest !== input.expectedParentRevision) throw new Error('Parent revision changed before merge')
    if (revision.base.digest !== child.identity.base.digest || (await child.inspect()).digest !== revision.target.digest) throw new Error('Child revision changed after freeze')
    const currentFiles = new Map(current.files.map(file => [file.path, file])), edits: MergeEdit[] = [], conflicts: string[] = []
    for (const operation of revision.operations) {
      const local = currentFiles.get(operation.path) ?? null
      if (same(local, operation.after)) continue
      let bytes: Buffer | null = operation.after ? await child.blob(operation.after.hash) : null, target = operation.after
      if (!same(local, operation.before)) {
        if (!local || !operation.before || !operation.after || (local.mode !== operation.before.mode && operation.after.mode !== operation.before.mode && local.mode !== operation.after.mode)) { conflicts.push(operation.path); continue }
        const ours = (await parent.read(operation.path)).bytes, base = await child.blob(operation.before.hash)
        if ([ours, base, bytes!].some(value => value.includes(0))) { conflicts.push(operation.path); continue }
        const directory = path.join(parent.root, `merge-input-${codingDigest(revision.id + operation.path)}`)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        try {
          const paths = ['ours', 'base', 'theirs'].map(name => path.join(directory, name))
          await Promise.all(paths.map((file, index) => writeFile(file, [ours, base, bytes!][index]!, { mode: 0o600 })))
          const output = await exec('git', ['merge-file', '--stdout', '--', ...paths], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
          bytes = Buffer.from(output.stdout)
          target = { ...operation.after, hash: codingDigest(bytes), size: bytes.length, mode: local.mode !== operation.before.mode ? local.mode : operation.after.mode }
        } catch (error) { if (typeof (error as { code?: unknown }).code === 'number') { conflicts.push(operation.path); continue }; throw error }
        finally { await rm(directory, { recursive: true, force: true }) }
      }
      edits.push({ path: operation.path, before: local, after: target, bytes: bytes?.toString('base64') ?? null })
    }
    if (conflicts.length) return { conflicts, merged: false as const, parentRevision: current.digest }
    edits.sort((a, b) => Number(a.after !== null) - Number(b.after !== null) || (a.after ? a.path.length - b.path.length : b.path.length - a.path.length))
    journal = { id: revision.id, parentBefore: current, childDigest: revision.digest, objectiveVersion: input.objectiveVersion, edits, status: 'applying' }
    await mkdir(path.dirname(journalFile), { recursive: true, mode: 0o700 })
    await atomicCodingFile(journalFile, Buffer.from(JSON.stringify(journal)))
  }
  const observed = await parent.inspect(), previous = new Map(journal.parentBefore.files.map(file => [file.path, file])), edits = new Map(journal.edits.map(edit => [edit.path, edit]))
  for (const relative of new Set([...observed.files.map(file => file.path), ...previous.keys()])) {
    const current = observed.files.find(file => file.path === relative), edit = edits.get(relative)
    if (edit ? !same(current, edit.before) && !same(current, edit.after) : !same(current, previous.get(relative))) throw new Error('Child merge receipt conflicts with parent bytes')
  }
  for (const edit of journal.edits) {
    await input.assertWriter()
    const actual = (await parent.inspect()).files.find(file => file.path === edit.path)
    if (same(actual, edit.after)) continue
    if (!same(actual, edit.before)) throw new Error('Parent changed during child merge')
    if (edit.after) await parent.write(edit.path, Buffer.from(edit.bytes!, 'base64'), edit.before?.hash ?? null, edit.after.mode)
    else await parent.remove(edit.path, edit.before!.hash)
  }
  journal.result = { childChangeSetId: revision.id, parentRevision: (await parent.inspect()).digest, changedPaths: journal.edits.map(edit => edit.path) }; journal.status = 'completed'
  await atomicCodingFile(journalFile, Buffer.from(JSON.stringify(journal)))
  return journal.result
}
