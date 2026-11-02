import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Compile during build/CI, never from a coding task or a runtime download.
if (process.platform === 'linux') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const output = path.join(root, 'apps/desktop/dist-electron/native/coding-linux-sandbox')
  mkdirSync(path.dirname(output), { recursive: true })
  const result = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-D_FORTIFY_SOURCE=2', '-fstack-protector-strong',
    path.join(root, 'apps/desktop/electron/coding-linux-sandbox.c'), '-o', output], { stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error(`Linux sandbox helper build failed: ${result.error?.message ?? result.status}`)
}
