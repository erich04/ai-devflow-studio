import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createGitHubAppClientFromEnv,
  resolveGitHubAppAuthConfig,
} from './github-app-auth'

function testKey(): { encodedPrivateKey: string; publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'] } {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' })
  return {
    encodedPrivateKey: Buffer.from(pem).toString('base64'),
    publicKey: pair.publicKey,
  }
}

describe('GitHub App authentication', () => {
  it('treats a completely absent App configuration as an unavailable optional feature', () => {
    expect(resolveGitHubAppAuthConfig({})).toBeUndefined()
  })

  it('fails closed on incomplete or malformed configuration without echoing key material', () => {
    const sentinel = 'PRIVATE_KEY_SENTINEL'
    for (const env of [
      { DEVFLOW_GITHUB_APP_ID: '123' },
      { DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: sentinel },
      {
        DEVFLOW_GITHUB_APP_ID: 'not-numeric',
        DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: sentinel,
      },
    ]) {
      const error = (() => {
        try {
          resolveGitHubAppAuthConfig(env)
        } catch (reason) {
          return reason
        }
        return undefined
      })()
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).not.toContain(sentinel)
    }
  })

  it('signs a compact RS256 App JWT without exposing the private key', async () => {
    const key = testKey()
    const client = createGitHubAppClientFromEnv({
      env: {
        DEVFLOW_GITHUB_APP_ID: '123',
        DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: key.encodedPrivateKey,
      },
      clock: () => new Date('2026-08-11T12:00:00.000Z'),
      fetcher: vi.fn(async (_url, init) => {
        const authorization = new Headers(init?.headers).get('authorization')
        expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/u)
        const compact = authorization!.slice('Bearer '.length)
        const [header, payload, signature] = compact.split('.')
        expect(JSON.parse(Buffer.from(header!, 'base64url').toString('utf8'))).toEqual({
          alg: 'RS256',
          typ: 'JWT',
        })
        expect(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))).toEqual({
          iss: '123',
          iat: 1_786_449_540,
          exp: 1_786_450_140,
        })
        expect(
          verify(
            'RSA-SHA256',
            Buffer.from(`${header}.${payload}`),
            key.publicKey,
            Buffer.from(signature!, 'base64url'),
          ),
        ).toBe(true)
        return Response.json({
          token: `ghs_${'x'.repeat(40)}`,
          expires_at: '2026-08-11T12:59:00.000Z',
          repository_selection: 'selected',
          permissions: { metadata: 'read', contents: 'write' },
          repositories: [{ id: 456 }],
        })
      }),
    })

    expect(client).toBeDefined()
    await expect(
      client!.issueContentsWriteToken({ installationId: '123', repositoryId: '456' }),
    ).resolves.toMatchObject({ repositoryId: '456', permissions: { contents: 'write' } })
  })
})
