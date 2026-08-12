import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('V1.5 packaged GitHub Delivery release gate', () => {
  it('exposes the release-profile gate as one exact package command', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['test:v15-github-delivery-packaged-smoke']).toBe(
      'node scripts/v15-github-delivery-packaged-smoke.mjs',
    )
    expect(packageJson.scripts?.['v15-github-delivery-packaged-smoke']).toBeUndefined()
  })

  it('launches the built executable twice through an isolated packaged file renderer', () => {
    const smoke = readFileSync(
      'scripts/v15-github-delivery-packaged-smoke.mjs',
      'utf8',
    )

    expect(smoke).toContain("from '@playwright/test'")
    expect(smoke).toContain('resolveDesktopExecutablePath')
    expect(smoke).toContain('DEVFLOW_USER_DATA_DIR')
    expect(smoke).toContain("startsWith('file://')")
    expect(smoke).toContain('launchPackagedDesktop')
    expect(smoke).toContain('restartSnapshot')
    expect(smoke).toContain("'--password-store=gnome-libsecret'")
    expect(smoke).not.toContain("args: ['--password-store=basic'")
    expect(smoke).toContain('safeStorage.isEncryptionAvailable()')
    expect(smoke).toContain("credentialStorage.backend === 'gnome_libsecret'")
    expect(smoke).toContain('await app.whenReady()')
  })

  it('runs once in both Verify and Release after building the packaged application', () => {
    for (const workflowPath of [
      '.github/workflows/verify.yml',
      '.github/workflows/release.yml',
    ]) {
      const workflow = readFileSync(workflowPath, 'utf8')
      const deterministicCommand = 'corepack pnpm test:v15-github-delivery'
      const gateCommand =
        'dbus-run-session -- node scripts/run-v15-packaged-smoke-linux.mjs'

      expect(workflow.match(
        /^\s*- run: dbus-run-session -- node scripts\/run-v15-packaged-smoke-linux\.mjs$/gmu,
      )).toHaveLength(1)
      expect(workflow.match(
        /^\s*- run: corepack pnpm test:v15-github-delivery$/gmu,
      )).toHaveLength(1)
      const gateIndex = workflow.indexOf(gateCommand)
      const packagedBuildIndex = workflow.lastIndexOf(
        'corepack pnpm build:desktop-pilot',
        gateIndex,
      )
      const deterministicIndex = workflow.lastIndexOf(
        `- run: ${deterministicCommand}`,
        gateIndex,
      )
      expect(deterministicIndex).toBeGreaterThan(-1)
      expect(packagedBuildIndex).toBeGreaterThan(deterministicIndex)
      expect(packagedBuildIndex).toBeLessThan(gateIndex)
      expect(workflow).toContain('DEVFLOW_PACKAGED_SMOKE_DATABASE_ADMIN_URL')
      expect(workflow).toContain('DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE: offline')
      expect(workflow).toContain(
        'sudo apt-get install -y --no-install-recommends dbus-x11 gnome-keyring libsecret-1-0',
      )
    }
  })

  it('unlocks an ephemeral Linux Secret Service without exposing its password', () => {
    const runner = readFileSync('scripts/run-v15-packaged-smoke-linux.mjs', 'utf8')

    expect(runner).toContain("randomBytes(32)")
    expect(runner).toContain("'gnome-keyring-daemon'")
    expect(runner).toContain("['--unlock', '--components=secrets']")
    expect(runner).toContain("'xvfb-run'")
    expect(runner).toContain("'test:v15-github-delivery-packaged-smoke'")
    expect(runner).not.toContain('DEVFLOW_CI_KEYRING_PASSWORD')
    expect(runner).not.toContain('shell: true')
  })

  it('fails closed behind disposable Postgres and offline GitHub/Git boundaries', () => {
    const smoke = readFileSync(
      'scripts/v15-github-delivery-packaged-smoke.mjs',
      'utf8',
    )
    const apiBoundary = readFileSync(
      'scripts/v15-github-delivery-packaged-api.mjs',
      'utf8',
    )

    expect(smoke).toContain('CREATE DATABASE')
    expect(smoke).toContain('DROP DATABASE IF EXISTS')
    expect(smoke).toContain("'git', ['http-backend']")
    expect(smoke).toContain('receive.denyNonFastForwards')
    expect(smoke).toContain('force-attempt')
    expect(smoke).toContain('gitAuditEvents')
    expect(smoke).toContain('githubAppPrivateKeyBase64')
    expect(smoke).toContain("blockedGrant.status === 409")
    expect(smoke).toContain('assertNoLeaks(')
    expect(apiBoundary).not.toContain('generateKeyPairSync')
    expect(apiBoundary).toContain('DEVFLOW_PACKAGED_SMOKE_GITHUB_APP_PRIVATE_KEY_BASE64')
    expect(apiBoundary).toContain("url.origin !== 'https://api.github.com'")
    expect(apiBoundary).toContain('unexpectedOutboundRequests')
    expect(apiBoundary).toContain("process.env['DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE']")
  })
})
