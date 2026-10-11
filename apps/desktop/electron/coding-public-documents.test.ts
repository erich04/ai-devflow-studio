// @vitest-environment node
import { expect, it } from 'vitest'
import { codingDocumentUrl, isPublicCodingAddress } from './coding-public-documents'
it('constrains public-document requests to configured origins and excludes private targets', () => {
  const profile = { allowedOrigins: ['https://docs.example.com'], searchEndpoint: 'https://docs.example.com/search' }
  expect(codingDocumentUrl(profile, { query: 'function(a,b)' }).searchParams.get('q')).toBe('function(a,b)')
  expect(() => codingDocumentUrl(profile, { url: 'https://other.example.com/' })).toThrow()
  expect(() => codingDocumentUrl({ allowedOrigins: ['https://127.0.0.1'] }, { url: 'https://127.0.0.1/' })).toThrow()
  for (const address of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.4.2', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1']) expect(isPublicCodingAddress(address), address).toBe(false)
  expect(isPublicCodingAddress('8.8.8.8')).toBe(true)
})
