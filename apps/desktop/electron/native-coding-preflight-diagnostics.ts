import ts from 'typescript'
import { redactSensitiveText } from '@ai-devflow/shared'
import { codingDigest, type CodingCandidateWorkspace } from './coding-candidate-workspace'
import { privateAcceptancePath } from './native-coding-acceptance-context'

type Diagnostic = { id: string; kind: string; messageDigest?: string; frames?: Array<{ file: string; line: number }> }
const kinds = new Set([
  'AssertionError',
  'SyntaxError',
  'TypeError',
  'ReferenceError',
  'TestSetupError',
  'MatchedControlFailed',
  'WitnessNotReached',
  'CommittedEffectNotReached',
  'MismatchedInput',
])

/** Only report small public enum shapes declared alongside a parser taking
 * unknown input. A dynamic exception or candidate-supplied type cannot enter
 * this path: the caller has already matched the exact B guard and its hash. */
function parserResultShape(source: ts.SourceFile, line: number) {
  const position = source.getLineStarts()[line - 1]
  if (position === undefined) return undefined
  const owner = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      !!node.body &&
      node.getStart(source) <= position &&
      position < node.end &&
      node.parameters.some((parameter) => parameter.type?.kind === ts.SyntaxKind.UnknownKeyword),
  )
  if (!owner?.name || !owner.type || !ts.isTypeReferenceNode(owner.type) || !ts.isIdentifier(owner.type.typeName))
    return undefined
  const type = owner.type.typeName.text
  const declaration = source.statements.find(
    (node): node is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === type,
  )
  const members =
    declaration &&
    (ts.isInterfaceDeclaration(declaration)
      ? declaration.members
      : ts.isTypeLiteralNode(declaration.type)
        ? declaration.type.members
        : undefined)
  const fields = []
  for (const member of members ?? []) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name) || !member.type || !ts.isUnionTypeNode(member.type))
      continue
    const name = member.name.text
    if (/secret|credential|auth|password|token|apiKey/iu.test(name) || member.type.types.length > 8) continue
    const values = member.type.types.flatMap((t) =>
      ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : [],
    )
    if (
      values.length !== member.type.types.length ||
      !values.every((v) => /^[a-z][a-z_]{0,31}$/u.test(v) && redactSensitiveText(v).value === v)
    )
      continue
    fields.push({ name, optional: !!member.questionToken, values })
    if (fields.length === 8) break
  }
  return fields.length ? { function: owner.name.text, type, fields } : undefined
}

/** A parser may use one fail() helper for many different invariants. Only
 * expose the guard that actually calls that exact local helper on B. Literal
 * values, comments and dynamic exception contents stay out of this feedback. */
function verifiedGuardCaller(source: ts.SourceFile, throwLine: number, frames: Array<{ file: string; line: number }>) {
  const position = source.getLineStarts()[throwLine - 1]
  if (position === undefined) return undefined
  const helpers = source.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      !!node.body &&
      node.parameters.length === 0 &&
      node.body.statements.length === 1 &&
      ts.isThrowStatement(node.body.statements[0]!) &&
      source.getLineAndCharacterOfPosition(node.body.statements[0]!.getStart(source)).line === throwLine - 1,
  )
  if (helpers.length !== 1 || !helpers[0]?.name) return undefined
  const name = helpers[0].name.text
  const guards: Array<{ line: number; condition: ts.Expression }> = []
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node)) {
      const then =
        ts.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1
          ? node.thenStatement.statements[0]
          : node.thenStatement
      const call = then && (ts.isExpressionStatement(then) || ts.isReturnStatement(then)) ? then.expression : undefined
      if (
        call &&
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === name &&
        !call.arguments.length
      )
        guards.push({
          line: source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1,
          condition: node.expression,
        })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const frame of frames.filter((f) => f && f.file === source.fileName && Number.isSafeInteger(f.line))) {
    const exact = guards.filter((g) => g.line === frame.line)
    // A nearby, ambiguous failure cannot safely identify the invariant.
    const choices = exact.length ? exact : guards.filter((g) => Math.abs(g.line - frame.line) <= 3)
    if (choices.length !== 1) continue
    const guard = choices[0]!,
      start = guard.condition.getStart(source)
    let text = guard.condition.getText(source)
    if (text.length > 1300 || /\/\/|\/\*/u.test(text)) return undefined
    const masks: Array<{ start: number; end: number; replacement: string }> = []
    function mask(node: ts.Node) {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateExpression(node) ||
        ts.isRegularExpressionLiteral(node) ||
        ts.isNumericLiteral(node)
      ) {
        masks.push({
          start: node.getStart(source) - start,
          end: node.end - start,
          replacement: ts.isNumericLiteral(node) ? '<number>' : "'<literal>'",
        })
      } else ts.forEachChild(node, mask)
    }
    mask(guard.condition)
    for (const m of masks.reverse()) text = text.slice(0, m.start) + m.replacement + text.slice(m.end)
    text = text.replace(/\s+/gu, ' ').trim()
    if (text.length > 950 || redactSensitiveText(text).value !== text) return undefined
    return { location: source.fileName + ':' + guard.line, condition: text }
  }
  return undefined
}

/** Pre-implementation only. A stack can suggest a location, but only a literal
 * error in immutable B with the same digest can be shown to the private author. */
export async function privatePreflightDiagnostics(items: unknown, ids: string[], baseline?: CodingCandidateWorkspace) {
  const notes = []
  const files = new Map<string, string[]>()
  const trees = new Map<string, ts.SourceFile>()
  const shapes = new Map<string, ReturnType<typeof parserResultShape>>()
  let bytesLeft = 4 * 1024 * 1024
  const candidates = baseline?.identity.base.files ?? []
  for (const item of (Array.isArray(items) ? items : []).slice(0, 24) as Diagnostic[]) {
    if (!item || !ids.includes(item.id) || !kinds.has(item.kind)) continue
    let guard:
      | {
          location: string
          reason: string
          condition?: string
          declaredResult?: NonNullable<ReturnType<typeof parserResultShape>>
          caller?: NonNullable<ReturnType<typeof verifiedGuardCaller>>
        }
      | undefined
    if (item.kind === 'TestSetupError' && baseline && Array.isArray(item.frames) && typeof item.messageDigest === 'string') {
      const frames = item.frames.slice(0, 6)
      for (const [frameIndex, frame] of frames.entries()) {
        if (
          !frame ||
          typeof frame.file !== 'string' ||
          !Number.isSafeInteger(frame.line) ||
          frame.line < 1 ||
          privateAcceptancePath.test(frame.file)
        )
          continue
        const source = candidates.find((file) => file.path === frame.file)
        if (
          !source ||
          !/\.[cm]?[jt]sx?$/u.test(source.path) ||
          /\.(test|spec)\.[^.]+$/u.test(source.path) ||
          source.size > 1024 * 1024
        )
          continue
        if (!files.has(source.hash)) {
          if (source.size > bytesLeft) continue
          bytesLeft -= source.size
          const bytes = await baseline.blob(source.hash)
          if (codingDigest(bytes) !== source.hash) continue
          files.set(source.hash, bytes.toString('utf8').split('\n'))
        }
        const lines = files.get(source.hash)!
        const literalOn = (index: number) => {
          const line = lines[index]?.trim()
          if (!line || line.length > 600 || !line.includes('throw new')) return undefined
          const literal =
            /\bthrow new (?:Error|RangeError|TypeError)\((['"])([\p{L}\p{N} .,:_，。：！？、-]{2,120})\1\)/u.exec(line)
          if (
            !literal ||
            codingDigest(literal[2]!) !== item.messageDigest ||
            redactSensitiveText(literal[2]!).value !== literal[2]
          )
            return undefined
          const condition = /^if\s*\((.{1,320})\)\s*\{?\s*throw new /u.exec(line)?.[1]
          const safeCondition = condition?.replace(
            /(['"])(?:object|string|number|boolean|undefined|function|bigint|symbol)\1/gu,
            'type',
          )
          return {
            location: `${source.path}:${index + 1}`,
            reason: literal[2]!,
            ...(condition && safeCondition && /^[\w\s.!<>=&|?:+()\[\]-]+$/u.test(safeCondition) ? { condition } : {}),
          }
        }
        guard = literalOn(frame.line - 1)
        if (!guard) {
          const nearby = []
          for (let index = Math.max(0, frame.line - 5); index < Math.min(lines.length, frame.line + 4); index++) {
            const match = literalOn(index)
            if (match) nearby.push(match)
          }
          if (nearby.length === 1) guard = nearby[0]
        }
        if (!guard) continue
        if (lines.length <= 8000) {
          const treeKey = source.path + ':' + source.hash
          if (!trees.has(treeKey))
            trees.set(treeKey, ts.createSourceFile(source.path, lines.join('\n'), ts.ScriptTarget.Latest, true))
          const tree = trees.get(treeKey)!,
            line = Number(guard.location.slice(guard.location.lastIndexOf(':') + 1))
          const key = source.hash + ':' + guard.location
          if (!shapes.has(key)) shapes.set(key, parserResultShape(tree, line))
          const declaredResult = shapes.get(key)
          if (declaredResult) guard.declaredResult = declaredResult
          const caller = verifiedGuardCaller(tree, line, frames.slice(frameIndex + 1))
          if (caller) guard.caller = caller
        }
        break
      }
    }
    const note = { id: item.id, kind: item.kind, ...(guard ? { baselineGuard: guard } : {}) }
    if (JSON.stringify([...notes, note]).length > 4000) break
    notes.push(note)
  }
  return JSON.stringify(notes)
}

/** The reporter returns only known manifest paths. Hosted Windows runners may use
 * a short temp directory internally and a long or URI-encoded path in stacks. */
export function preflightFrameReader(paths: string[]) {
  const names = [...paths].sort((a, b) => b.length - a.length)
  return `function frames(error, windows = process.platform === 'win32') {
    const names = ${JSON.stringify(names)};
    const out = [];
    const normalize = input => {
      let value = String(input);
      try { value = decodeURIComponent(value); } catch {}
      value = value.replaceAll(String.fromCharCode(92), '/');
      return windows ? value.toLowerCase() : value;
    };
    const candidates = names.map(name => [name,normalize(name)]);
    function add(file, number) {
      const value = normalize(file), line = Number(number);
      if (!Number.isSafeInteger(line) || line < 1 || value.includes('/node_modules/') || value.includes('devflow-acceptance-')) return;
      const name = candidates.find(([,part]) => value === part || value.endsWith('/'+part))?.[0];
      if (name && !out.some(f => f.file===name && f.line===line) && out.length<6) out.push({file:name,line});
    }
    for (const frame of (Array.isArray(error.stacks) ? error.stacks : []).slice(0,18)) add(frame.file,frame.line);
    for (const stack of [error.stackStr,error.stack]) {
      for (const line of String(stack || '').split('\\n').slice(1,18)) {
        const hit = /:(\\d+):\\d+\\)?\\s*$/.exec(line);
        if (hit) add(line.slice(0,hit.index),hit[1]);
      }
    }
    return out;
  }`
}
