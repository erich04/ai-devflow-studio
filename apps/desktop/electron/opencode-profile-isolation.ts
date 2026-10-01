import { mkdir, mkdtemp, rm, rmdir, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Keeps the user's personal OpenCode profile out of DevFlow-initiated runs
 * (ADR 0025). The repository AGENTS.md still loads through the session
 * directory; global instructions, `opencode.json` instructions and plugins,
 * `~/.claude` files and skills, and default plugins do not.
 *
 * Only for runs with a saved Provider binding: the binding supplies the
 * provider through `OPENCODE_CONFIG_CONTENT`, so no personal auth is needed.
 */
export function isolatedOpencodeProfileEnv(
  root: string,
  options: { isolateHome?: boolean } = {},
): NodeJS.ProcessEnv {
  return {
    // `~/.agents/skills` has no opt-out switch. Only runs without a shell may
    // move HOME: commands started by a coding run still need the user's tools.
    ...(options.isolateHome ? { HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home') } : {}),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
  }
}

/** Where OpenCode keeps the tool binaries it downloads (ripgrep), under `XDG_CACHE_HOME`. */
export function opencodeToolBinDirectory(profileRoot: string): string {
  return path.join(profileRoot, 'cache', 'opencode', 'bin')
}

export async function createIsolatedOpencodeProfile(prefix: string, options: {
  isolateHome?: boolean
  /**
   * DevFlow-owned directory shared by short-lived profiles for the tool binaries OpenCode
   * downloads. Without it every read-only session downloads ripgrep again before its first
   * grep (#209). It holds executables only, never the user's configuration.
   */
  toolCacheDirectory?: string
} = {}): Promise<{
  root: string
  env: NodeJS.ProcessEnv
  dispose(): Promise<void>
}> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  const toolBin = opencodeToolBinDirectory(root)
  let linked = false
  if (options.toolCacheDirectory) {
    try {
      await mkdir(options.toolCacheDirectory, { recursive: true, mode: 0o700 })
      await mkdir(path.dirname(toolBin), { recursive: true })
      // A junction needs no privilege on Windows; elsewhere the type is ignored.
      await symlink(path.resolve(options.toolCacheDirectory), toolBin, process.platform === 'win32' ? 'junction' : 'dir')
      linked = true
    } catch {
      // The shared cache only saves a download; a session without it still works.
    }
  }
  return {
    root,
    env: isolatedOpencodeProfileEnv(root, { ...(options.isolateHome ? { isolateHome: true } : {}) }),
    dispose: async () => {
      // Remove the link itself first so the shared binaries are never deleted with the profile.
      // (`rmdir` removes a Windows junction without touching its target.)
      if (linked) await unlink(toolBin).catch(() => rmdir(toolBin)).catch(() => undefined)
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    },
  }
}
