import path from 'node:path'
import ts from 'typescript'
import { redactSensitiveText } from '@ai-devflow/shared'
import { InvalidFixtureDraft } from './native-coding-fixture-cases'

type Source = { path: string; source: string; tree?: ts.SourceFile }
type Producer = {
  name: string
  module: string
  inputType: string
  inputDefinition: string
  example: string
  fixtureSetup: string
  importedNames: string[]
}
export type OwnedFixtureContract = { file: string; type: string; values: string[]; producers: Producer[] }
const parse = (f: Source) =>
  f.tree ??
  ts.createSourceFile(
    f.path,
    f.source,
    ts.ScriptTarget.Latest,
    true,
    f.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
const moduleId = (name: string) => name.replace(/\.[cm]?[jt]sx?$/u, '')
function typeName(t: ts.TypeNode | undefined): string | undefined {
  if (!t || !ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return undefined
  return t.typeName.text === 'Promise' ? typeName(t.typeArguments?.[0]) : t.typeName.text
}

/** Only an explicit public fixture type and a matching baseline factory qualify.
 * Parsers that accept an untyped wire value do not produce the upstream state. */
export function ownedFixtureContracts(tests: Source[], production: Source[]): OwnedFixtureContract[] {
  const factories = new Map<
    string,
    Array<{ path: string; name: string; inputType: string; inputDefinition: string; example: string; fixtureSetup: string }>
  >()
  const clean = (text: string, n: number) => redactSensitiveText(text.slice(0, n)).value
  for (const f of production) {
    const tree = parse(f)
    const localTypes = new Set(
      tree.statements.flatMap((s) =>
        (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
        s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          ? [s.name.text]
          : [],
      ),
    )
    for (const node of tree.statements) {
      if (
        !ts.isFunctionDeclaration(node) ||
        !node.name ||
        !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue
      const type = typeName(node.type),
        inputType = typeName(node.parameters[0]?.type)
      if (
        !type ||
        !localTypes.has(type) ||
        !inputType ||
        type === inputType ||
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ||
        (node.type && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(tree) === 'Promise')
      )
        continue
      const list = factories.get(type) ?? []
      const input = tree.statements.find(
        (s) => (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === inputType,
      )
      const peer = tests.find((t) => moduleId(t.path.replace(/\.(?:test|spec)(\.[^.]+)$/u, '$1')) === moduleId(f.path))
      let example = '',
        fixtureSetup = ''
      if (peer) {
        const suite = parse(peer),
          name = node.name.text
        let call: ts.CallExpression | undefined
        function scan(n: ts.Node) {
          if (!call && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) call = n
          if (!call) ts.forEachChild(n, scan)
        }
        scan(suite)
        if (call) {
          example = clean(call.getText(suite), 1200)
          const refs = new Set<string>()
          function names(n: ts.Node) {
            if (ts.isIdentifier(n)) refs.add(n.text)
            ts.forEachChild(n, names)
          }
          names(call)
          fixtureSetup = clean(
            suite.statements
              .filter(
                (s) =>
                  ts.isVariableStatement(s) &&
                  s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && refs.has(d.name.text)),
              )
              .map((s) => s.getText(suite))
              .join('\n'),
            2200,
          )
        }
      }
      list.push({
        path: f.path,
        name: node.name.text,
        inputType,
        inputDefinition: input ? clean(input.getText(tree), 1200) : '',
        example,
        fixtureSetup,
      })
      factories.set(type, list)
    }
  }
  const contracts: OwnedFixtureContract[] = []
  for (const f of tests) {
    if (!/mock(?:Resolved|Return)Value/u.test(f.source)) continue
    const tree = parse(f),
      variables = new Map<string, string[]>()
    for (const statement of tree.statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
      for (const decl of statement.declarationList.declarations) {
        const type = typeName(decl.type)
        if (
          !type ||
          !factories.has(type) ||
          !ts.isIdentifier(decl.name) ||
          !decl.initializer ||
          !ts.isObjectLiteralExpression(decl.initializer)
        )
          continue
        const vars = variables.get(type) ?? []
        vars.push(decl.name.text)
        variables.set(type, vars)
      }
    }
    for (const [type, values] of variables) {
      const matches = factories.get(type)!
      if (matches.length > 4 || new Set(matches.map((m) => m.path)).size !== 1) continue
      const producers = matches.map((m) => {
        const rel = moduleId(path.posix.relative(path.posix.dirname(f.path), m.path))
        const module = rel.startsWith('.') ? rel : './' + rel,
          importedNames: string[] = []
        for (const st of tree.statements) {
          if (
            !ts.isImportDeclaration(st) ||
            !ts.isStringLiteral(st.moduleSpecifier) ||
            moduleId(st.moduleSpecifier.text) !== module
          )
            continue
          const bindings = st.importClause?.namedBindings
          if (bindings && ts.isNamedImports(bindings))
            for (const e of bindings.elements)
              if ((e.propertyName ?? e.name).text === m.name) importedNames.push(e.name.text)
        }
        return {
          name: m.name,
          inputType: m.inputType,
          inputDefinition: m.inputDefinition,
          example: m.example,
          fixtureSetup: m.fixtureSetup,
          importedNames,
          module,
        }
      })
      if (contracts.length < 48) contracts.push({ file: f.path, type, values: values.slice(0, 64), producers })
    }
  }
  return contracts
}

function unwrap(expr: ts.Expression): ts.Expression {
  while (
    ts.isAwaitExpression(expr) ||
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  )
    expr = expr.expression
  return expr
}
function importedModule(expr: ts.Expression) {
  const call = unwrap(expr)
  return ts.isCallExpression(call) &&
    call.expression.kind === ts.SyntaxKind.ImportKeyword &&
    call.arguments[0] &&
    ts.isStringLiteral(call.arguments[0])
    ? moduleId(call.arguments[0].text)
    : undefined
}
function bodyBindings(tree: ts.SourceFile) {
  const mutations = new Map<string, Set<string>>()
  const mocks = new Map<string, ts.Expression>(),
    locals = new Map<string, ts.Expression>(),
    imports = new Map<string, { name: string; module: string }>()
  function visit(node: ts.Node) {
    let changed: ts.Expression | undefined
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      changed = node.left
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(push|pop|shift|unshift|splice|set|delete|clear|fill|reverse|sort)$/u.test(node.expression.name.text)
    )
      changed = node.expression.expression
    if (changed) {
      while (ts.isPropertyAccessExpression(changed) || ts.isElementAccessExpression(changed)) changed = changed.expression
      if (ts.isIdentifier(changed)) {
        const values = mutations.get(changed.text) ?? new Set<string>()
        values.add(node.getText(tree))
        mutations.set(changed.text, values)
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      if (ts.isIdentifier(node.name)) locals.set(node.name.text, node.initializer)
      else if (ts.isObjectBindingPattern(node.name)) {
        const module = importedModule(node.initializer)
        if (module)
          for (const e of node.name.elements)
            if (ts.isIdentifier(e.name)) imports.set(e.name.text, { name: (e.propertyName ?? e.name).getText(tree), module })
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^mock(?:Resolved|Return)Value(?:Once)?$/u.test(node.expression.name.text) &&
      node.arguments[0]
    ) {
      if (ts.isIdentifier(node.expression.expression)) mocks.set(node.expression.expression.text, node.arguments[0])
      let owner: ts.Node = node.parent
      while (
        !ts.isVariableDeclaration(owner) &&
        !ts.isPropertyAssignment(owner) &&
        owner.parent &&
        !ts.isBlock(owner) &&
        !ts.isSourceFile(owner)
      )
        owner = owner.parent
      if ((ts.isVariableDeclaration(owner) || ts.isPropertyAssignment(owner)) && ts.isIdentifier(owner.name))
        mocks.set(owner.name.text, node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { mocks, locals, imports, mutations }
}

export function checkOwnedFixtureInputs(
  file: string,
  control: string,
  body: string,
  all: OwnedFixtureContract[],
  approvedText = '',
) {
  const contracts = all.filter((c) => c.file === file)
  if (!contracts.length) return
  const prior = bodyBindings(parse({ path: file, source: control })),
    after = bodyBindings(parse({ path: file, source: body }))
  for (const [name, arg] of prior.mocks) {
    if (!ts.isIdentifier(arg)) continue
    const contract = contracts.find((c) => c.values.includes(arg.text))
    let next = after.mocks.get(name)
    if (!contract || !next) continue
    // A user can explicitly specify behavior for a malformed concrete wire shape.
    // Repository text and model-generated preconditions cannot grant that scope.
    if (
      approvedText.includes(contract.type) &&
      /\b(?:raw|malformed|corrupt(?:ed)?|invalid|untrusted)\b|原始响应|损坏|畸形|无效输入/iu.test(approvedText)
    )
      continue
    const seen = new Set<string>()
    next = unwrap(next)
    while (ts.isIdentifier(next) && after.locals.has(next.text) && !seen.has(next.text)) {
      seen.add(next.text)
      next = unwrap(after.locals.get(next.text)!)
    }
    if (ts.isIdentifier(next)) seen.add(next.text)
    const changed = [...seen].some((root) =>
      [...(after.mutations.get(root) ?? [])].some((m) => !prior.mutations.get(root)?.has(m)),
    )
    if (!changed && ts.isIdentifier(next) && contract.values.includes(next.text)) continue
    if (!changed && ts.isCallExpression(next)) {
      const callee = next.expression
      let imported: { name: string; module: string } | undefined
      if (ts.isIdentifier(callee)) {
        imported = after.imports.get(callee.text)
        if (!imported && !after.locals.has(callee.text)) {
          const known = contract.producers.find((p) => p.importedNames.includes(callee.text))
          if (known) imported = { name: known.name, module: known.module }
        }
      } else if (ts.isPropertyAccessExpression(callee)) {
        const object = unwrap(callee.expression)
        const module =
          ts.isIdentifier(object) && after.locals.has(object.text)
            ? importedModule(after.locals.get(object.text)!)
            : importedModule(object)
        if (module) imported = { name: callee.name.text, module }
      }
      if (imported && contract.producers.some((p) => p.module === imported.module && p.name === imported.name)) continue
    }
    const how = contract.producers.map((p) => p.name + ' from ' + p.module).join(' or ')
    throw new InvalidFixtureDraft(
      `The ${name} mock returns a project-owned ${contract.type}. Construct the changed input with its real upstream factory (${how}), or cover the transition at an existing producer/integration fixture. A fabricated read model can reject correct behavior implemented upstream.`,
    )
  }
}
