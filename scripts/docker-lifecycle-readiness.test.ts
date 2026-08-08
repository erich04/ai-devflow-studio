import { describe, expect, it, vi } from 'vitest'

import {
  isFinalPostgresReady,
  waitForFinalPostgresReadiness,
} from './docker-lifecycle-readiness.mjs'

describe('Docker lifecycle Postgres readiness', () => {
  it('waits past the temporary healthy server until the final Postgres process owns PID 1', async () => {
    const observations = [
      { healthStatus: 'starting', initProcessName: 'bash', liveProbeReady: false },
      { healthStatus: 'healthy', initProcessName: 'bash', liveProbeReady: false },
      { healthStatus: 'healthy', initProcessName: 'postgres', liveProbeReady: false },
      { healthStatus: 'healthy', initProcessName: 'postgres', liveProbeReady: true },
    ]
    const readObservation = vi.fn(async () =>
      observations.shift() ?? {
        healthStatus: 'healthy',
        initProcessName: 'postgres',
        liveProbeReady: true,
      },
    )
    const delay = vi.fn(async () => undefined)

    await expect(
      waitForFinalPostgresReadiness({
        readObservation,
        delay,
        maxAttempts: 4,
      }),
    ).resolves.toEqual({
      healthStatus: 'healthy',
      initProcessName: 'postgres',
      liveProbeReady: true,
    })

    expect(readObservation).toHaveBeenCalledTimes(4)
    expect(delay).toHaveBeenCalledTimes(3)
  })

  it('requires both a healthy check and the final Postgres PID 1 process', () => {
    expect(
      isFinalPostgresReady({
        healthStatus: 'healthy',
        initProcessName: 'bash',
        liveProbeReady: true,
      }),
    ).toBe(false)
    expect(
      isFinalPostgresReady({
        healthStatus: 'starting',
        initProcessName: 'postgres',
        liveProbeReady: true,
      }),
    ).toBe(false)
    expect(
      isFinalPostgresReady({
        healthStatus: 'healthy',
        initProcessName: 'postgres',
        liveProbeReady: false,
      }),
    ).toBe(false)
    expect(
      isFinalPostgresReady({
        healthStatus: 'healthy',
        initProcessName: 'postgres',
        liveProbeReady: true,
      }),
    ).toBe(true)
  })

  it('fails with bounded readiness diagnostics', async () => {
    const readObservation = vi.fn(async () => ({
      healthStatus: 'healthy',
      initProcessName: 'bash',
      liveProbeReady: false,
    }))
    const delay = vi.fn(async () => undefined)

    await expect(
      waitForFinalPostgresReadiness({
        readObservation,
        delay,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(
      'Timed out waiting for final lifecycle Postgres readiness (health=healthy, pid1=bash, liveProbe=false).',
    )

    expect(readObservation).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledTimes(1)
  })
})
