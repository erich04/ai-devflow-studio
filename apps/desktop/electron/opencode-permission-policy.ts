import type { CodingPermissionRequest } from '@ai-devflow/shared'

export type OpenCodePermissionPolicyCode =
  | 'allowed'
  | 'command_unsupported'
  | 'command_metadata_missing'
  | 'external_directory_disabled'
  | 'external_path_disabled'
  | 'git_metadata_disabled'
  | 'git_write_disabled'
  | 'install_disabled'
  | 'network_disabled'
  | 'permission_origin_invalid'
  | 'permission_unsupported'
  | 'publish_or_deploy_disabled'
  | 'shell_escape_disabled'
  | 'target_metadata_missing'

export type OpenCodePermissionPolicyDecision =
  | {
      status: 'allowed'
      code: 'allowed'
      reason: string
    }
  | {
      status: 'denied'
      code: Exclude<OpenCodePermissionPolicyCode, 'allowed'>
      reason: string
    }

export type OpenCodePermissionPolicyInput = Pick<
  CodingPermissionRequest,
  'command' | 'filePath' | 'origin' | 'permission'
>

const DISABLED_GIT_SUBCOMMAND =
  /\bgit\b(?=[^;&|\r\n]*\b(?:add|branch|checkout|cherry-pick|clean|commit|config|fetch|gc|maintenance|merge|mv|prune|pull|push|rebase|reflog|remote|reset|restore|rm|stash|submodule|switch|tag|update-ref|worktree)\b)/iu

const GIT_ALTERNATE_SCOPE = /\bgit\b[^;&|\r\n]*(?:--git-dir|--work-tree|--namespace)(?:[=\s]|$)/iu

const NETWORK_COMMAND =
  /(?:^|[\s;&|()])(?:curl|dig|ftp|gh|glab|host|lftp|nc|ncat|netcat|nslookup|ping|rsync|scp|sftp|ssh|telnet|wget)(?=$|[\s;&|()])/iu

const NETWORK_ADDRESS = /(?:https?|ftp|ssh|git):\/\/|\bgit@[A-Za-z0-9._-]+:/iu

const PUBLISH_OR_DEPLOY = [
  /(?:^|[\s;&|()])(?:ansible|aws|az|cdk|docker|flyctl|gcloud|helm|heroku|kubectl|netlify|podman|pulumi|serverless|terraform|vercel|wrangler)(?=$|[\s;&|()])/iu,
  /\b(?:npm|pnpm|bun)\s+publish\b/iu,
  /\byarn\s+(?:npm\s+)?publish\b/iu,
  /\bcargo\s+publish\b/iu,
  /\btwine\s+upload\b/iu,
]

const PACKAGE_INSTALL =
  /\b(?:npm|pnpm|yarn|bun|pip|pip3|uv|poetry|cargo)\s+(?:add|install|update|upgrade)\b/iu

const PACKAGE_MANAGER_INVOCATION = /\b(?:bunx|npx|npm|pnpm|yarn|bun)(?:\.cmd)?\b/iu
const SAFE_LOCAL_SCRIPT = '(?:build(?::[A-Za-z0-9._-]+)?|check(?::[A-Za-z0-9._-]+)?|lint(?::[A-Za-z0-9._-]+)?|test(?::[A-Za-z0-9._-]+)?|typecheck(?::[A-Za-z0-9._-]+)?|verify(?::[A-Za-z0-9._-]+)?)'
const SAFE_LOCAL_PACKAGE_MANAGER_INVOCATIONS = [
  new RegExp(`^npm(?:\\s+--(?:if-present|ignore-scripts|silent|workspace=[^\\s]+))*\\s+(?:test|run(?:-script)?\\s+${SAFE_LOCAL_SCRIPT})(?:\\s|$)`, 'iu'),
  new RegExp(`^pnpm(?:\\s+--(?:if-present|ignore-scripts|silent|filter=[^\\s]+))*\\s+(?:${SAFE_LOCAL_SCRIPT}|run\\s+${SAFE_LOCAL_SCRIPT})(?:\\s|$)`, 'iu'),
  new RegExp(`^yarn(?:\\s+--(?:if-present|ignore-scripts|silent))*\\s+(?:${SAFE_LOCAL_SCRIPT}|run\\s+${SAFE_LOCAL_SCRIPT})(?:\\s|$)`, 'iu'),
  new RegExp(`^bun(?:\\s+--silent)*\\s+(?:test|run\\s+${SAFE_LOCAL_SCRIPT})(?:\\s|$)`, 'iu'),
]

const NESTED_SHELL_OR_EVAL =
  /(?:^|[\s;&|()])(?:bash|cmd(?:\.exe)?|doas|eval|exec|fish|powershell(?:\.exe)?|pwsh(?:\.exe)?|sh|sudo|zsh)(?=$|[\s;&|()])/iu

const INLINE_INTERPRETER =
  /(?:^|[\s;&|()])(?:node|perl|python|python3|ruby)\s+(?:-[A-Za-z]*[ce][A-Za-z]*|--eval)(?=$|[\s])/iu

const SENSITIVE_ENV_OVERRIDE =
  /(?:^|[\s;&|()])(?:GIT_DIR|GIT_WORK_TREE|HOME|USERPROFILE|GH_TOKEN|GITHUB_TOKEN|GIT_ASKPASS|SSH_AUTH_SOCK)\s*=/iu

const SECONDARY_COMMAND_EXECUTION =
  /(?:^|\s)(?:--pre(?:-glob)?(?:=|\s)|-(?:exec|execdir|ok|okdir)(?:\s|$))/iu
const SHELL_CONTROL_OR_EXPANSION = /(?:\$|`|<\(|>\(|[;|<>]|&(?!&))/u

const REPOSITORY_METADATA_PATH = /(?:^|[\s"'=:/\\])\.git(?:$|[\s"'=:/\\])/iu
const PARENT_PATH_SEGMENT = /(?:^|[\s"'=:/\\])\.\.(?:$|[\s"'=:/\\])/u
const WINDOWS_ABSOLUTE_PATH = /(?:^|[\s"'=(:])(?:[A-Za-z]:[\\/]|\\\\)[^\s"';&|)]*/u
const UNIX_ABSOLUTE_PATH = /(?:^|[\s"'=(:])\/(?!\/)[^\s"';&|)]*/u
const USER_HOME_PATH = /(?:^|[\s"'=(:])(?:~(?:[\\/]|$)|\$(?:\{)?(?:HOME|USERPROFILE)(?:\})?(?:[\\/]|$))/u
const EXTERNAL_CONFIG_ENV_PATH =
  /(?:^|[\s"'=(:])(?:\$(?:\{)?(?:APPDATA|LOCALAPPDATA|XDG_CACHE_HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_RUNTIME_DIR|XDG_STATE_HOME)(?:\})?|%(?:APPDATA|LOCALAPPDATA)%)(?:[\\/]|$)/iu
const WORKTREE_MARKER = '[REDACTED:worktree_path]'
const PROJECT_MARKER = '[REDACTED:project_path]'

export function classifyOpenCodePermission(
  input: OpenCodePermissionPolicyInput,
): OpenCodePermissionPolicyDecision {
  if (input.origin && input.origin !== 'coding_executor') {
    return denied(
      'permission_origin_invalid',
      'Only a live OpenCode tool permission can be relayed to the OpenCode session.',
    )
  }

  if (input.permission === 'external_directory') {
    return denied(
      'external_directory_disabled',
      'OpenCode external-directory access is disabled for the first product slice.',
    )
  }
  if (input.permission === 'install') {
    return denied(
      'install_disabled',
      'OpenCode dependency installation and package downloads are disabled for the first product slice.',
    )
  }

  if (
    input.permission === 'edit' ||
    input.permission === 'write' ||
    input.permission === 'patch'
  ) {
    if (!input.filePath?.trim()) {
      return denied(
        'target_metadata_missing',
        'OpenCode write permission did not identify one repository-relative target.',
      )
    }
    return classifyRepositoryPath(input.filePath)
  }

  if (input.permission !== 'bash') {
    return denied(
      'permission_unsupported',
      'OpenCode requested a permission that DevFlow does not support.',
    )
  }

  if (/[\r\n]/u.test(input.command ?? '')) {
    return denied(
      'shell_escape_disabled',
      'OpenCode multi-command shell input is disabled.',
    )
  }

  const command = normalizeCommand(input.command)
  if (!command) {
    return denied(
      'command_metadata_missing',
      'OpenCode shell permission did not include command metadata.',
    )
  }

  if (REPOSITORY_METADATA_PATH.test(command)) {
    return denied(
      'git_metadata_disabled',
      'OpenCode cannot read or modify repository metadata directly.',
    )
  }
  if (command.includes(PROJECT_MARKER)) {
    return denied(
      'external_path_disabled',
      'OpenCode cannot target the original project checkout.',
    )
  }

  if (DISABLED_GIT_SUBCOMMAND.test(command) || GIT_ALTERNATE_SCOPE.test(command)) {
    return denied(
      'git_write_disabled',
      'OpenCode Git mutation, remote access, commit, fetch, and worktree operations are disabled.',
    )
  }
  if (PACKAGE_INSTALL.test(command)) {
    return denied(
      'install_disabled',
      'OpenCode package installation and update commands are disabled.',
    )
  }
  if (PUBLISH_OR_DEPLOY.some((pattern) => pattern.test(command))) {
    return denied(
      'publish_or_deploy_disabled',
      'OpenCode publish, deployment, container, and infrastructure commands are disabled.',
    )
  }
  if (
    NESTED_SHELL_OR_EVAL.test(command) ||
    INLINE_INTERPRETER.test(command) ||
    SENSITIVE_ENV_OVERRIDE.test(command) ||
    SECONDARY_COMMAND_EXECUTION.test(command) ||
    command.includes('$(') ||
    command.includes('`')
  ) {
    return denied(
      'shell_escape_disabled',
      'OpenCode nested shells, dynamic evaluation, and authority-changing environment overrides are disabled.',
    )
  }
  if (
    NETWORK_COMMAND.test(command) ||
    NETWORK_ADDRESS.test(command) ||
    containsDisallowedPackageManagerInvocation(command)
  ) {
    return denied(
      'network_disabled',
      'OpenCode general network access is disabled for the first product slice.',
    )
  }

  const commandWithoutManagedRoot = command.split(WORKTREE_MARKER).join('WORKTREE_ROOT')
  if (
    PARENT_PATH_SEGMENT.test(commandWithoutManagedRoot) ||
    WINDOWS_ABSOLUTE_PATH.test(commandWithoutManagedRoot) ||
    UNIX_ABSOLUTE_PATH.test(commandWithoutManagedRoot) ||
    USER_HOME_PATH.test(commandWithoutManagedRoot) ||
    EXTERNAL_CONFIG_ENV_PATH.test(commandWithoutManagedRoot)
  ) {
    return denied(
      'external_path_disabled',
      'OpenCode shell permission targets a path outside the managed worktree.',
    )
  }

  if (input.filePath?.trim()) {
    const pathDecision = classifyRepositoryPath(input.filePath)
    if (pathDecision.status === 'denied') return pathDecision
  }

  const localCommand = unwrapManagedWorktreeCommand(command)
  if (!localCommand || SHELL_CONTROL_OR_EXPANSION.test(localCommand)) {
    return denied(
      'shell_escape_disabled',
      'OpenCode shell control operators, expansion, redirection, and secondary command execution are disabled.',
    )
  }
  if (!isAllowedLocalCommand(localCommand)) {
    return denied(
      'command_unsupported',
      'OpenCode shell commands are denied unless they match the explicit local read/test allowlist.',
    )
  }

  return {
    status: 'allowed',
    code: 'allowed',
    reason: 'The permission stays within the first-slice managed-worktree capability envelope.',
  }
}

function unwrapManagedWorktreeCommand(command: string): string | undefined {
  const managedCd = new RegExp(
    `^cd ${escapeRegExp(WORKTREE_MARKER)}(?:/[A-Za-z0-9._/-]+)? && (.+)$`,
    'u',
  ).exec(command)
  if (managedCd) return managedCd[1]?.trim()
  return command.includes('&&') ? undefined : command
}

function isAllowedLocalCommand(command: string): boolean {
  if (command === 'pwd') return true
  if (SAFE_LOCAL_PACKAGE_MANAGER_INVOCATIONS.some((pattern) => pattern.test(command))) return true
  if (
    /^git status(?:\s+(?:-s|-b|--short|--branch|--porcelain(?:=(?:v1|v2))?|--untracked-files(?:=(?:no|normal|all))?|--ignored(?:=(?:traditional|matching|no))?|--|[A-Za-z0-9._/@+][A-Za-z0-9._/@+-]*))*$/iu.test(command)
  ) {
    return true
  }
  if (
    /^git diff(?:\s+(?:--stat|--name-only|--name-status|--check|--no-ext-diff|--no-textconv|--cached|--staged|--|[A-Za-z0-9._/@+][A-Za-z0-9._/@+-]*))*$/iu.test(command)
  ) {
    return true
  }
  return /^rg(?:\s+.+)?$/u.test(command)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function containsDisallowedPackageManagerInvocation(command: string): boolean {
  for (const segment of command.split(/(?:&&|\|\||[;&|\r\n])/u)) {
    const match = PACKAGE_MANAGER_INVOCATION.exec(segment)
    if (!match || match.index === undefined) continue
    const invocation = segment.slice(match.index).trim()
    if (!SAFE_LOCAL_PACKAGE_MANAGER_INVOCATIONS.some((pattern) => pattern.test(invocation))) {
      return true
    }
  }
  return false
}

function classifyRepositoryPath(value: string): OpenCodePermissionPolicyDecision {
  const normalized = value.trim().replace(/\\/gu, '/')
  if (!normalized) {
    return denied('target_metadata_missing', 'OpenCode did not identify a permission target.')
  }
  if (normalized.includes(PROJECT_MARKER)) {
    return denied('external_path_disabled', 'OpenCode cannot target the original project checkout.')
  }
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.startsWith('~/') ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    return denied(
      'external_path_disabled',
      'OpenCode permission target is not repository-relative inside the managed worktree.',
    )
  }
  if (normalized.split('/').some((segment) => segment.toLowerCase() === '.git')) {
    return denied(
      'git_metadata_disabled',
      'OpenCode cannot read or modify repository metadata directly.',
    )
  }
  return {
    status: 'allowed',
    code: 'allowed',
    reason: 'The permission target is repository-relative inside the managed worktree.',
  }
}

function normalizeCommand(command: string | undefined): string {
  return command?.trim().replace(/\s+/gu, ' ') ?? ''
}

function denied(
  code: Exclude<OpenCodePermissionPolicyCode, 'allowed'>,
  reason: string,
): OpenCodePermissionPolicyDecision {
  return { status: 'denied', code, reason }
}
