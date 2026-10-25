import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const PACKAGE_MANAGER_COMMAND = /(?:^|&&\s*)(?:npm|pnpm|yarn|bun)(?:\s|$)/u
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', '.turbo'])
const INPUT_FILE = /^(?:package\.json|pnpm-workspace\.yaml|\.npmrc|\.yarnrc(?:\.yml)?|bunfig\.toml|tsconfig[^/]*\.json|[^/]+\.config\.(?:[cm]?[jt]s|json))$/u
const MAX_DEPTH = 12
const MAX_ENTRIES = 50_000
const MAX_FILES = 2_000

export class CommandInputsUnavailableError extends Error {}

/**
 * An approved `pnpm test` runs whatever the package scripts and tool configuration say at that
 * moment, so a reusable grant is bound to them. Returns undefined for commands that do not run
 * package scripts. Fails closed when the inputs cannot be enumerated completely.
 */
export async function codingCommandInputsDigest(worktreePath: string, command: string): Promise<string | undefined> {
  if (!PACKAGE_MANAGER_COMMAND.test(command)) return undefined
  const files: string[] = []
  let entries = 0
  const visit = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new CommandInputsUnavailableError('The worktree has too many entries to check command inputs.')
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        if (depth >= MAX_DEPTH) throw new CommandInputsUnavailableError('The worktree is too deep to check command inputs.')
        await visit(full, depth + 1)
      } else if ((entry.isFile() || entry.isSymbolicLink()) && INPUT_FILE.test(entry.name)) {
        if (files.push(full) > MAX_FILES) throw new CommandInputsUnavailableError('The worktree has too many command input files.')
      }
    }
  }
  try {
    await visit(worktreePath, 0)
    const digests = await Promise.all(files.map(async (file) => [
      path.relative(worktreePath, file).split(path.sep).join('/'),
      createHash('sha256').update(await readFile(file)).digest('hex'),
    ] as const))
    digests.sort(([left], [right]) => left.localeCompare(right))
    return createHash('sha256').update(JSON.stringify(digests)).digest('hex')
  } catch (error) {
    if (error instanceof CommandInputsUnavailableError) throw error
    throw new CommandInputsUnavailableError('Command inputs could not be read from the managed worktree.')
  }
}
