import { describe, expect, it } from 'vitest'
import {
  classifyOpenCodePermission,
  type OpenCodePermissionPolicyInput,
} from './opencode-permission-policy.js'

function bash(command?: string): OpenCodePermissionPolicyInput {
  return { permission: 'bash', ...(command === undefined ? {} : { command }) }
}

describe('OpenCode first-slice permission policy', () => {
  it.each([undefined, '', '   '])(
    'rejects shell permission without usable command metadata: %s',
    (command) => {
      expect(classifyOpenCodePermission(bash(command))).toMatchObject({
        status: 'denied',
        code: 'command_metadata_missing',
      })
    },
  )

  it.each([
    'git push origin main',
    'git fetch origin',
    'git pull --ff-only',
    'git remote set-url origin https://example.invalid/repo.git',
    'git commit -am "agent change"',
    'git update-ref refs/heads/main HEAD',
    'git worktree add ../other HEAD',
    'git submodule update --init',
    'git merge feature',
    'git -C src rebase main',
    'git --git-dir metadata status',
  ])('rejects Git authority-changing command: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'git_write_disabled',
    })
  })

  it.each([
    'curl https://example.invalid/data',
    'wget https://example.invalid/data',
    'ssh build@example.invalid true',
    'scp artifact build@example.invalid:/tmp/',
    'rsync src/ build@example.invalid:/srv/app/',
    'gh api repos/example/project',
    'ping example.invalid',
    'cat https://example.invalid/data',
    'git clone git@example.invalid:team/repo.git',
    'npm view react version',
    'npm info lodash',
    'npm search http-client',
    'pnpm dlx create-vite app',
    'pnpm view react version',
    'yarn npm info react',
    'bun pm view react',
    'npx eslint .',
    'bunx eslint .',
  ])('rejects general network operation: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'network_disabled',
    })
  })

  it.each([
    'vercel deploy --prod',
    'netlify deploy --prod',
    'wrangler deploy',
    'kubectl apply -f deployment.yaml',
    'terraform apply -auto-approve',
    'docker push example/app:latest',
    'npm publish',
    'pnpm publish --access public',
    'yarn npm publish',
    'cargo publish',
    'twine upload dist/*',
  ])('rejects publish or deployment operation: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'publish_or_deploy_disabled',
    })
  })

  it.each([
    'npm install left-pad',
    'pnpm add lodash',
    'yarn upgrade',
    'pip install requests',
    'cargo update',
  ])('rejects package installation through shell permission: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'install_disabled',
    })
  })

  it.each([
    'cat .git/config',
    'git diff -- .git/hooks/pre-commit',
  ])('rejects direct repository metadata access: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'git_metadata_disabled',
    })
  })

  it.each([
    'cat /etc/passwd',
    'type C:\\Users\\example\\.ssh\\config',
    'cat ../outside.txt',
    'cat ~/secrets.txt',
    'cat $HOME/.config/service/token',
    'cat $XDG_CONFIG_HOME/opencode/config.json',
    'cat ${XDG_DATA_HOME}/opencode/auth.json',
    'type $APPDATA\\opencode\\config.json',
    'type %LOCALAPPDATA%\\opencode\\cache.json',
    'cd [REDACTED:project_path] && npm test',
    'cd [REDACTED:worktree_path]/../original && npm test',
  ])('rejects original-checkout, home, or external path: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'external_path_disabled',
    })
  })

  it.each([
    'sudo npm test',
    'bash -c "npm test"',
    'node -e "require(process.env.SCRIPT)"',
    'eval "$COMMAND"',
    'echo $(cat command.txt)',
    'GIT_DIR=metadata git status',
    'rg "$PATTERN" src',
    'cat ${XDG_CONFIG_HOME:-/tmp}/opencode/config.json',
    'rg pattern <(cat files.txt)',
    'rg pattern > matches.txt',
    'rg --pre "python3 decoder.py" pattern src',
    'find . -exec echo {} ;',
    'npm test && pwd',
    'npm test\ncurl https://example.invalid',
  ])('rejects nested shell or dynamic authority escape: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'shell_escape_disabled',
    })
  })

  it.each([
    { permission: 'install' as const, command: 'npm install' },
    { permission: 'external_directory' as const, filePath: '/tmp/outside' },
  ])('rejects disabled capability permission: $permission', (request) => {
    expect(classifyOpenCodePermission(request)).toMatchObject({ status: 'denied' })
  })

  it.each(['edit', 'write', 'patch'] as const)(
    'requires a repository-relative target for %s permission',
    (permission) => {
      expect(classifyOpenCodePermission({ permission })).toMatchObject({
        status: 'denied',
        code: 'target_metadata_missing',
      })
      expect(classifyOpenCodePermission({ permission, filePath: '../outside.ts' })).toMatchObject({
        status: 'denied',
        code: 'external_path_disabled',
      })
      expect(classifyOpenCodePermission({ permission, filePath: '.git/config' })).toMatchObject({
        status: 'denied',
        code: 'git_metadata_disabled',
      })
      expect(classifyOpenCodePermission({ permission, filePath: 'src/app.ts' })).toMatchObject({
        status: 'allowed',
        code: 'allowed',
      })
    },
  )

  it.each([
    'openssl s_client -connect example.com:443',
    'python3 scripts/fetch.py',
    'cat package.json',
    'ls src',
    'git diff --ext-diff',
  ])('denies commands outside the explicit local allowlist: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toMatchObject({
      status: 'denied',
      code: 'command_unsupported',
    })
  })

  it('denies a non-allowlisted Git status option even when a stronger Git rule applies', () => {
    expect(classifyOpenCodePermission(bash('git status --show-stash'))).toMatchObject({
      status: 'denied',
    })
  })

  it.each([
    'pwd',
    'npm test -- --run',
    'npm --silent run test:unit -- --runInBand',
    'pnpm lint',
    'pnpm --filter=desktop run typecheck',
    'yarn run test:unit',
    'bun test',
    'git status --short',
    'git diff -- src/app.ts',
    'cd [REDACTED:worktree_path] && npm test',
    'cd [REDACTED:worktree_path]/apps/desktop && pnpm test',
    'rg "TODO" src tests',
  ])('allows bounded local worktree command: %s', (command) => {
    expect(classifyOpenCodePermission(bash(command))).toEqual({
      status: 'allowed',
      code: 'allowed',
      reason: 'The permission stays within the first-slice managed-worktree capability envelope.',
    })
  })

  it('does not relay workflow-level permission origins into OpenCode', () => {
    expect(classifyOpenCodePermission({
      permission: 'write',
      filePath: 'src/app.ts',
      origin: 'change_acceptance',
    })).toMatchObject({
      status: 'denied',
      code: 'permission_origin_invalid',
    })
  })
})
