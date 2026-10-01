/** Electron wraps every rejected `ipcRenderer.invoke` in this prefix, naming the channel. */
const ipcErrorPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/u

/**
 * The message a caught IPC error should show: Electron's channel prefix removed, and the
 * fallback when nothing readable is left (hardening H4).
 */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  return error.message.replace(ipcErrorPrefix, '').trim() || fallback
}
