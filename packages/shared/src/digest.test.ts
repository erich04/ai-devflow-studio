import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Text } from './digest'
import { sha256Text as clarificationSha256Text } from './clarification'

describe('sha256Text', () => {
  it('returns the lowercase hex SHA-256 of the UTF-8 text', async () => {
    const value = '需求 v1\nline two'
    expect(await sha256Text(value)).toBe(createHash('sha256').update(value, 'utf8').digest('hex'))
    expect(await sha256Text('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('stays available from clarification for existing importers', () => {
    expect(clarificationSha256Text).toBe(sha256Text)
  })
})
