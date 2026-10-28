import { lookup } from 'node:dns/promises'
import { request, type RequestOptions } from 'node:https'

export type PublicDocumentAddress = { address: string; family: number }
export type PublicDocumentResponse = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array>
  close(): void
}
export type PublicDocumentRequest = (input: {
  url: URL; address: PublicDocumentAddress; signal: AbortSignal
}) => Promise<PublicDocumentResponse>
export type PublicDocumentResult = {
  sourceUrl: string; finalUrl: string; redirects: number; contentType: string; bytes: number
  dnsResolution: 'system' | 'trusted-public-dns'
  text: string; truncated: boolean; trust: 'untrusted-public-reference'
}

/** Self-contained: this factory is also emitted into the private OpenCode plugin. */
export function createPinnedDocumentRequest(httpsRequest: typeof request, accept = 'text/plain, text/markdown, text/html'): PublicDocumentRequest {
  return ({ url, address, signal }) => new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      method: 'GET', agent: false, servername: url.hostname, rejectUnauthorized: true, maxHeaderSize: 16_384, family: address.family, autoSelectFamily: false,
      // No proxy, cookies or provider credentials; no implicit DNS retry or redirect.
      headers: { accept, 'accept-encoding': 'identity', 'user-agent': 'DevFlow-Document-Reader/1' },
      signal,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address])
        else callback(null, address.address, address.family)
      },
    }
    const req = httpsRequest(url, options, (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response, close: () => response.destroy() }))
    req.once('error', () => reject(new Error(signal.aborted ? 'document_aborted' : 'document_transport_failed')))
    req.end()
  })
}

/**
 * A small official-document allowlist, not a general browser or search engine.
 * Keep all runtime dependencies inside this function so the packaged plugin can
 * use the same tested policy without reading the application source checkout.
 */
export function createPublicDocumentReader(deps: {
  lookup(hostname: string): Promise<PublicDocumentAddress[]>
  request: PublicDocumentRequest
  /** Fixed public DNS transport, used only after the document target allowlist. */
  dnsRequest?: PublicDocumentRequest
}) {
  const documents: Record<string, string[]> = {
    'nodejs.org': ['/api', '/docs'],
    'developer.mozilla.org': ['/en-US/docs', '/zh-CN/docs'],
    'www.typescriptlang.org': ['/docs'], 'typescriptlang.org': ['/docs'],
    'react.dev': ['/learn', '/reference'],
    'vite.dev': ['/guide', '/config'], 'vitest.dev': ['/guide', '/api', '/config'],
    'playwright.dev': ['/docs'], 'www.electronjs.org': ['/docs'],
    'docs.python.org': ['/3'], 'pnpm.io': ['/cli', '/settings', '/workspaces', '/package_json', '/npmrc'],
  }
  const fail = (code: string): never => { throw new Error(`document_${code}`) }
  const target = (raw: string): URL => {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\x00-\x20\\]/u.test(raw)) return fail('target_denied')
    let url: URL
    try { url = new URL(raw) } catch { return fail('target_denied') }
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search ||
      /%(?:2f|5c|00|25)/iu.test(url.pathname) ||
      !Object.hasOwn(documents, url.hostname) || !documents[url.hostname]?.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return fail('target_denied')
    url.hash = ''
    return url
  }
  const publicAddress = ({ address, family }: PublicDocumentAddress) => {
    if (family === 4) {
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(address)) return false
      const octets = address.split('.').map(Number)
      if (octets.some((value) => value > 255)) return false
      const [a, b, c] = octets as [number, number, number, number]
      return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
    }
    // Only global unicast IPv6, excluding transition, benchmark and documentation
    // ranges. This also excludes mapped IPv4, loopback, link-local and unique-local.
    if (family !== 6 || !/^[0-9a-f:]+$/iu.test(address)) return false
    const halves = address.toLowerCase().split('::')
    if (halves.length > 2) return false
    const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : []
    const parts = halves.length === 1 ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return false
    const first = parseInt(parts[0]!, 16), second = parseInt(parts[1]!, 16)
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x0200 || second === 0x0db8)) && !(first === 0x3fff && second < 0x1000)
  }
  const bounded = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
    signal.throwIfAborted()
    let abort!: () => void
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        abort = () => reject(new Error('document_aborted'))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })])
    } finally { signal.removeEventListener('abort', abort) }
  }
  const trustedLookup = async (hostname: string, callerSignal: AbortSignal): Promise<PublicDocumentAddress[]> => {
    if (!deps.dnsRequest || !Object.hasOwn(documents, hostname)) return fail('address_denied')
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(5_000)])
    // The resolver URL, address, query type and media type are application-owned.
    // Only the already-allowed hostname leaves the app, never the document path.
    const url = new URL(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`)
    const response = await bounded(deps.dnsRequest({ url, address: { address: '1.1.1.1', family: 4 }, signal }), signal)
    try {
      const contentType = response.headers['content-type'], length = response.headers['content-length'], encoding = response.headers['content-encoding']
      if (response.status !== 200 || typeof contentType !== 'string' || contentType.split(';')[0]?.trim().toLowerCase() !== 'application/dns-json' ||
        (encoding !== undefined && encoding !== 'identity') ||
        (length !== undefined && (typeof length !== 'string' || !/^\d+$/u.test(length) || Number(length) > 16_384))) return fail('dns_response_denied')
      let bytes = 0, text = ''
      const decoder = new TextDecoder('utf-8', { fatal: true }), chunks = response.body[Symbol.asyncIterator]()
      for (;;) {
        const item = await bounded(chunks.next(), signal)
        if (item.done) break
        bytes += item.value.byteLength
        if (bytes > 16_384) return fail('dns_response_denied')
        try { text += decoder.decode(item.value, { stream: true }) } catch { return fail('dns_response_denied') }
      }
      let data: unknown
      try { text += decoder.decode(); data = JSON.parse(text) } catch { return fail('dns_response_denied') }
      const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
      const sameName = (value: unknown) => value === hostname || value === `${hostname}.`
      if (!record(data) || data.Status !== 0 || data.TC !== false || !Array.isArray(data.Question) || data.Question.length !== 1 ||
        !record(data.Question[0]) || !sameName(data.Question[0].name) || data.Question[0].type !== 1 ||
        !Array.isArray(data.Answer) || data.Answer.length === 0 || data.Answer.length > 32) return fail('dns_response_denied')
      const addresses = data.Answer.map((answer: unknown) => {
        // Do not follow CNAMEs or accept unrelated additional records. TLS still
        // verifies the original approved documentation hostname at connection.
        if (!record(answer) || !sameName(answer.name) || answer.type !== 1 || typeof answer.data !== 'string') return fail('dns_response_denied')
        return { address: answer.data, family: 4 }
      })
      if (!addresses.every(publicAddress)) return fail('address_denied')
      signal.throwIfAborted()
      return addresses
    } finally { response.close() }
  }
  const plainText = (text: string, html: boolean) => {
    if (!html) return text
    // Linear scanning keeps malformed HTML from causing quadratic tag-regex work.
    const lower = text.toLowerCase(), output: string[] = []
    let cursor = 0
    while (cursor < text.length) {
      const open = text.indexOf('<', cursor)
      if (open < 0) { output.push(text.slice(cursor)); break }
      output.push(text.slice(cursor, open))
      if (text.startsWith('<!--', open)) {
        const close = text.indexOf('-->', open + 4)
        if (close < 0) break
        cursor = close + 3; continue
      }
      const end = text.indexOf('>', open + 1)
      if (end < 0) break
      const tag = /^<\s*(\/?)\s*([a-z][\w:-]*)/iu.exec(text.slice(open, end + 1))
      cursor = end + 1
      if (!tag) continue
      const name = tag[2]!.toLowerCase()
      if (!tag[1] && ['script', 'style', 'template', 'svg', 'iframe'].includes(name)) {
        const closing = lower.indexOf(`</${name}`, cursor)
        if (closing < 0) break
        const closingEnd = text.indexOf('>', closing)
        if (closingEnd < 0) break
        cursor = closingEnd + 1
      } else if (name === 'br' || (tag[1] && ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'tr'].includes(name))) output.push('\n')
    }
    return output.join('')
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]{1,6}|\d{1,7});/giu, (entity) => {
        const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }
        if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()]!
        const hex = entity[2]?.toLowerCase() === 'x', code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
      }).replace(/[ \t]+/gu, ' ').replace(/\n\s*\n(?:\s*\n)*/gu, '\n\n').trim()
  }
  return async ({ url: raw, signal: callerSignal }: { url: string; signal: AbortSignal }): Promise<PublicDocumentResult> => {
    let url = target(raw)
    const sourceUrl = url.href
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const signal = AbortSignal.any([callerSignal, controller.signal])
    let dnsResolution: PublicDocumentResult['dnsResolution'] = 'system'
    try {
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted()
        let addresses: PublicDocumentAddress[] = []
        try { addresses = await bounded(deps.lookup(url.hostname), AbortSignal.any([signal, AbortSignal.timeout(3_000)])) }
        catch { signal.throwIfAborted() }
        if (!addresses.length || addresses.length > 32 || !addresses.every(publicAddress)) {
          addresses = await trustedLookup(url.hostname, signal)
          dnsResolution = 'trusted-public-dns'
        }
        signal.throwIfAborted()
        const response = await bounded(deps.request({ url, address: addresses[0]!, signal }), signal)
        try {
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (redirects >= 3) fail('redirect_limit')
            const location = response.headers.location
            if (typeof location !== 'string' || location.length > 2048) fail('target_denied')
            let resolved: string
            try { resolved = new URL(location as string, url).href } catch { return fail('target_denied') }
            url = target(resolved)
            continue
          }
          const header = response.headers['content-type']
          const contentType = typeof header === 'string' ? header.split(';')[0]!.trim().toLowerCase() : ''
          const declared = response.headers['content-length'], encoding = response.headers['content-encoding']
          if (response.status !== 200 || !['text/plain', 'text/markdown', 'text/html', 'application/xhtml+xml'].includes(contentType) ||
            (encoding !== undefined && encoding !== 'identity') ||
            (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/u.test(declared) || Number(declared) > 524_288))) fail('response_denied')
          let bytes = 0, text = ''
          const decoder = new TextDecoder('utf-8', { fatal: true }), chunks = response.body[Symbol.asyncIterator]()
          for (;;) {
            const item = await bounded(chunks.next(), signal)
            if (item.done) break
            bytes += item.value.byteLength
            if (bytes > 524_288) fail('response_too_large')
            try { text += decoder.decode(item.value, { stream: true }) } catch { fail('encoding_invalid') }
          }
          try { text += decoder.decode() } catch { fail('encoding_invalid') }
          signal.throwIfAborted()
          text = plainText(text, contentType.includes('html'))
          return { sourceUrl, finalUrl: url.href, redirects, contentType, bytes, dnsResolution, text: text.slice(0, 32_000), truncated: text.length > 32_000, trust: 'untrusted-public-reference' }
        } finally { response.close() }
      }
    } finally { clearTimeout(timer) }
  }
}

export const readPublicDocument = createPublicDocumentReader({
  lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }), request: createPinnedDocumentRequest(request),
  dnsRequest: createPinnedDocumentRequest(request, 'application/dns-json'),
})
