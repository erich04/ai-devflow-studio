import { describe, expect, it, vi } from 'vitest'
import { stopGitHubDelivery } from './github-delivery-stop'

const input = {
  intentId: 'github-delivery-intent-1',
  expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
}

describe('GitHub Delivery Stop coordination', () => {
  it('persists the exact CAS before aborting only its active operation', async () => {
    const order: string[] = []
    const abort = vi.fn(() => order.push('abort'))
    const stopIntent = vi.fn(async () => {
      order.push('store')
      return {
        committed: true as const,
        replayed: false,
        intent: {},
        outcome: {},
      }
    })

    await expect(stopGitHubDelivery({
      input,
      updatedAt: '2026-08-11T12:35:00.000Z',
      stopIntent,
      getActiveOperation: () => ({
        intentId: input.intentId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        abort,
      }),
    })).resolves.toEqual({
      intentId: input.intentId,
      disposition: 'stopped',
      outcomeCode: 'operation_cancelled',
    })
    expect(order).toEqual(['store', 'abort'])
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('never aborts an unrelated operation after a successful Stop CAS', async () => {
    const abort = vi.fn()

    await expect(stopGitHubDelivery({
      input,
      updatedAt: '2026-08-11T12:35:00.000Z',
      stopIntent: async () => ({
        committed: true as const,
        replayed: false,
        intent: {},
        outcome: {},
      }),
      getActiveOperation: () => ({
        intentId: 'github-delivery-intent-2',
        expectedUpdatedAt: input.expectedUpdatedAt,
        abort,
      }),
    })).resolves.toMatchObject({ disposition: 'stopped' })
    expect(abort).not.toHaveBeenCalled()
  })

  it.each([
    ['intent_not_found', 'intent_not_found'],
    ['source_stale', 'stale_intent'],
  ] as const)(
    'maps %s to a closed local conflict and does not abort',
    async (reason, outcomeCode) => {
      const abort = vi.fn()
      await expect(stopGitHubDelivery({
        input,
        updatedAt: '2026-08-11T12:35:00.000Z',
        stopIntent: async () => ({ committed: false as const, reason }),
        getActiveOperation: () => ({ ...input, abort }),
      })).resolves.toEqual({
        intentId: input.intentId,
        disposition: 'local_conflict',
        outcomeCode,
      })
      expect(abort).not.toHaveBeenCalled()
    },
  )

  it('maps a terminal intent without aborting', async () => {
    const abort = vi.fn()
    await expect(stopGitHubDelivery({
      input,
      updatedAt: '2026-08-11T12:35:00.000Z',
      stopIntent: async () => ({
        committed: false as const,
        reason: 'intent_terminal' as const,
      }),
      getActiveOperation: () => ({ ...input, abort }),
    })).resolves.toEqual({
      intentId: input.intentId,
      disposition: 'already_terminal',
      outcomeCode: 'intent_terminal',
    })
    expect(abort).not.toHaveBeenCalled()
  })

  it('closes an unknown storage failure without exposing its raw message or aborting', async () => {
    const abort = vi.fn()
    const result = await stopGitHubDelivery({
      input,
      updatedAt: '2026-08-11T12:35:00.000Z',
      stopIntent: async () => {
        throw new Error('TOKEN=secret /Users/alice/devflow.sqlite')
      },
      getActiveOperation: () => ({ ...input, abort }),
    })

    expect(result).toEqual({
      intentId: input.intentId,
      disposition: 'local_conflict',
      outcomeCode: 'stop_unavailable',
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|Users|sqlite/i)
    expect(abort).not.toHaveBeenCalled()
  })
})
