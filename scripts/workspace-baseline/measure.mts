import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

export type RegionSpec = string | { selector: string; pick?: 'first' | 'first-visible-child' }

export interface MeasureOptions {
  /** Root whose visible text nodes are used for the font-size statistics. */
  fontRoot?: string
  /** Named selectors whose first rendered match is reported as a box. */
  regions?: Record<string, RegionSpec>
  /** Named containers; the number of visible controls inside each is reported. */
  controlScopes?: Record<string, string>
  /** Phrases counted in visible text across the whole page. */
  phrases?: string[]
  /** Elements checked for clipped text (for example stage labels). */
  truncationSelector?: string
}

interface Box {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export interface Measurement {
  viewport: { width: number; height: number }
  devicePixelRatio: number
  page: {
    scrollWidth: number
    scrollHeight: number
    horizontalOverflow: boolean
    verticalOverflow: boolean
    bodyOverflow: string
  }
  controls: {
    count: number
    byScope: Record<string, number>
    items: Array<{ tag: string; role?: string; name: string; disabled: boolean; box: Box }>
  }
  fonts: {
    root: string
    distinct: number
    min: number | null
    sizes: number[]
    textNodesBySize: Record<string, number>
  }
  regions: Record<string, { found: boolean; matches: number; box?: Box }>
  phrases: Record<string, number>
  truncation: Array<{ text: string; truncated: boolean }>
}

let cachedSource: string | undefined

async function inPageSource(): Promise<string> {
  cachedSource ??= (await readFile(path.join(here, 'measure-in-page.js'), 'utf8')).trim()
  return cachedSource
}

/** Measures the current page without interacting with it. */
export async function measurePage(page: Page, options: MeasureOptions): Promise<Measurement> {
  // Drop the leading comment lines and the defensive `;` before the arrow function.
  const source = (await inPageSource()).replace(/^(?:\s*\/\/[^\n]*\n)*\s*;?/, '')
  return page.evaluate(`(${source})(${JSON.stringify(options)})`) as Promise<Measurement>
}
