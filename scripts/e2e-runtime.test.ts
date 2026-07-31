import { describe, expect, it, vi } from 'vitest'
import { resolveE2eRuntime } from './e2e-runtime.mjs'

describe('E2E runtime isolation', () => {
  it('uses one explicit private port block when requested', async () => {
    const choosePortBase = vi.fn(async () => 49000)

    await expect(
      resolveE2eRuntime({ DEVFLOW_E2E_PORT_BASE: '47000' }, choosePortBase),
    ).resolves.toEqual({
      apiPort: 47000,
      webPort: 47001,
      desktopPort: 47002,
      apiUrl: 'http://127.0.0.1:47000',
      webUrl: 'http://127.0.0.1:47001',
      desktopUrl: 'http://127.0.0.1:47002',
    })
    expect(choosePortBase).not.toHaveBeenCalled()
  })

  it('allocates an isolated port block by default', async () => {
    const choosePortBase = vi.fn(async () => 48000)

    const runtime = await resolveE2eRuntime({}, choosePortBase)

    expect(choosePortBase).toHaveBeenCalledOnce()
    expect(runtime).toMatchObject({
      apiPort: 48000,
      webPort: 48001,
      desktopPort: 48002,
    })
  })

  it('rejects invalid or privileged explicit port bases', async () => {
    await expect(
      resolveE2eRuntime({ DEVFLOW_E2E_PORT_BASE: 'not-a-port' }),
    ).rejects.toThrow(/DEVFLOW_E2E_PORT_BASE/)
    await expect(
      resolveE2eRuntime({ DEVFLOW_E2E_PORT_BASE: '80' }),
    ).rejects.toThrow(/DEVFLOW_E2E_PORT_BASE/)
  })
})
