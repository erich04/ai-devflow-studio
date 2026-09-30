import { mkdtemp, rm } from 'node:fs/promises'
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

export async function createIsolatedOpencodeProfile(prefix: string, options: { isolateHome?: boolean } = {}): Promise<{
  root: string
  env: NodeJS.ProcessEnv
  dispose(): Promise<void>
}> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  return {
    root,
    env: isolatedOpencodeProfileEnv(root, options),
    dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  }
}
