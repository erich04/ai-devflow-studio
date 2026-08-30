import { describe, expect, it, vi } from 'vitest'
import { detectCodingRuntimeEngines } from './opencode-discovery.js'

describe('OpenCode Coding Engine discovery', () => {
  it('reports a compatible binary without selecting it automatically', async () => {
    const resolveExecutable = vi.fn().mockResolvedValue('/opt/devflow/bin/opencode')
    const readVersion = vi.fn().mockResolvedValue('1.2.3\n')

    await expect(detectCodingRuntimeEngines({
      projectId: 'local-1',
      env: { PATH: '/opt/devflow/bin' },
      deps: {
        resolveExecutable,
        readVersion,
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })).resolves.toEqual({
      projectId: 'local-1',
      candidates: [{
        engine: 'opencode-http',
        executor: 'opencode-http',
        status: 'available',
        binaryPath: '/opt/devflow/bin/opencode',
        version: '1.2.3',
        requiresConfirmation: true,
        reason: '已检测到本机 OpenCode。确认后才会把它用于当前项目。',
      }],
      detectedAt: '2026-08-30T18:00:00.000Z',
    })
    expect(readVersion).toHaveBeenCalledWith('/opt/devflow/bin/opencode', { PATH: '/opt/devflow/bin' })
  })

  it('fails closed when no binary is found', async () => {
    const readVersion = vi.fn()
    const discovery = await detectCodingRuntimeEngines({
      projectId: 'local-1',
      deps: {
        resolveExecutable: async () => null,
        readVersion,
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })

    expect(discovery.candidates[0]).toMatchObject({
      status: 'unavailable',
      requiresConfirmation: true,
    })
    expect(readVersion).not.toHaveBeenCalled()
  })

  it('does not expose an invalid version response as an available engine', async () => {
    const discovery = await detectCodingRuntimeEngines({
      projectId: 'local-1',
      deps: {
        resolveExecutable: async () => '/opt/devflow/bin/opencode',
        readVersion: async () => 'token=secret\nsecond-line',
        now: () => '2026-08-30T18:00:00.000Z',
      },
    })

    expect(discovery.candidates[0]).toEqual({
      engine: 'opencode-http',
      executor: 'opencode-http',
      status: 'unavailable',
      requiresConfirmation: true,
      reason: 'OpenCode 存在但兼容性检查失败；不会启动或修改仓库。',
    })
  })
})
