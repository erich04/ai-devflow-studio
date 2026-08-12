import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('self-hosted Docker deployment files', () => {
  it('pins the candidate Node and Postgres base images by manifest digest', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    const compose = readFileSync('docker-compose.yml', 'utf8')
    const lifecycle = readFileSync('scripts/docker-lifecycle-smoke.mjs', 'utf8')
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const verifyWorkflow = readFileSync('.github/workflows/verify.yml', 'utf8')
    const nodeImage =
      'node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7'
    const postgresImage =
      'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'

    expect(dockerfile.match(new RegExp(nodeImage, 'g'))).toHaveLength(3)
    for (const source of [compose, lifecycle, releaseWorkflow, verifyWorkflow]) {
      expect(source).toContain(postgresImage)
    }
  })

  it('runs API and Web from minimal non-root production targets', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')
    const dockerfile = readFileSync('Dockerfile', 'utf8')

    expect(compose).toContain('postgres:')
    expect(compose).toContain('migrate:')
    expect(compose).toContain('api:')
    expect(compose).toContain('web:')
    expect(compose).toContain('DEVFLOW_DATABASE_URL')
    expect(compose).toContain('DEVFLOW_INTERNAL_API_BASE_URL')
    expect(compose).toContain('DEVFLOW_PUBLIC_API_BASE_URL')
    expect(compose).toContain('target: api-runtime')
    expect(compose).toContain('target: web-runtime')
    expect(compose).toContain('command: ["node", "migrate.js"]')
    expect(compose).not.toContain('tsx')
    expect(compose).not.toContain('src/server.ts')
    expect(compose).not.toContain('next start')
    expect(compose).not.toContain('corepack pnpm')

    expect(dockerfile).toContain('AS api-runtime')
    expect(dockerfile).toContain('AS web-runtime')
    expect(dockerfile.match(/USER node/g)).toHaveLength(2)
    expect(dockerfile).toContain('CMD ["node", "server.js"]')
    expect(dockerfile).toContain('CMD ["node", "apps/web/server.js"]')
    expect(dockerfile).toContain('/apps/web/.next/static')

    const apiRuntime = dockerfile.split('AS api-runtime')[1]!.split('AS web-runtime')[0]!
    const webRuntime = dockerfile.split('AS web-runtime')[1]!
    for (const runtime of [apiRuntime, webRuntime]) {
      expect(runtime).not.toContain('corepack')
      expect(runtime).not.toContain('pnpm')
      expect(runtime).not.toContain('node_modules/.pnpm/tsx')
      expect(runtime).not.toContain('COPY apps ')
      expect(runtime).not.toContain('COPY packages ')
    }
  })

  it('gates API and Web startup on migration and readiness', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')

    expect(compose).toContain('condition: service_completed_successfully')
    expect(compose).toContain('condition: service_healthy')
    expect(compose).toContain("fetch('http://127.0.0.1:4310/ready')")
    expect(compose).toContain("fetch('http://127.0.0.1:4311/ready')")
  })

  it('documents required self-hosted environment variables without secrets', () => {
    const envExample = readFileSync('.env.example', 'utf8').replace(/\r\n?/g, '\n')

    expect(envExample).toContain('POSTGRES_PASSWORD=\n')
    expect(envExample).toContain('DEVFLOW_SESSION_SECRET=\n')
    expect(envExample).toContain('DEVFLOW_AGENT_CREDENTIAL_KEY=\n')
    expect(envExample).toContain('DEVFLOW_REQUIRE_AUTH=true')
    expect(envExample).toContain('DEVFLOW_PUBLIC_API_BASE_URL=')
    expect(envExample).toContain('DEVFLOW_WEB_APP_URL=')
    expect(envExample).toContain('GITHUB_CLIENT_ID=\n')
    expect(envExample).toContain('GITHUB_CLIENT_SECRET=\n')
    expect(envExample).toContain('DEVFLOW_GITHUB_APP_ID=\n')
    expect(envExample).toContain('DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64=\n')
    expect(envExample).not.toContain('POSTGRES_PASSWORD=devflow')
    expect(envExample).not.toContain('replace-this')
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

  it('hardens the pilot and keeps demo seed as an explicit one-shot utility', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')
    const smoke = readFileSync('scripts/docker-smoke.mjs', 'utf8')

    expect(compose).toContain('DEVFLOW_REQUIRE_AUTH: "true"')
    expect(compose).toContain('DEV_AUTH_ENABLED: "false"')
    expect(compose).toContain('DEVFLOW_ENABLE_DEMO_DATA: "false"')
    expect(compose).toContain('DEVFLOW_ENABLE_FAKE_RUNTIME: "false"')
    expect(compose).toContain('profiles: ["demo"]')
    expect(compose).toContain('command: ["node", "seed-demo.js"]')
    expect(smoke).toContain("'run', '--rm', 'seed'")
    expect(smoke).not.toContain("'exec', '-T', 'api', 'corepack'")
  })

  it('requires pilot secrets and OAuth without insecure Compose defaults', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8')

    expect(compose).toContain('POSTGRES_PASSWORD:?')
    expect(compose).toContain('DEVFLOW_SESSION_SECRET:?')
    expect(compose).toContain('DEVFLOW_AGENT_CREDENTIAL_KEY:?')
    expect(compose).toContain('GITHUB_CLIENT_ID:?')
    expect(compose).toContain('GITHUB_CLIENT_SECRET:?')
    expect(compose).toContain('GITHUB_OAUTH_REDIRECT_URI:?')
    expect(compose).toContain('DEVFLOW_GITHUB_APP_ID: ${DEVFLOW_GITHUB_APP_ID:-}')
    expect(compose).toContain(
      'DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: ${DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64:-}',
    )
    expect(compose.match(/^\s+DEVFLOW_WEB_APP_URL:/gm)).toHaveLength(2)
    expect(compose).not.toContain('POSTGRES_PASSWORD:-devflow')
    expect(compose).not.toContain('replace-this-devflow-session-secret')
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
    expect(smoke).toContain("DEVFLOW_GITHUB_APP_ID: ''")
    expect(smoke).toContain("DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: ''")
    expect(smoke).toContain('cookie: pilotSessionCookie')
    expect(smoke).not.toContain('demoSessionHeaders')
    expect(smoke).toContain("redirect: 'manual'")
    expect(smoke).toContain('/api/auth/github/start')
    expect(smoke).toContain('/_next/static/')
    expect(smoke).toContain('assetBytes.byteLength > 0')
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
    expect(guide).toContain('DEVFLOW_AGENT_CREDENTIAL_KEY')
    expect(guide).toContain('one-shot migration')
    expect(guide).toContain('/ready')
    expect(guide).toContain('Allowed API environment variables')
    expect(guide).toContain('node server.js')
    expect(guide).not.toContain('tsx src/server.ts')
    expect(guide).not.toContain('future release-engineering task')
    expect(guide).toContain('Desktop pairing')
    expect(guide).toContain('Bearer token')
    expect(guide).toContain('raw stdout/stderr')
    expect(guide).toContain('DEVFLOW_DEPLOYMENT_PROFILE=pilot')
    expect(guide).toContain('DEV_AUTH_ENABLED=true')
    expect(guide).toContain('refuses to start')
  })
})
