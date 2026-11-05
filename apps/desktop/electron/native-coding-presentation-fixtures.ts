import ts from 'typescript'

/** A synchronous test observing only a declared presentation builder's result
 * demonstrates a view model. It cannot establish the operation offered by that
 * view. Mixed tests that await an operation or assert its result stay eligible. */
export function observesPresentationProjection(block: ts.Block, tree: ts.SourceFile): boolean {
  const builders = new Set<string>()
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!/(?:view-model|presentation)(?:\.[cm]?[jt]sx?)?$/u.test(statement.moduleSpecifier.text)) continue
    const names = statement.importClause?.namedBindings
    if (!names || !ts.isNamedImports(names)) continue
    for (const name of names.elements)
      if (/(?:ViewModel|Presentation)$/u.test((name.propertyName ?? name.name).text)) builders.add(name.name.text)
  }
  if (!builders.size) return false
  // Resolve the common public helper that directly returns the imported builder.
  for (const statement of tree.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || statement.body?.statements.length !== 1) continue
    const returned = statement.body.statements[0]
    if (
      returned && ts.isReturnStatement(returned) && returned.expression &&
      ts.isCallExpression(returned.expression) && ts.isIdentifier(returned.expression.expression) &&
      builders.has(returned.expression.expression.text)
    )
      builders.add(statement.name.text)
  }
  const values = new Set<string>()
  function projected(node: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
      return projected(node.expression)
    if (ts.isIdentifier(node)) return values.has(node.text)
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return projected(node.expression)
    if (!ts.isCallExpression(node)) return false
    if (ts.isIdentifier(node.expression)) return builders.has(node.expression.text)
    return ts.isPropertyAccessExpression(node.expression) && projected(node.expression.expression)
  }
  let assertions = 0
  let otherObservation = false
  function visit(node: ts.Node) {
    if (ts.isAwaitExpression(node)) otherObservation = true
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && projected(node.initializer))
      values.add(node.name.text)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect') {
      assertions++
      if (!node.arguments[0] || !projected(node.arguments[0])) otherObservation = true
    }
    ts.forEachChild(node, visit)
  }
  visit(block)
  return assertions > 0 && !otherObservation
}
