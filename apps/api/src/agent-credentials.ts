import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const CIPHER = 'aes-256-gcm'
const DEV_FALLBACK_KEY = 'devflow-agent-credential-dev-key'

function resolveKey(env: Record<string, string | undefined> = process.env): Buffer {
  const configured = env['DEVFLOW_AGENT_CREDENTIAL_KEY']
  const material = configured && configured.trim().length > 0 ? configured : DEV_FALLBACK_KEY

  return createHash('sha256').update(material).digest()
}

export function maskAgentCredential(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}...`
  }

  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`
}

export function encryptAgentCredential(
  secret: string,
  env?: Record<string, string | undefined>,
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(CIPHER, resolveKey(env), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv, tag, encrypted].map((part) => part.toString('base64')).join('.')
}

export function decryptAgentCredential(
  payload: string,
  env?: Record<string, string | undefined>,
): string {
  const [ivValue, tagValue, encryptedValue] = payload.split('.')
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('Invalid encrypted provider credential')
  }

  const decipher = createDecipheriv(CIPHER, resolveKey(env), Buffer.from(ivValue, 'base64'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
