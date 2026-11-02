import { describe, expect, it } from 'vitest'
import { decideCodingCommand, parseCodingCommandRules, type CodingPermissionMode } from './coding-command-policy'

describe('coding command permission policy', () => {
  const rules = parseCodingCommandRules([
    { prefix: ['git'], decision: 'allow' },
    { prefix: ['git', 'push'], decision: 'ask' },
    { prefix: ['git', 'push', '--force'], decision: 'deny' },
  ])
  it('applies deny before ask before allow regardless of rule order', () => {
    const decide = (args: string[]) => decideCodingCommand({ rules, mode: 'sandbox_rules', sandboxed: true, executable: 'git', args })
    expect(decide(['status'])).toBe('allow')
    expect(decide(['push'])).toBe('ask')
    expect(decide(['push', '--force'])).toBe('deny')
    expect(decideCodingCommand({ rules: [...rules].reverse(), mode: 'sandbox_rules', sandboxed: true, executable: 'git', args: ['push', '--force'] })).toBe('deny')
  })
  it.each(['ask', 'sandbox_rules', 'unattended'] as CodingPermissionMode[])('keeps exact argv boundaries in %s mode', mode => {
    const result = decideCodingCommand({ rules, mode, sandboxed: true, executable: 'git status; curl example.test', args: [] })
    expect(result).toBe(mode === 'unattended' ? 'deny' : 'ask')
    expect(decideCodingCommand({ rules, mode, sandboxed: true, executable: '/candidate/git', args: ['status'] })).toBe(result)
  })
  it('does not turn shell, inline code or wrapper prefixes into automatic execution authority', () => {
    for (const [executable, args] of [['sh', ['-c', 'git status; curl example.test']], ['node', ['-e', 'process.exit()']], ['env', ['git', 'status']], ['powershell.exe', ['-Command', 'Get-Content x']]] as const) {
      const allow = parseCodingCommandRules([{ prefix: [executable], decision: 'allow' }])
      expect(decideCodingCommand({ rules: allow, mode: 'sandbox_rules', sandboxed: true, executable, args: [...args] })).toBe('ask')
      expect(decideCodingCommand({ rules: allow, mode: 'unattended', sandboxed: true, executable, args: [...args] })).toBe('deny')
    }
  })
  it('requires questions for trusted-local and ask mode; unattended denies unanswered permissions', () => {
    expect(decideCodingCommand({ rules, mode: 'ask', sandboxed: true, executable: 'git', args: ['status'] })).toBe('ask')
    expect(decideCodingCommand({ rules, mode: 'sandbox_rules', sandboxed: false, executable: 'git', args: ['status'] })).toBe('ask')
    expect(decideCodingCommand({ rules, mode: 'unattended', sandboxed: false, executable: 'git', args: ['status'] })).toBe('deny')
    expect(decideCodingCommand({ rules, mode: 'unattended', sandboxed: true, executable: 'git', args: ['status'] })).toBe('allow')
  })
  it('rejects malformed, wildcard, empty and oversized host rules', () => {
    for (const input of [null, {}, [{ prefix: [], decision: 'allow' }], [{ prefix: ['git*'], decision: 'allow' }], [{ prefix: ['git'], decision: 'ALLOW' }], [{ prefix: ['git'], decision: 'allow', source: 'model' }]]) expect(() => parseCodingCommandRules(input)).toThrow()
  })
})
