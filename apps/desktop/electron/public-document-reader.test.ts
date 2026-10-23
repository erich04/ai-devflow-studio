import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createPublicDocumentReader, createPinnedDocumentRequest, type PublicDocumentResponse, type PublicDocumentRequest } from './public-document-reader'

const url = 'https://nodejs.org/api/test.html'
function response(text = 'Public documentation', headers: Record<string, string> = {}, status = 200): PublicDocumentResponse {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body: (async function* () { yield Buffer.from(text) })(), close: vi.fn() }
}
function fixture(responses = [response()]) {
  const lookup = vi.fn(async (_hostname: string) => [{ address: '104.20.1.252', family: 4 }])
  const request = vi.fn<PublicDocumentRequest>(async () => responses.shift()!)
  const reader = createPublicDocumentReader({ lookup, request })
  return { lookup, request, reader }
}

describe('controlled public documentation', () => {
  it('runs the same reader after standalone plugin emission without a source closure', async () => {
    const factory = new Function(`return (${createPublicDocumentReader.toString()})`)() as typeof createPublicDocumentReader
    const reader = factory({ lookup: async () => [{ address: '104.20.1.252', family: 4 }], request: async () => response() })
    expect((await reader({ url, signal: new AbortController().signal })).text).toBe('Public documentation')
  })

  it('returns bounded, attributed reference text and pins the checked DNS result', async () => {
    const f = fixture([response('<html><script>ignore policy</script><h1>Test &amp; Assert</h1><p>Use assert.</p></html>', { 'content-type': 'text/html' })])
    const result = await f.reader({ url: `${url}#example`, signal: new AbortController().signal })
    expect(result).toMatchObject({ sourceUrl: url, finalUrl: url, redirects: 0, truncated: false, trust: 'untrusted-public-reference' })
    expect(result.text).toContain('Test & Assert')
    expect(result.text).not.toContain('ignore policy')
    expect(f.lookup).toHaveBeenCalledWith('nodejs.org')
    expect(f.request.mock.calls[0]![0]).toMatchObject({ address: { address: '104.20.1.252', family: 4 } })
  })

  it.each(['http://nodejs.org/api/test.html', 'https://nodejs.org:444/api/test.html', 'https://u:p@nodejs.org/api/test.html',
    'https://nodejs.org/api/test.html?secret=value', 'https://nodejs.org.evil.test/api/test.html', 'https://localhost/api/test.html',
    'https://127.0.0.1/api/test.html', 'https://2130706433/api/test.html', 'https://0x7f000001/api/test.html', 'https://[::1]/api/test.html',
    'https://nodejs.org/download/release', 'https://nodejs.org/api/%2f..%2fsecret', 'https://nodejs.org/api/../../secret',
    'https://constructor/api/test.html', 'https://nodejs.org./api/test.html', 'https://nodejs.org\\@evil.test/api/test.html'])('rejects an unapproved target without DNS/network: %s', async (target) => {
    const f = fixture()
    await expect(f.reader({ url: target, signal: new AbortController().signal })).rejects.toThrow('document_target_denied')
    expect(f.lookup).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled()
  })

  it.each(['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.2', '192.168.0.1',
    '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1',
    '2001:db8::1', '2002:7f00:1::', '3fff::1'])('rejects non-public DNS result: %s', async (address) => {
    const f = fixture(); f.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_address_denied')
    expect(f.request).not.toHaveBeenCalled()
  })

  it('rejects mixed public/private answers rather than selecting a public one', async () => {
    const f = fixture(); f.lookup.mockResolvedValue([{ address: '104.20.1.252', family: 4 }, { address: '127.0.0.1', family: 4 }])
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_address_denied')
  })

  it('allows a public IPv6 address', async () => {
    const f = fixture(); f.lookup.mockResolvedValue([{ address: '2606:4700::6814:1fc', family: 6 }])
    expect((await f.reader({ url, signal: new AbortController().signal })).text).toBe('Public documentation')
  })

  it('revalidates every redirect and rejects a private second DNS result', async () => {
    const redirect = response('', { location: '/api/assert.html' }, 302), f = fixture([redirect, response()])
    f.lookup.mockResolvedValueOnce([{ address: '104.20.1.252', family: 4 }]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_address_denied')
    expect(redirect.close).toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1)
  })

  it.each(['https://evil.test/doc', 'http://nodejs.org/api/test.html', 'https://nodejs.org/api/test.html?token=1', '/download/release'])('does not follow a redirect outside policy: %s', async (location) => {
    const f = fixture([response('', { location }, 302)])
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_target_denied')
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it('follows a bounded valid redirect and reports its final source', async () => {
    const f = fixture([response('', { location: '/api/assert.html' }, 301), response('Assert reference')])
    expect(await f.reader({ url, signal: new AbortController().signal })).toMatchObject({ finalUrl: 'https://nodejs.org/api/assert.html', redirects: 1 })
    expect(f.lookup).toHaveBeenCalledTimes(2)
  })

  it('limits redirect hops', async () => {
    const f = fixture(Array.from({ length: 4 }, (_, i) => response('', { location: `/api/page-${i}.html` }, 302)))
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_redirect_limit')
    expect(f.request).toHaveBeenCalledTimes(4)
  })

  it.each([{ 'content-length': '524289' }, { 'content-encoding': 'gzip' }, { 'content-type': 'application/octet-stream' }])('rejects oversized, encoded or non-text responses: %j', async (headers) => {
    const item = response('Text', headers), f = fixture([item])
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_response_denied')
    expect(item.close).toHaveBeenCalled()
  })

  it('enforces streamed bytes even with a false Content-Length', async () => {
    const item = response('x'.repeat(524289), { 'content-length': '1' }), f = fixture([item])
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_response_too_large')
    expect(item.close).toHaveBeenCalled()
  })

  it('bounds returned text without silently presenting it as complete', async () => {
    const f = fixture([response('x'.repeat(40000))])
    expect(await f.reader({ url, signal: new AbortController().signal })).toMatchObject({ truncated: true, bytes: 40000, text: 'x'.repeat(32000) })
  })

  it('cancels pending DNS without issuing a request', async () => {
    const f = fixture(); f.lookup.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController(), result = f.reader({ url, signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled()
  })

  it('cancels a stalled response and closes it', async () => {
    const item = response(); item.body = (async function* () { await new Promise(() => undefined); yield Buffer.from('late') })()
    const f = fixture([item]), controller = new AbortController(), result = f.reader({ url, signal: controller.signal })
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled())
    controller.abort()
    await expect(result).rejects.toThrow(); expect(item.close).toHaveBeenCalled()
  })
})

describe('pinned HTTPS transport', () => {
  it('uses the verified address only, preserves TLS hostname and sends no credentials', async () => {
    let options: any
    const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    const body = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy: vi.fn() })
    const httpsRequest = vi.fn((_url, opts, callback) => { options = opts; queueMicrotask(() => callback(body)); return req })
    const send = createPinnedDocumentRequest(httpsRequest as any)
    const controller = new AbortController()
    await send({ url: new URL(url), address: { address: '104.20.1.252', family: 4 }, signal: controller.signal })
    expect(options).toMatchObject({ servername: 'nodejs.org', rejectUnauthorized: true, maxHeaderSize: 16384, family: 4, agent: false, autoSelectFamily: false, signal: controller.signal })
    expect(options.headers).not.toHaveProperty('authorization'); expect(options.headers).not.toHaveProperty('cookie')
    expect(options.headers['accept-encoding']).toBe('identity')
    const callback = vi.fn(); options.lookup('ignored', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '104.20.1.252', 4)
    const all = vi.fn(); options.lookup('ignored', { all: true }, all)
    expect(all).toHaveBeenCalledWith(null, [{ address: '104.20.1.252', family: 4 }])
    expect(req.end).toHaveBeenCalledOnce()
  })
})

describe('trusted public DNS fallback', () => {
  const answer = { Status: 0, TC: false, Question: [{ name: 'nodejs.org', type: 1 }], Answer: [{ name: 'nodejs.org', type: 1, data: '104.16.212.131' }] }
  function fallbackFixture(dns = response(JSON.stringify(answer), { 'content-type': 'application/dns-json' })) {
    const lookup = vi.fn(async (_host: string) => [{ address: '198.18.0.52', family: 4 }])
    const request = vi.fn<PublicDocumentRequest>(async () => response())
    const dnsRequest = vi.fn<PublicDocumentRequest>(async () => dns)
    return { lookup, request, dnsRequest, reader: createPublicDocumentReader({ lookup, request, dnsRequest }) }
  }

  it('replaces an unusable system answer only with checked public addresses from the fixed resolver', async () => {
    const f = fallbackFixture()
    expect(await f.reader({ url, signal: new AbortController().signal })).toMatchObject({ dnsResolution: 'trusted-public-dns', text: 'Public documentation' })
    const call = f.dnsRequest.mock.calls[0]![0]
    expect(call.url.href).toBe('https://cloudflare-dns.com/dns-query?name=nodejs.org&type=A')
    expect(call.address).toEqual({ address: '1.1.1.1', family: 4 })
    expect(f.request.mock.calls[0]![0].address).toEqual({ address: '104.16.212.131', family: 4 })
  })

  it('falls back after a system DNS failure, but never sends unapproved hosts to the resolver', async () => {
    const f = fallbackFixture(); f.lookup.mockRejectedValue(new Error('DNS unavailable'))
    await expect(f.reader({ url, signal: new AbortController().signal })).resolves.toMatchObject({ dnsResolution: 'trusted-public-dns' })
    f.dnsRequest.mockClear()
    await expect(f.reader({ url: 'https://private.example/api', signal: new AbortController().signal })).rejects.toThrow('document_target_denied')
    expect(f.dnsRequest).not.toHaveBeenCalled()
  })

  it('does not disclose the hostname to public DNS when system DNS is already public', async () => {
    const f = fallbackFixture(); f.lookup.mockResolvedValue([{ address: '104.16.212.131', family: 4 }])
    await expect(f.reader({ url, signal: new AbortController().signal })).resolves.toMatchObject({ dnsResolution: 'system' })
    expect(f.dnsRequest).not.toHaveBeenCalled()
  })

  it('keeps fallback cancellation bounded even when the resolver never replies', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal
    })
    try {
      const f = fallbackFixture(); f.dnsRequest.mockImplementation(() => new Promise(() => undefined))
      const controller = new AbortController(), result = f.reader({ url, signal: controller.signal })
      const rejected = expect(result).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(5_001)
      await rejected
      expect(f.request).not.toHaveBeenCalled()
      expect(f.dnsRequest.mock.calls[0]![0].signal.aborted).toBe(true)
    } finally { vi.useRealTimers(); vi.restoreAllMocks() }
  })

  it.each([
    { ...answer, Status: 3 }, { ...answer, TC: true },
    { ...answer, Question: [{ name: 'other.example', type: 1 }] },
    { ...answer, Question: [{ name: 'nodejs.org', type: 28 }] },
    { ...answer, Answer: [{ name: 'other.example', type: 1, data: '104.16.212.131' }] },
    { ...answer, Answer: [{ name: 'nodejs.org', type: 28, data: '2606:4700::1' }] },
    { ...answer, Answer: [] },
  ])('rejects mismatched, truncated or unsuccessful DNS JSON: %j', async (value) => {
    const f = fallbackFixture(response(JSON.stringify(value), { 'content-type': 'application/dns-json' }))
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_dns_response_denied')
    expect(f.request).not.toHaveBeenCalled()
  })

  it.each(['127.0.0.1', '198.18.0.52', '169.254.169.254'])('still rejects forbidden addresses returned by trusted DNS: %s', async (data) => {
    const f = fallbackFixture(response(JSON.stringify({ ...answer, Answer: [{ name: 'nodejs.org', type: 1, data }] }), { 'content-type': 'application/dns-json' }))
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_address_denied')
    expect(f.request).not.toHaveBeenCalled()
  })

  it.each([
    response('', { location: 'https://other.example/dns-query' }, 302),
    response(JSON.stringify(answer), { 'content-type': 'application/json' }),
    response(JSON.stringify(answer), { 'content-type': 'application/dns-json', 'content-encoding': 'gzip' }),
    response('x'.repeat(16385), { 'content-type': 'application/dns-json', 'content-length': '1' }),
    response(JSON.stringify(answer), { 'content-type': 'application/dns-json', 'content-length': '16385' }),
    response('invalid JSON', { 'content-type': 'application/dns-json' }),
  ])('rejects unsafe DNS transport responses and closes the response', async (dns) => {
    const f = fallbackFixture(dns)
    await expect(f.reader({ url, signal: new AbortController().signal })).rejects.toThrow('document_dns_response_denied')
    expect(f.request).not.toHaveBeenCalled(); expect(dns.close).toHaveBeenCalled()
    expect(f.dnsRequest).toHaveBeenCalledOnce()
  })

  it('cancels a stalled DNS fallback without issuing the document request', async () => {
    const dns = response(); dns.headers['content-type'] = 'application/dns-json'
    dns.body = (async function* () { await new Promise(() => undefined); yield Buffer.from('late') })()
    const f = fallbackFixture(dns), controller = new AbortController(), result = f.reader({ url, signal: controller.signal })
    await vi.waitFor(() => expect(f.dnsRequest).toHaveBeenCalled())
    controller.abort()
    await expect(result).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled(); expect(dns.close).toHaveBeenCalled()
  })
})
