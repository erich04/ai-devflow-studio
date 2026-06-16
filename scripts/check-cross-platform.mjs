import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))

const checks = [
  {
    file: 'package.json',
    blocked: [
      { pattern: /\/tmp\//, reason: 'package scripts must not hard-code POSIX /tmp paths' },
      { pattern: /\bcurl\b/, reason: 'package scripts must not depend on curl' },
      { pattern: /\bkill\b/, reason: 'package scripts must not depend on POSIX kill' },
      { pattern: /\bbash\b|\bzsh\b/, reason: 'package scripts must not depend on bash/zsh' },
    ],
    required: [
      { pattern: /"test:e2e":\s*"node scripts\/e2e\.mjs"/, reason: 'test:e2e should use the Node E2E runner' },
      {
        pattern: /"test:electron-smoke":\s*"node scripts\/electron-smoke\.mjs"/,
        reason: 'test:electron-smoke should use the Node Electron smoke runner',
      },
    ],
  },
  {
    file: 'scripts/e2e.mjs',
    blocked: [
      { pattern: /\/tmp\//, reason: 'E2E runner must use Node APIs instead of POSIX /tmp paths' },
      { pattern: /\bcurl\b/, reason: 'E2E runner must use fetch instead of curl' },
      { pattern: /\bkill\s+\$/, reason: 'E2E runner must stop child processes through Node APIs' },
      { pattern: /\bbash\b|\bzsh\b/, reason: 'E2E runner must not depend on bash/zsh' },
    ],
    required: [
      { pattern: /corepack\.cmd/, reason: 'E2E runner should resolve corepack.cmd on Windows' },
      { pattern: /fileURLToPath/, reason: 'E2E runner should resolve paths with fileURLToPath' },
    ],
  },
  {
    file: 'scripts/electron-smoke.mjs',
    blocked: [
      { pattern: /\/tmp\//, reason: 'Electron smoke must use os.tmpdir() and path.join()' },
      { pattern: /\bbash\b|\bzsh\b/, reason: 'Electron smoke must not depend on bash/zsh' },
      { pattern: /\brm\s+-rf\b/, reason: 'Electron smoke must not hard-code POSIX destructive commands' },
    ],
    required: [
      { pattern: /corepack\.cmd/, reason: 'Electron smoke should resolve corepack.cmd on Windows' },
      { pattern: /os\.tmpdir\(\)/, reason: 'Electron smoke should use os.tmpdir() for temporary files' },
      { pattern: /path\.join/, reason: 'Electron smoke should use path.join for paths' },
    ],
  },
]

const failures = []

for (const check of checks) {
  const content = await readFile(path.join(rootDir, check.file), 'utf8')

  for (const blocked of check.blocked) {
    if (blocked.pattern.test(content)) {
      failures.push(`${check.file}: ${blocked.reason}`)
    }
  }

  for (const required of check.required) {
    if (!required.pattern.test(content)) {
      failures.push(`${check.file}: ${required.reason}`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Cross-platform desktop checks passed.')
