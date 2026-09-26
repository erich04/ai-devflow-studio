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

    expect(markdown).toContain('### v0.9.1 运行时契约复核')
    expect(markdown).toContain('### v0.9.2 真实 OpenCode 运行时加固')
    expect(markdown).toContain('### v0.9.3 运行时可观察性')
    expect(markdown).toContain('### v0.9.4 演示准备')
    expect(markdown).toContain('模拟编码引擎仍是默认 `verify` 路径')
    expect(markdown).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('Windows Electron 冒烟')
    expect(markdown).toContain('HoneyAI 桥接')
    expect(markdown).toContain('演示脚本不延后到 v1.0')
    expect(markdown).toContain('真实 OpenCode token/费用遥测')
  })
})
