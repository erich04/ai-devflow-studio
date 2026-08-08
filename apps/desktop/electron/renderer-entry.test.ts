import { describe, expect, it } from 'vitest'
import { resolveDesktopRendererEntry } from './renderer-entry'

describe('Desktop renderer entry', () => {
  it('ignores the development server environment variable in a packaged application', () => {
    expect(
      resolveDesktopRendererEntry({
        isPackaged: true,
        developmentServerUrl: 'http://127.0.0.1:5173/hostile',
      }),
    ).toEqual({ kind: 'file' })
  })
})
