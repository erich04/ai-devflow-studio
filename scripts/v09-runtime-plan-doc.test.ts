import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const planPath = join(process.cwd(), 'docs/plans/v0.9-real-runtime-observability.md')

const runtimeSeams = [
  'packages/shared/src/coding-agent.ts',
  'apps/desktop/electron/coding-engine.ts',
  'apps/desktop/electron/opencode-http-adapter.ts',
  'apps/desktop/electron/opencode-process.ts',
  'apps/desktop/electron/coding-runtime.ts',
  'apps/desktop/electron/coding-runner.ts',
  'scripts/opencode-smoke.ts',
  'scripts/opencode-smoke-preflight.ts',
  'scripts/opencode-runtime-status.mjs',
]

describe('v0.9 real runtime observability plan', () => {
  it('stays anchored to existing runtime seams and release-safe boundaries', () => {
    const markdown = readFileSync(planPath, 'utf8')

    for (const seam of runtimeSeams) {
      expect(markdown).toContain(`\`${seam}\``)
      expect(existsSync(join(process.cwd(), seam))).toBe(true)
    }

    expect(markdown).toContain('### v0.9.1 Runtime Contract Refresh')
    expect(markdown).toContain('### v0.9.2 Real opencode Runtime Hardening')
    expect(markdown).toContain('### v0.9.3 Runtime Observability')
    expect(markdown).toContain('### v0.9.4 Demo Readiness')
    expect(markdown).toContain('The fake coding engine stays as the default `verify` path')
    expect(markdown).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('Windows Electron smoke')
    expect(markdown).toContain('HoneyAI bridge')
    expect(markdown).toContain('The demo script is not deferred to v1.0')
  })
})
