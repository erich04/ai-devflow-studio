import { readFile } from 'node:fs/promises'
import type { CodingExecutionProfile } from './coding-command-runner'

export type CodingNetworkProfile = { allowedOrigins: string[]; searchEndpoint?: string; apiKeyEnvironment?: string }
export type NativeCodingProfile = { version: 1; container?: Extract<CodingExecutionProfile, { kind: 'container' }>; network?: CodingNetworkProfile }
/** Host configuration, never model input. No wildcard origins, arbitrary request headers or local fallback. */
export async function loadNativeCodingProfile(file: string): Promise<NativeCodingProfile> {
  let input: NativeCodingProfile
  try { input = JSON.parse(await readFile(file, 'utf8')) as NativeCodingProfile } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 }; throw error }
  if (input.version !== 1 || Object.keys(input).some(key => !['version', 'container', 'network'].includes(key))) throw new Error('Invalid Native coding host profile')
  if (input.container && (input.container.kind !== 'container' || !/^\S+@sha256:[a-f0-9]{64}$/u.test(input.container.image) || !['none', 'bridge'].includes(input.container.network))) throw new Error('Invalid Native container profile')
  if (input.network) {
    const network = input.network
    if (!Array.isArray(network.allowedOrigins) || network.allowedOrigins.length > 100 || network.allowedOrigins.some(value => { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value || !!url.username || !!url.password })) throw new Error('Network requires explicit HTTPS origins')
    if (network.searchEndpoint && !network.allowedOrigins.includes(new URL(network.searchEndpoint).origin)) throw new Error('Search endpoint is outside configured origins')
    if (network.apiKeyEnvironment && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(network.apiKeyEnvironment)) throw new Error('Invalid search credential binding')
  }
  return input
}
