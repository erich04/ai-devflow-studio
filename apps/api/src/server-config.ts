export type ServerListenConfig = {
  host: string
  port: number
}

export function resolveServerListenConfig(
  env: Record<string, string | undefined> = process.env,
): ServerListenConfig {
  return {
    host: env['HOST'] ?? '127.0.0.1',
    port: Number(env['PORT'] ?? 4310),
  }
}
