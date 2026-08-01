import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('Web health probe', () => {
  it('reports process liveness without checking dependencies', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: '@ai-devflow/web',
    })
  })
})
