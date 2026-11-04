import ts from 'typescript'
import { codingDigest } from './coding-candidate-workspace'

export class InvalidFixtureDraft extends Error {}

export type AcceptanceCriterion = { id: string; text: string; sourceRef: string }
type FixtureContrast = { control: string; requested: string; field?: string; boundCall?: true }
export type FixtureBinding = { path: string; hash: string; anchor: string; units: string[]; contrast?: FixtureContrast }
export type CoverageRecord = { sources: AcceptanceCriterion[]; contextOnly: Array<{ unit: string; reason: string }> }
type Region = { start: number; end: number }
type Anchor = Region & { id: string; title: string; control?: string }
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !value.includes('\0')
export const validFixturePath = (name: string) =>
  /^(?:[\w@.-]+\/)*[\w@.-]+\.(?:test|spec)\.[jt]sx?$/u.test(name) &&
  !name.split('/').some((part) => part === '..' || part === '.')

export function bindFixtureContrast(
  value: unknown,
  body: string,
  namedInputs?: readonly string[],
  examples?: ReadonlyArray<{ field: string; value: string; observedValues: string[] }>,
): FixtureContrast | undefined {
  if (value === undefined) return undefined
  if (
    !record(value) ||
    !bounded(value.control, 100) ||
    !bounded(value.requested, 100) ||
    value.control === value.requested ||
    (namedInputs && !namedInputs.includes(value.requested))
  )
    throw new InvalidFixtureDraft('Invalid named input contrast')
  const field = value.field
  if (
    field !== undefined &&
    (typeof field !== 'string' || !['kind', 'stage', 'mode', 'type', 'status', 'state'].includes(field))
  )
    throw new InvalidFixtureDraft('Choose the real fixture discriminator field')
  if (
    examples &&
    !examples.some(
      (e) => e.value === value.requested && e.field === field && e.observedValues.includes(String(value.control)),
    )
  )
    throw new InvalidFixtureDraft(
      'Use the same observed discriminator field and choose actual control and requested values from its public records',
    )
  const tree = ts.createSourceFile('case.ts', body, ts.ScriptTarget.Latest, true)
  let used = false
  let invocation = false
  const requireCall = namedInputs !== undefined || value.boundCall === true
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && ['__devflowInput', '__devflowInvoke'].includes(node.text)) {
      if (
        ((ts.isVariableDeclaration(node.parent) ||
          ts.isParameter(node.parent) ||
          ts.isBindingElement(node.parent) ||
          ts.isFunctionDeclaration(node.parent)) &&
          node.parent.name === node) ||
        (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      )
        throw new InvalidFixtureDraft(
          'The host declares __devflowInput and __devflowInvoke lexically. Use them directly without a local declaration, global lookup or fallback',
        )
      if (node.text === '__devflowInput') used = true
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === '__devflowInvoke') {
      const [action, args, resolver] = node.arguments
      if (
        !action ||
        !(
          ts.isIdentifier(action) ||
          ts.isPropertyAccessExpression(action) ||
          (ts.isCallExpression(action) &&
            ts.isPropertyAccessExpression(action.expression) &&
            action.expression.name.text === 'bind')
        ) ||
        !args ||
        !ts.isArrayLiteralExpression(args) ||
        !resolver ||
        !(ts.isArrowFunction(resolver) || ts.isFunctionExpression(resolver)) ||
        !resolver.parameters.length
      )
        throw new InvalidFixtureDraft(
          'Pass the real callable, an array of its arguments and an inline mode resolver to __devflowInvoke',
        )
      const names = new Set(resolver.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])))
      let readsArgument = false
      function read(n: ts.Node) {
        if (ts.isIdentifier(n)) {
          if (n.text === '__devflowInput')
            throw new InvalidFixtureDraft(
              'Resolve the actual mode from the invocation arguments instead of returning the expected mode',
            )
          if (names.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) readsArgument = true
        }
        ts.forEachChild(n, read)
      }
      read(resolver.body)
      if (!readsArgument) throw new InvalidFixtureDraft('The mode resolver must inspect the actual invocation arguments')
      invocation = true
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (!used || (requireCall && !invocation))
    throw new InvalidFixtureDraft(
      'Use __devflowInput to arrange the requested state and __devflowInvoke to exercise its actual entry point',
    )
  return {
    control: value.control,
    requested: value.requested,
    ...(typeof field === 'string' ? { field } : {}),
    ...(requireCall ? { boundCall: true } : {}),
  }
}

/** The source index preserves the original criterion and order. Several spans may
 * describe one behavior; background and reporting can be accounted for explicitly. */
export function sourceUnits(criteria: AcceptanceCriterion[]) {
  return criteria.flatMap((criterion, index) =>
    criterion.text
      .split(/(?<=[。！？；;])|(?<=[.!?])(?=\s)|\n+/u)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, part) => ({
        id: `r${index + 1}.${part + 1}`,
        criterionId: criterion.id,
        sourceRef: criterion.sourceRef,
        text,
      })),
  )
}

export type NamedFixtureSubject = { unit: string; value: string }

/** A named fixture discriminator that introduces an approved clause is a concrete
 * subject we can check mechanically. Mentions elsewhere may describe forbidden
 * side effects and do not acquire this extra requirement. */
export function namedFixtureSubjects(
  units: ReturnType<typeof sourceUnits>,
  examples: Array<{ term: string; value: string }>,
): NamedFixtureSubject[] {
  const subjects: NamedFixtureSubject[] = []
  for (const unit of units) {
    const first = /^[\s`"'“‘(（]*([A-Za-z][\w-]*)/u.exec(unit.text)?.[1]?.toLowerCase()
    for (const { term, value } of examples) {
      if (term.toLowerCase() === first && !subjects.some((s) => s.unit === unit.id && s.value === value))
        subjects.push({ unit: unit.id, value })
    }
  }
  return subjects
}

export function requireNamedFixtureSubjects(
  subjects: NamedFixtureSubject[],
  cases: Array<{ units: string[]; contrast?: { requested: string } | undefined }>,
) {
  for (const subject of subjects) {
    if (!cases.some((c) => c.units.includes(subject.unit) && c.contrast?.requested === subject.value))
      throw new InvalidFixtureDraft(
        'A named input subject still lacks a bound operation. Use its required contrast in a case covering that same approved source unit.',
      )
  }
}

function registrationRoot(expression: ts.Expression): ts.Expression {
  while (
    ts.isCallExpression(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isTaggedTemplateExpression(expression)
  ) {
    expression = ts.isTaggedTemplateExpression(expression) ? expression.tag : expression.expression
  }
  return expression
}

/** Build from the immutable public file. A case can use the setup of a named test,
 * including describe-local variables, without copying tests from an implementation. */
export function fixtureTemplate(file: string, source: string) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const testNames = new Set(['it', 'test']),
    suiteNames = new Set(['describe', 'suite'])
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'vitest')
      continue
    const imports = node.importClause?.namedBindings
    if (!imports || !ts.isNamedImports(imports)) continue
    for (const name of imports.elements) {
      const imported = (name.propertyName ?? name.name).text
      if (testNames.has(imported)) testNames.add(name.name.text)
      if (suiteNames.has(imported)) suiteNames.add(name.name.text)
    }
  }
  const anchors: Anchor[] = [],
    suites: Region[] = []
  function visit(node: ts.Node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression,
        root = registrationRoot(call.expression)
      if (ts.isIdentifier(root)) {
        const region = { start: node.getStart(tree), end: node.end }
        if (suiteNames.has(root.text)) suites.push(region)
        if (testNames.has(root.text)) {
          const name = call.arguments[0],
            callback = call.arguments[1]
          const control =
            ts.isIdentifier(call.expression) &&
            callback &&
            (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
            !callback.parameters.length &&
            ts.isBlock(callback.body)
              ? callback.body.getText(tree).slice(1, -1)
              : undefined
          anchors.push({
            ...region,
            ...(control !== undefined ? { control } : {}),
            id: `t${anchors.length + 1}`,
            title: name && ts.isStringLiteralLike(name) ? name.text : '(dynamic title)',
          })
          return
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  function replace(chosen?: Anchor, replacement = ';') {
    const unusedSuites = chosen ? suites.filter((suite) => suite.start > chosen.start || suite.end < chosen.end) : []
    const regions = [...anchors, ...unusedSuites].sort((a, b) => a.start - b.start || b.end - a.end)
    const pieces: string[] = []
    let offset = 0
    for (const region of regions) {
      if (region.start < offset) continue
      pieces.push(source.slice(offset, region.start), region === chosen ? replacement : ';')
      offset = region.end
    }
    return pieces.join('') + source.slice(offset)
  }
  function render(anchorId: string, title: string, body: string, paired = false) {
    const anchor = anchors.find((item) => item.id === anchorId)
    if (!anchor) throw new Error('Missing immutable fixture anchor')
    function test(name: string, code: string) {
      return `__devflowFixtureCase.sequential(${JSON.stringify(name)}, async () => {\nconst __before = __devflowAssert.getState().assertionCalls;\nawait (async () => {\n${code}\n})();\nif (__devflowAssert.getState().assertionCalls <= __before) throw new Error('Private case made no assertion');\n});`
    }
    if (paired && anchor.control === undefined) throw new Error('Fixture has no independent control')
    const original = paired ? test('devflow:original-control', anchor.control!) : ''
    return (
      "import { it as __devflowFixtureCase, expect as __devflowAssert } from 'vitest';\n" +
      replace(anchor, original + '\n' + test(title, body))
    )
  }
  return { path: file, hash: codingDigest(source), source, anchors, scaffold: replace(), render }
}
export type FixtureTemplate = ReturnType<typeof fixtureTemplate>

export function bindFixtureCases(sources: AcceptanceCriterion[], fixtures: FixtureTemplate[], draft: unknown) {
  if (
    !record(draft) ||
    !Array.isArray(draft.cases) ||
    !draft.cases.length ||
    draft.cases.length > 32 ||
    !Array.isArray(draft.contextOnly)
  )
    throw new InvalidFixtureDraft('Invalid fixture case plan')
  const units = sourceUnits(sources),
    byId = new Map(units.map((unit) => [unit.id, unit])),
    covered = new Set<string>()
  const criteria: AcceptanceCriterion[] = []
  const checks = draft.cases.map((item: unknown, i: number) => {
    if (
      !record(item) ||
      !bounded(item.body, 64000) ||
      !bounded(item.anchor, 40) ||
      !['pass', 'fail'].includes(String(item.baseline)) ||
      !Array.isArray(item.units) ||
      !item.units.length ||
      item.units.length > units.length
    )
      throw new InvalidFixtureDraft('Invalid fixture case')
    const fixture = fixtures.find((_, index) => item.fixture === `f${index + 1}`)
    if (!fixture?.anchors.some((anchor) => anchor.id === item.anchor))
      throw new InvalidFixtureDraft('Unknown fixture anchor')
    const claims = item.units.map((id) => byId.get(id))
    const first = claims[0]
    if (
      !first ||
      claims.some((claim) => !claim || claim.criterionId !== first.criterionId) ||
      new Set(item.units).size !== item.units.length
    )
      throw new InvalidFixtureDraft('Invalid sourced case coverage')
    const id = `case-${i + 1}`
    criteria.push({ id, text: claims.map((claim) => claim!.text).join('\n'), sourceRef: first.sourceRef })
    for (const unit of item.units) covered.add(unit)
    const contrast = bindFixtureContrast(item.contrast, item.body)
    return {
      criterionId: id,
      body: item.body,
      baselineExpectation: item.baseline as 'pass' | 'fail',
      fixture: {
        path: fixture.path,
        hash: fixture.hash,
        anchor: item.anchor,
        units: [...item.units] as string[],
        ...(contrast ? { contrast } : {}),
      },
    }
  })
  const exercised = new Set([...covered].map((id) => byId.get(id)!.criterionId))
  const contextOnly = draft.contextOnly.map((note: unknown) => {
    if (
      !record(note) ||
      typeof note.unit !== 'string' ||
      !byId.has(note.unit) ||
      covered.has(note.unit) ||
      !bounded(note.reason, 1500)
    )
      throw new InvalidFixtureDraft('Invalid contextual coverage note')
    covered.add(note.unit)
    return { unit: note.unit, reason: note.reason }
  })
  if (covered.size !== units.length || sources.some((criterion) => !exercised.has(criterion.id)))
    throw new InvalidFixtureDraft('Incomplete independent behavior coverage')
  return { criteria, checks, coverage: { sources, contextOnly } }
}

export type FixtureSelection = {
  scenarios: Array<{ units: string[]; fixture: string; anchor: string; precondition: string }>
  contextOnly: CoverageRecord['contextOnly']
}

export function readFixtureSelection(
  sources: AcceptanceCriterion[],
  fixtures: FixtureTemplate[],
  draft: unknown,
): FixtureSelection {
  if (!record(draft) || !Array.isArray(draft.scenarios) || draft.scenarios.length > 16)
    throw new InvalidFixtureDraft('Invalid fixture selection')
  const scenarios = draft.scenarios.map((scenario: unknown) => {
    if (!record(scenario) || !bounded(scenario.anchor, 40) || !Array.isArray(scenario.units))
      throw new InvalidFixtureDraft('Invalid fixture selection')
    if (!bounded(scenario.precondition, 1800))
      throw new InvalidFixtureDraft('Describe the precondition in one or two sentences, at most 1800 characters')
    const [fixture, anchor, extra] = scenario.anchor.split(':')
    const target = fixtures.find((_, index) => fixture === `f${index + 1}`)?.anchors.find((item) => item.id === anchor)
    if (
      !fixture ||
      !anchor ||
      extra !== undefined ||
      !target?.control ||
      target.control.length > 12000 ||
      !/\bexpect\s*[(.]/u.test(target.control)
    )
      throw new InvalidFixtureDraft('Unknown or unsupported selected fixture')
    return { units: scenario.units, fixture, anchor, precondition: scenario.precondition }
  })
  const checked = bindFixtureCases(sources, fixtures, {
    cases: scenarios.map((scenario) => ({ ...scenario, body: 'selection', baseline: 'pass' })),
    contextOnly: draft.contextOnly,
  })
  return { scenarios, contextOnly: checked.coverage.contextOnly }
}

export function validSelectionRecord(selection: FixtureSelection) {
  return (
    !!selection &&
    Array.isArray(selection.scenarios) &&
    selection.scenarios.length > 0 &&
    selection.scenarios.length <= 16 &&
    selection.scenarios.every(
      (s) =>
        s &&
        /^f[1-9]\d*$/u.test(s.fixture) &&
        /^t[1-9]\d*$/u.test(s.anchor) &&
        bounded(s.precondition, 1800) &&
        Array.isArray(s.units) &&
        s.units.length &&
        s.units.every((u) => typeof u === 'string' && /^r\d+\.\d+$/u.test(u)),
    ) &&
    Array.isArray(selection.contextOnly) &&
    selection.contextOnly.length <= 250 &&
    selection.contextOnly.every((c) => c && bounded(c.unit, 40) && bounded(c.reason, 1500))
  )
}

export function validateCoverageBinding(
  criteria: AcceptanceCriterion[],
  checks: Array<{ criterionId: string; fixture?: FixtureBinding }>,
  coverage: CoverageRecord,
) {
  if (
    !coverage ||
    !Array.isArray(coverage.sources) ||
    !coverage.sources.length ||
    coverage.sources.length > 100 ||
    !Array.isArray(coverage.contextOnly) ||
    coverage.contextOnly.length > 250
  )
    throw new Error('Invalid coverage binding')
  const units = sourceUnits(coverage.sources),
    byId = new Map(units.map((unit) => [unit.id, unit])),
    seen = new Set<string>(),
    exercised = new Set<string>()
  for (const check of checks) {
    const f = check.fixture,
      criterion = criteria.find((c) => c.id === check.criterionId)
    if (
      !f ||
      !criterion ||
      !validFixturePath(f.path) ||
      !/^[a-f0-9]{64}$/u.test(f.hash) ||
      !/^t[1-9]\d*$/u.test(f.anchor) ||
      !Array.isArray(f.units) ||
      !f.units.length ||
      new Set(f.units).size !== f.units.length
    )
      throw new Error('Invalid baseline fixture binding')
    const claims = f.units.map((id) => byId.get(id))
    if (
      !claims[0] ||
      claims.some((c) => !c || c.criterionId !== claims[0]!.criterionId) ||
      criterion.sourceRef !== claims[0].sourceRef ||
      criterion.text !== claims.map((c) => c!.text).join('\n')
    )
      throw new Error('Case source changed')
    exercised.add(claims[0].criterionId)
    for (const id of f.units) seen.add(id)
  }
  for (const note of coverage.contextOnly) {
    if (!note || !byId.has(note.unit) || seen.has(note.unit) || !bounded(note.reason, 1500))
      throw new Error('Invalid coverage note')
    seen.add(note.unit)
  }
  if (seen.size !== units.length || coverage.sources.some((c) => !exercised.has(c.id)))
    throw new Error('Incomplete fixture coverage')
}

/** Apply line edits against the immutable callback. Offsets always refer to the
 * displayed original; existing assertion statements must survive as statements. */
export function varyPublicFixture(control: string, edits: unknown): string {
  if (!Array.isArray(edits) || !edits.length || edits.length > 8)
    throw new InvalidFixtureDraft('Invalid public fixture variation')
  const lines = control.split('\n'),
    changes = edits
      .map((edit) => {
        if (
          !record(edit) ||
          !Number.isSafeInteger(edit.line) ||
          !Number.isSafeInteger(edit.deleteCount) ||
          typeof edit.insert !== 'string' ||
          edit.insert.length > 12000
        )
          throw new InvalidFixtureDraft('Invalid fixture edit')
        const start = Number(edit.line) - 1,
          count = Number(edit.deleteCount)
        if (start < 0 || start > lines.length || count < 0 || start + count > lines.length)
          throw new InvalidFixtureDraft('Fixture edit out of bounds')
        return { start, count, insert: edit.insert }
      })
      .sort((a, b) => b.start - a.start)
  let boundary = lines.length + 1
  for (const change of changes) {
    if (change.start >= boundary || change.start + change.count > boundary)
      throw new InvalidFixtureDraft('Overlapping fixture edits')
    lines.splice(change.start, change.count, ...(change.insert ? change.insert.split('\n') : []))
    boundary = change.start
  }
  const result = lines.join('\n')
  if (result === control || result.length > 64000) throw new InvalidFixtureDraft('Empty or oversized fixture variation')
  function assertions(body: string) {
    const file = ts.createSourceFile(
        'body.tsx',
        `async function exercise(){\n${body}\n}`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
      found: string[] = []
    function visit(node: ts.Node) {
      if (ts.isExpressionStatement(node) && /^(?:await\s+)?expect(?:\s*\(|\.)/u.test(node.getText(file)))
        found.push(node.getText(file))
      else ts.forEachChild(node, visit)
    }
    visit(file)
    return found
  }
  const expected = assertions(control),
    actual = assertions(result)
  if (!expected.length) throw new InvalidFixtureDraft('Public fixture has no supported original assertion')
  let at = 0
  for (const assertion of expected) {
    at = actual.indexOf(assertion, at)
    if (at < 0) throw new InvalidFixtureDraft('Variation removed or changed a public assertion')
    at++
  }
  return result
}
