export type DesktopRendererEntry =
  | { kind: 'development_url'; url: string }
  | { kind: 'file' }

export function resolveDesktopRendererEntry(input: {
  isPackaged: boolean
  developmentServerUrl: string | undefined
}): DesktopRendererEntry {
  if (!input.isPackaged && input.developmentServerUrl) {
    return {
      kind: 'development_url',
      url: input.developmentServerUrl,
    }
  }

  return { kind: 'file' }
}
