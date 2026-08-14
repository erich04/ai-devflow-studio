import { describe, expect, it, vi } from 'vitest'
import {
  isRetryableDockerBuildInfrastructureFailure,
  runDockerComposeBuildWithInfrastructureRetry,
} from './docker-smoke-infrastructure'

const buildkitTransportFailure = new Error(
  'target web: failed to receive status: rpc error: code = Unavailable desc = error reading from server: EOF',
)

describe('Docker smoke infrastructure retry', () => {
  it('recognizes only the exact BuildKit unavailable EOF transport failure', () => {
    expect(isRetryableDockerBuildInfrastructureFailure(buildkitTransportFailure)).toBe(true)
    expect(
      isRetryableDockerBuildInfrastructureFailure(
        new Error('target web: failed to receive status: rpc error: code = Unknown desc = EOF'),
      ),
    ).toBe(false)
    expect(isRetryableDockerBuildInfrastructureFailure(new Error('API readiness failed'))).toBe(
      false,
    )
    expect(isRetryableDockerBuildInfrastructureFailure('not an Error')).toBe(false)
  })

  it('cleans the exact project before one infrastructure retry', async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(buildkitTransportFailure)
      .mockResolvedValueOnce('passed')
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue()
    const reportRetry = vi.fn<(message: string) => void>()

    await expect(
      runDockerComposeBuildWithInfrastructureRetry({ run, cleanup, reportRetry }),
    ).resolves.toBe('passed')

    expect(run).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(reportRetry).toHaveBeenCalledTimes(1)
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(cleanup.mock.invocationCallOrder[0])
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[1])
  })

  it('does not retry a product or assertion failure', async () => {
    const productFailure = new Error('Docker Web hashed static asset was unavailable.')
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(productFailure)
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue()

    await expect(
      runDockerComposeBuildWithInfrastructureRetry({ run, cleanup }),
    ).rejects.toBe(productFailure)
    expect(run).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('fails after the single bounded retry', async () => {
    const secondFailure = new Error(buildkitTransportFailure.message)
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(buildkitTransportFailure)
      .mockRejectedValueOnce(secondFailure)
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue()
    const reportRetry = vi.fn<(message: string) => void>()

    await expect(
      runDockerComposeBuildWithInfrastructureRetry({ run, cleanup, reportRetry }),
    ).rejects.toBe(secondFailure)
    expect(run).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(reportRetry).toHaveBeenCalledTimes(1)
  })
})
