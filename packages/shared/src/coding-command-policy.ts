export type CodingPermissionMode = 'ask' | 'sandbox_rules' | 'unattended'
export type CodingCommandRule = { prefix: string[]; decision: 'deny' | 'ask' | 'allow' }
export type CodingPermissionPolicy = { version: 1; mode: CodingPermissionMode; rules: CodingCommandRule[] }

/** Host-owned literal argv prefixes. No shell parsing, wildcard expansion or model-supplied rules. */
export function parseCodingCommandRules(value: unknown): CodingCommandRule[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Invalid coding command rules')
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 ||
      !['deny', 'ask', 'allow'].includes(item.decision) || !Array.isArray(item.prefix) || item.prefix.length < 1 || item.prefix.length > 32 ||
      item.prefix.some((token: unknown) => typeof token !== 'string' || !token || token.length > 1000 || /[\x00-\x1f*?]/u.test(token))) throw new Error('Invalid literal command prefix rule')
    return { prefix: [...item.prefix], decision: item.decision } as CodingCommandRule
  })
}

function opaqueCommand(executable: string, args: string[]): boolean {
  const name = executable.split(/[\\/]/u).at(-1)!.toLowerCase().replace(/\.exe$/u, '')
  if (['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'env', 'sudo', 'doas', 'xargs', 'nice', 'nohup', 'timeout', 'watch', 'npx'].includes(name)) return true
  if (name === 'git' && args[0]?.startsWith('-')) return true
  // Interpreters accept attached/combined short options too (node -p1,
  // python -Icpass, perl -we...). Stay conservative rather than trying to
  // reimplement each interpreter's option parser inside an allow rule.
  return /^(node|nodejs|python[\d.]*|ruby|perl|php|lua[\d.]*|deno|bun)$/u.test(name) && args.some(arg => /^(?:--(?:eval|print)(?:=|$)|eval$|-[^-]*[ecp])/u.test(arg))
}

/** A prefix decision governs this direct invocation, not arbitrary code it may load.
 * Descendant filesystem/network effects remain confined by the selected sandbox.
 */
export function decideCodingCommand(input: { rules: CodingCommandRule[]; mode: CodingPermissionMode; sandboxed: boolean; executable: string; args: string[] }): 'deny' | 'ask' | 'allow' {
  const argv = [input.executable, ...input.args]
  const matching = input.rules.filter(rule => rule.prefix.every((value, index) => argv[index] === value))
  if (matching.some(rule => rule.decision === 'deny')) return 'deny'
  const canAllow = input.mode !== 'ask' && input.sandboxed && !opaqueCommand(input.executable, input.args) &&
    !matching.some(rule => rule.decision === 'ask') && matching.some(rule => rule.decision === 'allow')
  return canAllow ? 'allow' : input.mode === 'unattended' ? 'deny' : 'ask'
}
