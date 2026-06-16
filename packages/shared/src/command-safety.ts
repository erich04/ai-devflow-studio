import type { CommandSafetyResult } from './domain'

const RECOGNIZED_TEST_COMMAND =
  /^(?:corepack\s+)?(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test(?:\s|$)/

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|\s)rm\s+-[A-Za-z]*[rf][A-Za-z]*\s+/,
    reason: 'Command contains destructive recursive removal.',
  },
  {
    pattern: /(^|\s)sudo(\s|$)/,
    reason: 'Command attempts privilege escalation with sudo.',
  },
  {
    pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|zsh)\b/,
    reason: 'Command pipes downloaded content into a shell.',
  },
  {
    pattern: /(^|\s)chmod\s+-R\b/,
    reason: 'Command recursively changes file permissions.',
  },
  {
    pattern: />\s*\/(?:etc|usr|bin|sbin|var|System|Library)\b/,
    reason: 'Command redirects output into a protected system path.',
  },
  {
    pattern: /\b(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b(?=[\s\S]*\bRemove-Item\b)(?=[\s\S]*\s-(?:Recurse|r)\b)(?=[\s\S]*\s-(?:Force|f)\b)/i,
    reason: 'Command recursively removes files through PowerShell.',
  },
  {
    pattern: /(^|\s)(?:cmd(?:\.exe)?\s+\/c\s+)?del\s+[\s\S]*\/[sq]\b[\s\S]*\/[sq]\b/i,
    reason: 'Command recursively deletes files through Windows del.',
  },
  {
    pattern: /(^|\s)rmdir\s+[\s\S]*\/s\b[\s\S]*\/q\b/i,
    reason: 'Command recursively removes directories through Windows rmdir.',
  },
  {
    pattern: />\s*[A-Za-z]:\\(?:Windows|Program Files|Program Files \(x86\))\\/i,
    reason: 'Command redirects output into a protected Windows system path.',
  },
]

export function normalizeShellCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

export function validateTestCommandSafety(command: string): CommandSafetyResult {
  const normalizedCommand = normalizeShellCommand(command)
  const reasons: string[] = []

  if (!normalizedCommand) {
    return {
      level: 'blocked',
      reasons: ['Command is empty.'],
      normalizedCommand,
    }
  }

  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(normalizedCommand)) {
      reasons.push(blocked.reason)
    }
  }

  if (reasons.length > 0) {
    return {
      level: 'blocked',
      reasons,
      normalizedCommand,
    }
  }

  if (!RECOGNIZED_TEST_COMMAND.test(normalizedCommand)) {
    return {
      level: 'warn',
      reasons: ['Command is not a recognized package-manager test command.'],
      normalizedCommand,
    }
  }

  return {
    level: 'safe',
    reasons: [],
    normalizedCommand,
  }
}
