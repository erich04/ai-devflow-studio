export type RedactionResult = {
  value: string
  redacted: boolean
  matches: string[]
}

const secretPatterns: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'env_secret_assignment',
    pattern: /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|COOKIE)=([^\s]+)/gi,
  },
  {
    label: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  },
  { label: 'anthropic_api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'openai_api_key', pattern: /\bsk-[A-Za-z0-9_-]{6,}\b/g },
  { label: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
]

export function redactSecrets(input: string): RedactionResult {
  let value = input
  const matches: string[] = []

  for (const { label, pattern } of secretPatterns) {
    value = value.replace(pattern, () => {
      matches.push(label)
      return `[REDACTED:${label}]`
    })
  }

  return {
    value,
    redacted: matches.length > 0,
    matches: Array.from(new Set(matches)),
  }
}
