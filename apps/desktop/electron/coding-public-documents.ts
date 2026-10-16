import https from 'node:https'
import { lookup } from 'node:dns'
import { isIP } from 'node:net'
import { codingDigest } from './coding-candidate-workspace'
import type { CodingNetworkProfile } from './native-coding-profile'

export function isPublicCodingAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number), first = parts[0]!, second = parts[1]!
    return ![0, 10, 127].includes(first) && first < 224 && !(first === 169 && second === 254) && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && (second === 168 || second === 0)) && !(first === 100 && second >= 64 && second <= 127) && !(first === 198 && (second === 18 || second === 19))
  }
  const normalized = address.toLowerCase()
  // Only global unicast IPv6; IPv4-mapped, link-local and ULA are not eligible.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/u.test(normalized)
}
export function codingDocumentUrl(profile: CodingNetworkProfile, input: { url?: string; query?: string }): URL {
  if (input.query && !profile.searchEndpoint) throw new Error('No public-document search endpoint is configured')
  const url = new URL(input.query ? profile.searchEndpoint! : input.url!)
  if (url.protocol !== 'https:' || !profile.allowedOrigins.includes(url.origin) || url.username || url.password || url.hash) throw new Error('Document URL is outside the configured public HTTPS scope')
  const literal = url.hostname.replace(/^\[|\]$/gu, '')
  if (isIP(literal) && !isPublicCodingAddress(literal)) throw new Error('Private document addresses are not permitted')
  if (input.query) url.searchParams.set('q', input.query)
  return url
}
/** GET only; validate the exact DNS address used by the socket, including every redirect. */
export async function fetchCodingDocument(profile: CodingNetworkProfile, url: URL, signal: AbortSignal, search = false, hops = 0): Promise<{ url: string; content: string; digest: string; untrusted: true }> {
  codingDocumentUrl(profile, { url: url.href })
  if (hops > 3) throw new Error('Too many document redirects')
  const response = await new Promise<{ status: number; location?: string; content: string }>((resolve, reject) => {
    const apiKey = search && hops === 0 && profile.apiKeyEnvironment ? process.env[profile.apiKeyEnvironment] : undefined
    const request = https.get(url, { signal, timeout: 20_000, headers: { Accept: 'application/json,text/plain,text/html', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      lookup: (hostname, options, callback) => lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) { callback(error, '', 0); return }
        if (!addresses.length || addresses.some(entry => !isPublicCodingAddress(entry.address))) { callback(new Error('Public-document network cannot access local or private addresses'), '', 0); return }
        if (options.all) callback(null, addresses)
        else callback(null, addresses[0]!.address, addresses[0]!.family)
      }),
    }, message => {
      const chunks: Buffer[] = []; let bytes = 0
      message.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) request.destroy(new Error('Document exceeds 2 MiB')); else chunks.push(chunk) })
      message.on('error', reject)
      message.on('end', () => resolve({ status: message.statusCode ?? 0, ...(message.headers.location ? { location: message.headers.location } : {}), content: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('timeout', () => request.destroy(new Error('Public-document request timed out')))
    request.on('error', reject)
  })
  if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
    const target = new URL(response.location, url)
    if (target.origin !== url.origin) throw new Error(`Redirect requires a separate origin grant: ${target.origin}`)
    return fetchCodingDocument(profile, target, signal, false, hops + 1)
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`Document service returned HTTP ${response.status}`)
  return { url: url.href, content: response.content, digest: codingDigest(response.content), untrusted: true }
}
