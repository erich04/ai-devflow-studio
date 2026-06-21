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

    expect(pkg.scripts['test:docker-smoke']).toBe('node scripts/docker-smoke.mjs')
    expect(pkg.scripts['verify']).not.toContain('test:docker-smoke')
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
  })
})
