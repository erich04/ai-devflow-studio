import { describe, expect, it } from 'vitest'
import {
  PILOT_API_ENV_ALLOWLIST,
  resolveServerListenConfig,
  resolveServerRuntimeConfig,
} from './server-config'

const validPilotEnvironment = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  HOST: '0.0.0.0',
  PORT: '4310',
  DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
  DEVFLOW_REQUIRE_AUTH: 'true',
  DEV_AUTH_ENABLED: 'false',
  DEVFLOW_ENABLE_DEMO_DATA: 'false',
  DEVFLOW_ENABLE_FAKE_RUNTIME: 'false',
  DEVFLOW_SESSION_SECRET: 'pilot-session-secret-with-32-plus-random-characters',
  DEVFLOW_AGENT_CREDENTIAL_KEY:
    'pilot-agent-credential-key-with-32-plus-random-characters',
  DEVFLOW_DATABASE_URL: 'postgres://devflow:secret@postgres:5432/devflow',
  DEVFLOW_WEB_APP_URL: 'https://devflow.example/',
  GITHUB_CLIENT_ID: 'pilot-github-client',
  GITHUB_CLIENT_SECRET: 'pilot-github-secret',
  GITHUB_OAUTH_REDIRECT_URI: 'https://devflow.example/api/auth/github/callback',
  ...overrides,
})

describe('server listen config', () => {
  it('defaults to the local development interface and port', () => {
    expect(resolveServerListenConfig({})).toEqual({
      host: '127.0.0.1',
      port: 4310,
    })
  })

  it('allows container deployments to bind to all interfaces', () => {
    expect(resolveServerListenConfig({ HOST: '0.0.0.0', PORT: '4310' })).toEqual({
      host: '0.0.0.0',
      port: 4310,
    })
  })

  it.each(['NaN', 'Infinity', '0', '65536', '4310.5'])(
    'rejects invalid server port %s',
    (port) => {
      expect(() => resolveServerListenConfig({ PORT: port })).toThrow(
        'PORT must be a finite integer between 1 and 65535.',
      )
    },
  )

  it.each([
    'DEV_AUTH_ENABLED',
    'DEVFLOW_REQUIRE_AUTH',
    'DEVFLOW_ENABLE_DEMO_DATA',
    'DEVFLOW_ENABLE_FAKE_RUNTIME',
  ] as const)('rejects an invalid pilot boolean for %s', (name) => {
    expect(() =>
      resolveServerRuntimeConfig(
        validPilotEnvironment({
          [name]: 'yes',
        }),
      ),
    ).toThrow(
      `${name} must be "true" or "false" for DEVFLOW_DEPLOYMENT_PROFILE=pilot.`,
    )
  })

  it('rejects unsigned development auth on a network-exposed API', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        HOST: '0.0.0.0',
        PORT: '4310',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toThrow(
      'DEV_AUTH_ENABLED=true is allowed only for explicit non-browser development on a loopback API.',
    )
  })

  it('rejects unsigned development auth for a pilot deployment even on loopback', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        HOST: '127.0.0.1',
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toThrow('DEV_AUTH_ENABLED=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.')
  })

  it('rejects a pilot deployment that does not require authenticated requests', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
        DEVFLOW_REQUIRE_AUTH: 'false',
      }),
    ).toThrow(
      'DEVFLOW_REQUIRE_AUTH=true is required for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  })

  it.each([
    ['missing', undefined],
    ['short', 'short-secret'],
    ['blank', ' '.repeat(32)],
    ['placeholder', 'replace-this-with-a-long-random-string'],
    ['example marker', '<required-32-plus-random-characters>'],
  ])('rejects a pilot deployment with a %s session secret', (_label, sessionSecret) => {
    expect(() =>
      resolveServerRuntimeConfig({
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
        DEVFLOW_REQUIRE_AUTH: 'true',
        DEVFLOW_SESSION_SECRET: sessionSecret,
      }),
    ).toThrow(
      'DEVFLOW_SESSION_SECRET must be at least 32 characters and must not be a placeholder for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  })

  it.each([
    ['DEVFLOW_ENABLE_DEMO_DATA', 'DEVFLOW_ENABLE_DEMO_DATA=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.'],
    ['DEVFLOW_ENABLE_FAKE_RUNTIME', 'DEVFLOW_ENABLE_FAKE_RUNTIME=true is forbidden for DEVFLOW_DEPLOYMENT_PROFILE=pilot.'],
  ] as const)('rejects %s in a pilot deployment', (flag, message) => {
    expect(() =>
      resolveServerRuntimeConfig(
        validPilotEnvironment({
          [flag]: 'true',
        }),
      ),
    ).toThrow(message)
  })

  it.each([
    ['missing', undefined],
    ['non-Postgres', 'sqlite:///tmp/devflow.db'],
  ])('rejects a pilot deployment with a %s database URL', (_label, databaseUrl) => {
    expect(() =>
      resolveServerRuntimeConfig({
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
        DEVFLOW_REQUIRE_AUTH: 'true',
        DEVFLOW_SESSION_SECRET: 'pilot-session-secret-with-32-plus-random-characters',
        DEVFLOW_DATABASE_URL: databaseUrl,
      }),
    ).toThrow(
      'A postgres:// or postgresql:// DEVFLOW_DATABASE_URL (or DATABASE_URL) is required for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  })

  it.each([
    '0',
    '-1',
    '100.5',
    'Infinity',
    '2500ms',
    '0x2710',
    '1e4',
    '+2500',
    '02500',
    ' 2500 ',
  ])(
    'rejects invalid pilot database statement timeout %s',
    (statementTimeout) => {
      expect(() =>
        resolveServerRuntimeConfig(
          validPilotEnvironment({
            DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS: statementTimeout,
          }),
        ),
      ).toThrow(
        'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS must be a positive finite integer for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    },
  )

  it('rejects reusing the session secret as the agent credential key', () => {
    const sharedSecret = 'pilot-shared-secret-that-is-long-but-not-independent'
    expect(() =>
      resolveServerRuntimeConfig(
        validPilotEnvironment({
          DEVFLOW_SESSION_SECRET: sharedSecret,
          DEVFLOW_AGENT_CREDENTIAL_KEY: sharedSecret,
        }),
      ),
    ).toThrow(
      'DEVFLOW_SESSION_SECRET and DEVFLOW_AGENT_CREDENTIAL_KEY must be independent for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  })

  it.each([
    ['missing', undefined],
    ['short', 'short-key'],
    ['placeholder', 'replace-this-with-a-long-random-agent-key'],
    ['development fallback', 'devflow-agent-credential-dev-key'],
  ])(
    'rejects a pilot deployment with a %s agent credential key',
    (_label, credentialKey) => {
      expect(() =>
        resolveServerRuntimeConfig(
          validPilotEnvironment({
            DEVFLOW_AGENT_CREDENTIAL_KEY: credentialKey,
          }),
        ),
      ).toThrow(
        'DEVFLOW_AGENT_CREDENTIAL_KEY must be at least 32 characters, must not be a placeholder, and must not use the development fallback for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    },
  )

  it.each([
    ['client ID', { GITHUB_CLIENT_ID: undefined }],
    ['client secret', { GITHUB_CLIENT_SECRET: undefined }],
    ['redirect URI', { GITHUB_OAUTH_REDIRECT_URI: undefined }],
  ])('rejects pilot GitHub OAuth with a missing %s', (_label, overrides) => {
    expect(() =>
      resolveServerRuntimeConfig(validPilotEnvironment(overrides)),
    ).toThrow(
      'A complete GitHub OAuth configuration (client ID, client secret, and redirect URI) is required for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  })

  it.each(['not-a-url', 'ftp://devflow.example/oauth/callback'])(
    'rejects pilot GitHub OAuth redirect URI %s',
    (redirectUri) => {
      expect(() =>
        resolveServerRuntimeConfig(
          validPilotEnvironment({
            GITHUB_OAUTH_REDIRECT_URI: redirectUri,
          }),
        ),
      ).toThrow(
        'GITHUB_OAUTH_REDIRECT_URI must be an http(s) URL for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    },
  )

  it.each([undefined, 'not-a-url', 'ftp://devflow.example/'])(
    'rejects pilot Web application URL %s',
    (webAppUrl) => {
      expect(() =>
        resolveServerRuntimeConfig(
          validPilotEnvironment({
            DEVFLOW_WEB_APP_URL: webAppUrl,
          }),
        ),
      ).toThrow(
        'DEVFLOW_WEB_APP_URL must be an http(s) URL for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
      )
    },
  )

  it('preserves explicit unsigned auth for non-browser loopback development', () => {
    expect(
      resolveServerRuntimeConfig({
        HOST: '127.0.0.1',
        PORT: '4310',
        DEV_AUTH_ENABLED: 'true',
      }),
    ).toEqual({
      deploymentProfile: 'development',
      devAuthEnabled: true,
      host: '127.0.0.1',
      port: 4310,
      requireAuth: false,
      secureCookies: false,
      sessionSecret: 'devflow-dev-session-secret',
      webAppUrl: 'http://127.0.0.1:4311',
    })
  })

  it('accepts an explicit Postgres-backed authenticated pilot configuration', () => {
    expect(
      resolveServerRuntimeConfig(validPilotEnvironment()),
    ).toEqual({
      deploymentProfile: 'pilot',
      devAuthEnabled: false,
      host: '0.0.0.0',
      port: 4310,
      requireAuth: true,
      secureCookies: true,
      sessionSecret: 'pilot-session-secret-with-32-plus-random-characters',
      webAppUrl: 'https://devflow.example/',
    })
  })

  it('accepts the explicit GitHub OAuth aliases used by the client factory', () => {
    expect(
      resolveServerRuntimeConfig(
        validPilotEnvironment({
          GITHUB_CLIENT_ID: undefined,
          GITHUB_CLIENT_SECRET: undefined,
          GITHUB_OAUTH_CLIENT_ID: 'pilot-oauth-client',
          GITHUB_OAUTH_CLIENT_SECRET: 'pilot-oauth-secret',
        }),
      ).deploymentProfile,
    ).toBe('pilot')
  })

  it.each([
    ['hostname', 'https://web.devflow.example/'],
    ['protocol', 'http://devflow.example/'],
  ])('rejects a pilot Web URL with a different OAuth %s', (_label, webAppUrl) => {
    expect(() =>
      resolveServerRuntimeConfig(
        validPilotEnvironment({ DEVFLOW_WEB_APP_URL: webAppUrl }),
      ),
    ).toThrow(
      'DEVFLOW_WEB_APP_URL and GITHUB_OAUTH_REDIRECT_URI must use the same protocol and hostname for DEVFLOW_DEPLOYMENT_PROFILE=pilot.',
    )
  })

  it('documents every accepted pilot API environment alias in its allowlist', () => {
    expect(PILOT_API_ENV_ALLOWLIST).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'DEVFLOW_DATABASE_URL',
        'DEVFLOW_WEB_APP_URL',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
        'GITHUB_OAUTH_CLIENT_ID',
        'GITHUB_OAUTH_CLIENT_SECRET',
        'GITHUB_OAUTH_REDIRECT_URI',
        'HOST',
        'PORT',
      ]),
    )
  })

  it('rejects unknown application-owned environment variables in a pilot deployment without echoing their values', () => {
    const configure = () =>
      resolveServerRuntimeConfig({
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilot',
        DEVFLOW_REQUIRE_AUTH: 'true',
        DEVFLOW_SESSION_SECRET: 'pilot-session-secret-with-32-plus-random-characters',
        DEVFLOW_DATABASE_URL: 'postgres://devflow:secret@postgres:5432/devflow',
        DEVFLOW_UNSAFE_BYPASS: 'do-not-echo-this-value',
      })

    expect(configure).toThrow(
      'Unsupported pilot environment variable: DEVFLOW_UNSAFE_BYPASS.',
    )
    expect(configure).not.toThrow('do-not-echo-this-value')
  })

  it('rejects an unknown deployment profile instead of silently treating it as development', () => {
    expect(() =>
      resolveServerRuntimeConfig({
        DEVFLOW_DEPLOYMENT_PROFILE: 'pilto',
      }),
    ).toThrow('Unsupported DEVFLOW_DEPLOYMENT_PROFILE: pilto')
  })
})
