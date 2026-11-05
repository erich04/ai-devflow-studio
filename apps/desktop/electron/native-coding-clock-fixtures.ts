import ts from 'typescript'

export function requestsTimeBoundary(text: string) {
  return /(?:时间|耗时|墙钟).{0,6}(?:边界|截止|上限)|\b(?:deadline|elapsed[- ]time boundary|time[- ](?:budget|limit|boundary)|wall[- ]clock boundary)\b/iu.test(
    text,
  )
}

/** Structural prerequisite only. The baseline run still has to prove that the
 * requested boundary and cleanup are observed. A call counter cannot drive it. */
export function hasClockStimulus(file: string, body: string) {
  const tree = ts.createSourceFile(
    file,
    body,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  let observed = false
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text,
        receiver = node.expression.expression.getText(tree)
      if (
        /^(vi|jest)$/u.test(receiver) &&
        /^(setSystemTime|advanceTimersByTime(?:Async)?|advanceTimersToNextTimer(?:Async)?|runAllTimers(?:Async)?)$/u.test(
          method,
        )
      )
        observed = true
      if (
        method === 'spyOn' &&
        /^(vi|jest)$/u.test(receiver) &&
        /^(?:Date|performance)$/u.test(node.arguments[0]?.getText(tree) ?? '') &&
        node.arguments[1] &&
        ts.isStringLiteral(node.arguments[1]) &&
        node.arguments[1].text === 'now'
      )
        observed = true
      if (
        method === 'stubGlobal' &&
        /^(vi|jest)$/u.test(receiver) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        ['Date', 'performance'].includes(node.arguments[0].text)
      )
        observed = true
    }
    // Clock injection on an established fixture or an actual awaited timer can
    // also advance time without depending on a particular fake-timer package.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      /^(now|clock|currentTime|deadline|deadlineAt|expiresAt|remainingMilliseconds)$/u.test(node.name.text)
    )
      observed = true
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(setTimeout|setImmediate|sleep|delay|advanceTime|advanceClock)$/u.test(node.expression.text)
    )
      observed = true
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return observed
}
