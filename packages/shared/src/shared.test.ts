import { describe, expect, it } from 'vitest'
import { runs, tokenUsage } from './fixtures'
import { canApproveGate } from './gates'
import { findEntityNeighborhood } from './knowledge'
import {
  redactCodingAgentEventForStorage,
  redactLocalAbsolutePaths,
  redactSecrets,
  inspectHighConfidenceOutboundSecrets,
} from './redaction'
import { parseThemePreference, resolveThemePreference } from './theme'
import { rollupTokenUsage } from './cost'

describe('redactSecrets', () => {
  it('redacts common API keys before evidence upload', () => {
    const result = redactSecrets('ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop ghp_1234567890abcdefghijklmnop')

    expect(result.redacted).toBe(true)
    expect(result.value).toContain('[REDACTED:env_secret_assignment]')
    expect(result.value).toContain('[REDACTED:github_token]')
    expect(result.replacementCount).toBe(2)
  })

  it('redacts an opaque bearer credential from an Authorization header', () => {
    const result = redactSecrets('Authorization: Bearer opaque-demo-token-123')

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('opaque-demo-token-123')
  })

  it('redacts password and token values from JSON-shaped output', () => {
    const result = redactSecrets(
      '{"password":"plain-demo-secret","token":"opaque-demo-token"}',
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('plain-demo-secret')
    expect(result.value).not.toContain('opaque-demo-token')
  })

  it('redacts Authorization and token values from escaped JSON-shaped output', () => {
    const result = redactSecrets(
      String.raw`payload={\"Authorization\":\"Bearer opaque-json-bearer\",\"token\":\"opaque-json-token\"}`,
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('opaque-json-bearer')
    expect(result.value).not.toContain('opaque-json-token')
  })

  it('redacts token and API key values from CLI options', () => {
    const result = redactSecrets(
      'client --token opaque-demo-token --api-key=opaque-demo-api-key',
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('opaque-demo-token')
    expect(result.value).not.toContain('opaque-demo-api-key')
  })
})

describe('inspectHighConfidenceOutboundSecrets', () => {
  it('reports only safe categories for provider tokens, private keys, and high-entropy assignments', () => {
    const githubToken = `ghp_${'a1B2'.repeat(6)}`
    const privateKey = [
      '-----BEGIN PRIVATE KEY-----',
      'opaque-private-key-material',
      '-----END PRIVATE KEY-----',
    ].join('\n')
    const result = inspectHighConfidenceOutboundSecrets(
      `${githubToken}\n${privateKey}\nDEPLOY_PASSWORD=A1b2C3d4E5f6G7h8I9j0`,
    )

    expect(result).toEqual({
      matchCount: 3,
      categories: ['github_token', 'private_key', 'secret_assignment'],
    })
    expect(JSON.stringify(result)).not.toContain(githubToken)
    expect(JSON.stringify(result)).not.toContain('opaque-private-key-material')
  })

  it('does not block placeholders and short test values', () => {
    expect(inspectHighConfidenceOutboundSecrets(
      'TOKEN=example API_KEY=placeholder PASSWORD=test-value Authorization: Bearer example',
    )).toEqual({ matchCount: 0, categories: [] })
  })
})

describe('redactCodingAgentEventForStorage', () => {
  it('redacts values selected by sensitive metadata keys at every nesting level', () => {
    const result = redactCodingAgentEventForStorage({
      id: 'coding-event-structured-secret',
      codingRunId: 'coding-run-structured-secret',
      runId: 'run-structured-secret',
      nodeId: 'node-build',
      sequence: 1,
      kind: 'tool_result',
      message: 'Tool completed.',
      timestamp: '2026-06-17T00:00:00.000Z',
      metadata: {
        token: 'opaque-structured-token',
        Authorization: 'Bearer opaque-structured-bearer',
        nested: {
          password: 'opaque-structured-password',
          apiKey: { value: 'opaque-structured-api-key' },
          route: '/v1/users',
        },
      },
      redacted: false,
    })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('opaque-structured-token')
    expect(serialized).not.toContain('opaque-structured-bearer')
    expect(serialized).not.toContain('opaque-structured-password')
    expect(serialized).not.toContain('opaque-structured-api-key')
    expect(serialized).toContain('/v1/users')
    expect(result.redacted).toBe(true)
  })
})

describe('redactLocalAbsolutePaths', () => {
  it('redacts a POSIX path immediately following a diagnostic label', () => {
    const result = redactLocalAbsolutePaths('error:/Users/alice/private/report.txt')

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('/Users/alice/private')
  })

  it('redacts a POSIX path immediately following an ANSI color sequence', () => {
    const result = redactLocalAbsolutePaths('\u001b[31m/Users/alice/private/report.txt\u001b[0m')

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('/Users/alice/private')
  })

  it('redacts every POSIX path in a comma-separated path list', () => {
    const result = redactLocalAbsolutePaths(
      'paths=/Volumes/team/project,/Users/alice/private/report.txt',
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('/Volumes/team')
    expect(result.value).not.toContain('/Users/alice/private')
  })

  it('redacts a JSON-escaped POSIX path', () => {
    const result = redactLocalAbsolutePaths(
      String.raw`json=\/Users\/alice\/private\/report.json`,
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain(String.raw`\/Users\/alice\/private`)
  })

  it('redacts a file URL that uses a single slash', () => {
    const result = redactLocalAbsolutePaths('file:/Users/alice/private/report.txt')

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('/Users/alice/private')
  })

  it('preserves versioned routes, metrics routes, and protocol-relative web URLs', () => {
    const result = redactLocalAbsolutePaths(
      'GET /v1/users; scrape /metrics; load //cdn.example.com/assets/app.js.',
    )

    expect(result.value).toContain('/v1/users')
    expect(result.value).toContain('/metrics')
    expect(result.value).toContain('//cdn.example.com/assets/app.js')
  })

  it('redacts a file-shaped path under /api without hiding an API endpoint', () => {
    const localFile = redactLocalAbsolutePaths(
      'Read local file /api/private/config.json; keep endpoint /api/runs.',
    )
    const httpEndpoint = redactLocalAbsolutePaths('GET /api/private/config.json')

    expect(localFile.value).not.toContain('/api/private/config.json')
    expect(localFile.value).toContain('/api/runs')
    expect(httpEndpoint.value).toContain('/api/private/config.json')
  })

  it('redacts POSIX, Windows, and file URL paths without hiding API routes', () => {
    const result = redactLocalAbsolutePaths(
      'Inspect /Users/alice/private/repo/src/index.ts, C:\\Users\\alice\\repo\\test.ts, and file:///private/tmp/devflow/report.txt; keep /health.',
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('/Users/alice')
    expect(result.value).not.toContain('C:\\Users\\alice')
    expect(result.value).not.toContain('file:///private/tmp')
    expect(result.value).toContain('/health')
  })

  it('redacts macOS and general POSIX filesystem paths while preserving API routes', () => {
    const result = redactLocalAbsolutePaths(
      'Read /Volumes/ClientData/repo/spec.md, /repo/private/config.json, and /usr/local/share/report.txt; keep /health and /api/runs.',
    )

    expect(result.value).not.toContain('/Volumes/ClientData')
    expect(result.value).not.toContain('/repo')
    expect(result.value).not.toContain('/usr/local')
    expect(result.value).toContain('/health')
    expect(result.value).toContain('/api/runs')
  })

  it('redacts single-segment POSIX roots without altering safe API routes or web URLs', () => {
    const result = redactLocalAbsolutePaths(
      'cwd=/repo tool=/usr; keep /health, /api/runs, and https://example.com/health.',
    )

    expect(result.value).not.toContain('cwd=/repo')
    expect(result.value).not.toContain('tool=/usr')
    expect(result.value).toContain('/health')
    expect(result.value).toContain('/api/runs')
    expect(result.value).toContain('https://example.com/health')
  })

  it('redacts Windows UNC paths with backslash and forward-slash separators', () => {
    const result = redactLocalAbsolutePaths(
      'Read \\\\fileserver\\private-share\\repo\\secret.txt and //fileserver/private-share/repo/secret.txt.',
    )

    expect(result.redacted).toBe(true)
    expect(result.value).not.toContain('fileserver')
    expect(result.value).not.toContain('private-share')
  })
})

describe('rollupTokenUsage', () => {
  it('aggregates cost and tokens by project', () => {
    const [project] = rollupTokenUsage(tokenUsage, 'projectId')

    expect(project?.key).toBe('p-payments')
    expect(project?.totalTokens).toBe(31_980)
    expect(project?.costUsd).toBeCloseTo(0.109)
  })
})

describe('canApproveGate', () => {
  it('allows lead to approve a lead gate but blocks members', () => {
    const gate = runs[0]?.nodes.find((node) => node.id === 'n-design-gate')

    expect(gate).toBeDefined()
    expect(canApproveGate('lead', gate!)).toBe(true)
    expect(canApproveGate('member', gate!)).toBe(false)
  })
})

describe('theme helpers', () => {
  it('parses invalid preferences as system and resolves against system theme', () => {
    expect(parseThemePreference('neon')).toBe('system')
    expect(resolveThemePreference('system', 'dark')).toBe('dark')
  })
})

describe('findEntityNeighborhood', () => {
  it('returns immediate graph relations for an entity', () => {
    const neighborhood = findEntityNeighborhood(
      {
        entities: [
          { id: 'a', label: 'A', kind: 'term', sourcePath: 'a.md' },
          { id: 'b', label: 'B', kind: 'term', sourcePath: 'b.md' },
          { id: 'c', label: 'C', kind: 'term', sourcePath: 'c.md' },
        ],
        relations: [
          { id: 'ab', source: 'a', target: 'b', label: 'uses' },
          { id: 'bc', source: 'b', target: 'c', label: 'depends_on' },
        ],
      },
      'b',
    )

    expect(neighborhood.entities.map((entity) => entity.id).sort()).toEqual(['a', 'b', 'c'])
    expect(neighborhood.relations).toHaveLength(2)
  })
})
