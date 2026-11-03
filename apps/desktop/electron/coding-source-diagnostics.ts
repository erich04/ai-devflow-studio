import ts from 'typescript'

/** Parse only the bytes owned by this edit. Never load project configuration,
 * resolve imports or execute candidate code. This is advisory, not test evidence. */
export function codingSourceDiagnostics(path: string, bytes: Buffer, hash: string) {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(path)) return undefined
  const identity = { path, hash, scope: 'syntax_only' as const, parser: `typescript-${ts.version}` }
  if (bytes.length > 1024 * 1024) return { ...identity, status: 'not_checked', reason: 'size_limit' }
  let source: string
  try {
    if (bytes.includes(0)) return { ...identity, status: 'not_checked', reason: 'binary_or_non_utf8' }
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return { ...identity, status: 'not_checked', reason: 'binary_or_non_utf8' } }
  try {
    const result = ts.transpileModule(source, { fileName: path, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, experimentalDecorators: true } })
    const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
    // Raw parser messages can contain source text. Only host-produced locations
    // and numeric codes leave this helper, including on unexpected parser faults.
    const diagnostics = errors.slice(0, 8).map(item => {
      const location = item.file?.getLineAndCharacterOfPosition(item.start ?? 0)
      return { code: item.code, line: (location?.line ?? 0) + 1, column: (location?.character ?? 0) + 1 }
    })
    return { ...identity, status: errors.length ? 'syntax_error' : 'no_syntax_errors', diagnostics, totalDiagnostics: errors.length }
  } catch { return { ...identity, status: 'not_checked', reason: 'parser_unavailable' } }
}
