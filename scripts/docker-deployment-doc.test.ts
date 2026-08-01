import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('self-hosted Docker deployment files', () => {
  it('defines the minimum API, Web, and Postgres services', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')

    expect(compose).toContain('postgres:')
    expect(compose).toContain('api:')
    expect(compose).toContain('web:')
    expect(compose).toContain('DEVFLOW_DATABASE_URL')
    expect(compose).toContain('DEVFLOW_INTERNAL_API_BASE_URL')
    expect(compose).toContain('NEXT_PUBLIC_DEVFLOW_API_URL')
    expect(compose).toContain('tsx src/server.ts')
  })

  it('documents required self-hosted environment variables without secrets', () => {
    const envExample = readFileSync('.env.example', 'utf8')

    expect(envExample).toContain('DEVFLOW_SESSION_SECRET=')
    expect(envExample).toContain('GITHUB_CLIENT_ID=')
    expect(envExample).toContain('GITHUB_CLIENT_SECRET=')
    expect(envExample).not.toContain('ghp_')
    expect(envExample).not.toContain('sk-')
  })

  it('keeps Docker smoke explicit and outside default verify', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['test:docker-smoke']).toBe('tsx scripts/docker-smoke.mjs')
    expect(pkg.scripts['verify']).not.toContain('test:docker-smoke')
  })

  it('forwards the explicit demo-data flag into the API container', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')

    expect(compose).toContain(
      'DEVFLOW_ENABLE_DEMO_DATA: ${DEVFLOW_ENABLE_DEMO_DATA:-false}',
    )
  })

  it('marks the network-exposed API as a pilot deployment', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')

    expect(compose).toContain('DEVFLOW_DEPLOYMENT_PROFILE: pilot')
  })

  it('authenticates Docker pilot smoke requests without unsigned identity headers', () => {
    const smoke = readFileSync('scripts/docker-smoke.mjs', 'utf8')

    expect(smoke).toContain(
      "import { createSessionCookie } from '../apps/api/src/auth/session-cookie'",
    )
    expect(smoke).toContain("DEV_AUTH_ENABLED: 'false'")
    expect(smoke).toContain('cookie: pilotSessionCookie')
    expect(smoke).not.toContain('demoSessionHeaders')
  })

  it('runs Docker smoke from the GitHub verify workflow', () => {
    const workflow = readFileSync('.github/workflows/verify.yml', 'utf8')

    expect(workflow).toContain('Docker smoke')
    expect(workflow).toContain('corepack pnpm test:docker-smoke')
  })

  it('documents the self-hosted pilot walkthrough', () => {
    const guide = readFileSync('docs/guides/devflow-studio-self-hosted-pilot.md', 'utf8')

    expect(guide).toContain('docker compose up --build')
    expect(guide).toContain('corepack pnpm test:docker-smoke')
    expect(guide).toContain('DEVFLOW_SESSION_SECRET')
    expect(guide).toContain('Desktop pairing')
    expect(guide).toContain('Bearer token')
    expect(guide).toContain('raw stdout/stderr')
    expect(guide).toContain('DEVFLOW_DEPLOYMENT_PROFILE=pilot')
    expect(guide).toContain('DEV_AUTH_ENABLED=true')
    expect(guide).toContain('refuses to start')
  })
})
