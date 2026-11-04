import { requestsLostAcknowledgement } from './native-coding-lost-reply'
import ts from 'typescript'

export type PublicStoreRoundTrip = { write: string; read: string }

/** Only index stores in a public fixture that actually opens temporary/file-backed
 * storage. A mock transport with similarly named methods is not a disk fixture. */
export function hasFileStoreFixture(tree: ts.SourceFile) {
  const setup = /\b(?:dbPath|databasePath|databaseFile|storageFile)\s*:|\bnew\s+(?:DatabaseSync|SqliteDatabase)\s*\(/u.test(
    tree.text,
  )
  const imports = ts.preProcessFile(tree.text, true, true).importedFiles.map((i) => i.fileName)
  return (
    setup &&
    imports.some((name) => /(?:store|repository|sqlite|database|^node:fs)/iu.test(name)) &&
    !/\b(?:vi|jest)\.mock\(\s*['"][^'"]*(?:store|repository|sqlite|database)/iu.test(tree.text)
  )
}

export function publicStoreRoundTrip(
  block: ts.Node,
  tree: ts.SourceFile,
  required?: PublicStoreRoundTrip,
): PublicStoreRoundTrip | undefined {
  const writes = new Map<string, string>()
  let pair: PublicStoreRoundTrip | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node)) return
    // A read in save(await read()) happens before the save.
    ts.forEachChild(node, visit)
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return
    const receiver = node.expression.expression.getText(tree),
      method = node.expression.name.text
    if (!/^(?:[\w$]+\.)*[\w$]*(?:store|repository|database|db|journal|storage)[\w$]*$/iu.test(receiver)) return
    const verb = /^(save|write|put|upsert|insert|commit|update|list|load|read|get|find)([A-Z].*|$)/u.exec(method)
    if (!verb) return
    const record = verb[2]!.toLowerCase().replace(/ies$/u, 'y').replace(/s$/u, '')
    const key = receiver + ':' + record
    const call = receiver + '.' + method
    if (['save', 'write', 'put', 'upsert', 'insert', 'commit', 'update'].includes(verb[1]!)) writes.set(key, call)
    else if (writes.has(key) && (!required || (required.write === writes.get(key) && required.read === call)))
      pair = { write: writes.get(key)!, read: call }
  }
  visit(block)
  return pair
}

export function variantHasStoreRoundTrip(file: string, body: string, pair: PublicStoreRoundTrip) {
  const tree = ts.createSourceFile(
    file,
    body,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found = publicStoreRoundTrip(tree, tree, pair)
  return found?.write === pair.write && found.read === pair.read
}

/** Reading an already persisted attachment alone does not require a new write. */
export function requestsDurableRoundTrip(text: string) {
  // In this contract the write has already succeeded. It is the waiting
  // caller's recovery from the missing acknowledgement that must be observed.
  if (requestsLostAcknowledgement(text) && !/重启|重开|重新打开|重载|\b(?:restart|reopen|reload)/iu.test(text)) return false
  return (
    /持久|落盘|已存储|重启|\b(?:persist(?:ed|ent|ence)?|durable|restart(?:ed)?|stored)\b/iu.test(text) &&
    /状态保存|保存(?:原始|当前|合法|状态|数据|记录)|重新读取|读回|重读|\b(?:save|saving|reload|reopen|re-read|read\s+back)\b/iu.test(
      text,
    )
  )
}

export function requestsStoredRecovery(text: string) {
  return (
    requestsDurableRoundTrip(text) &&
    /损坏|重建|修复|恢复|\b(?:recover(?:y|ed|ing)?|repair(?:ed|ing)?|corrupt(?:ed|ion)?)\b/iu.test(text)
  )
}
