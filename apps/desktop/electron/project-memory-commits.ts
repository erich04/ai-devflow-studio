import { spawn } from 'node:child_process'
import { PROJECT_MEMORY_MAX_DOCUMENT_BYTES, type LocalProject, type ProjectMemoryDocumentInput } from '@ai-devflow/shared'
import { activeProjectMemoryConfiguration } from './project-memory-capture'
import type { LocalStore } from './local-store'

/**
 * Git commit messages as project memory (ADR 0030, phase 5): the recent history of the checked-out
 * branch, one document per day. Messages describe the author's intent and are not verified facts.
 */
export const COMMIT_MEMORY_DAYS = 30
export const COMMIT_MEMORY_MAX_COMMITS = 150
/** Today's document waits this long after its latest commit, so a burst of commits is learned once. */
export const COMMIT_MEMORY_SETTLE_MS = 30 * 60_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_BODY_BYTES = 1_500
const FIELD = '\u001f'
const RECORD = '\u001e'

export type CommitRecord = { sha: string; committedAt: string; subject: string; body: string }

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
function clip(text: string, max: number): string {
  if (bytes(text) <= max) return text
  let result = text
  while (result && bytes(result) + 4 > max) result = result.slice(0, -Math.max(1, Math.ceil(result.length / 64)))
  return `${result} …`
}

/** Git with no system or global configuration, no prompts and no signature checks: reading history runs nothing else. */
function gitEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', LANG: 'C', LC_ALL: 'C',
  }
  for (const name of ['HOME', 'PATH', 'SYSTEMROOT']) {
    const value = process.env[name]
    if (value) environment[name] = value
  }
  return environment
}

/** Non-merge commits of HEAD since `since`, newest first. Not a repository, or no commits: an empty list. */
export function readRecentCommits(repositoryPath: string, since: string, timeoutMs = 5_000): Promise<CommitRecord[]> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-C', repositoryPath,
      'log', '--no-merges', '--no-color', '--no-show-signature', `--since=${since}`, '-n', String(COMMIT_MEMORY_MAX_COMMITS),
      `--format=%H${FIELD}%cI${FIELD}%s${FIELD}%b${RECORD}`], { env: gitEnvironment(), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_OUTPUT_BYTES) { child.kill('SIGKILL'); return }
      chunks.push(chunk)
    })
    child.on('error', () => { clearTimeout(timer); resolve([]) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || size > MAX_OUTPUT_BYTES) { resolve([]); return }
      resolve(parseCommitLog(Buffer.concat(chunks).toString('utf8')))
    })
  })
}

export function parseCommitLog(output: string): CommitRecord[] {
  return output.split(RECORD).flatMap((record): CommitRecord[] => {
    const [sha, committedAt, subject, body] = record.replace(/^\s+/u, '').split(FIELD)
    if (!sha || !/^[0-9a-f]{40,64}$/u.test(sha) || !committedAt || !Number.isFinite(Date.parse(committedAt)) || !subject?.trim()) return []
    return [{ sha, committedAt, subject: subject.trim(), body: (body ?? '').trim() }]
  })
}

/**
 * One document per day of commits (by the commit's own date), newest commit first. A day whose
 * latest commit is recent waits a while, so later commits that day are learned together.
 */
export function buildCommitMemoryDocuments(commits: readonly CommitRecord[], now: string): ProjectMemoryDocumentInput[] {
  const days = new Map<string, CommitRecord[]>()
  for (const commit of commits) {
    const day = commit.committedAt.slice(0, 10)
    days.set(day, [...(days.get(day) ?? []), commit])
  }
  const budget = PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 1_024
  return [...days.entries()].map(([day, list]) => {
    const newestFirst = [...list].sort((left, right) => Date.parse(right.committedAt) - Date.parse(left.committedAt))
    const header = `Commits on ${day} in this project's Git history, newest first. Each message is its author's description of the change.`
    const lines: string[] = []
    for (const commit of newestFirst) {
      const body = commit.body ? `\n  ${clip(commit.body, MAX_BODY_BYTES).replace(/\r?\n/gu, '\n  ')}` : ''
      const entry = `- ${commit.sha.slice(0, 10)} ${commit.committedAt}: ${clip(commit.subject, 300)}${body}`
      if (bytes([header, ...lines, entry].join('\n')) > budget) break
      lines.push(entry)
    }
    const latest = Date.parse(newestFirst[0]!.committedAt)
    const settled = latest + COMMIT_MEMORY_SETTLE_MS
    return {
      documentId: `commits:${day}`, sourceKind: 'commit' as const, sourceId: day, title: `提交记录 ${day}`,
      payload: [header, ...lines, ...(lines.length < newestFirst.length ? [`- [${newestFirst.length - lines.length} earlier commits omitted]`] : [])].join('\n'),
      context: 'Commit messages from this project\'s Git history: what each change did and why, as its author wrote it. They are claims, not facts verified by DevFlow.',
      tags: ['source:commit'], occurredAt: new Date(latest).toISOString(),
      notBefore: settled > Date.parse(now) ? new Date(settled).toISOString() : now,
    }
  })
}

type CommitStore = Parameters<typeof activeProjectMemoryConfiguration>[0] & Pick<LocalStore, 'recordProjectMemoryDocument'>
/**
 * Records the recent commit history of a project whose memory is on. Unchanged days are no-ops and
 * a day the user forgot stays forgotten, so this can run on every scan.
 */
export async function captureCommitProjectMemory(store: CommitStore, project: Pick<LocalProject, 'id' | 'path'>, now = new Date().toISOString(),
  read: typeof readRecentCommits = readRecentCommits): Promise<void> {
  const config = await activeProjectMemoryConfiguration(store, project.id)
  if (!config) return
  const since = new Date(Date.parse(now) - COMMIT_MEMORY_DAYS * 86_400_000).toISOString()
  for (const document of buildCommitMemoryDocuments(await read(project.path, since), now)) {
    await store.recordProjectMemoryDocument(config, document)
  }
}
