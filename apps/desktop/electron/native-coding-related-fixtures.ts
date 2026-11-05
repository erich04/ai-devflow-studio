import path from 'node:path'
import ts from 'typescript'
import { redactSensitiveText } from '@ai-devflow/shared'
import { privateAcceptancePath } from './native-coding-acceptance-context'
import type { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { fixtureTemplate, validFixturePath, type FixtureTemplate } from './native-coding-fixture-cases'

type Owner = { path: string; exports: string[]; source: string }
type NearbyFixture = { fixture: FixtureTemplate; owners: Owner[] }

/** A public regression command may cover a transport without ever entering the
 * requested feature. Look only in the same B directories for a named suite
 * that actually imports a project module bearing that name. These fixtures
 * are examples for the independent author, never new approved requirements. */
export async function relatedPublicFixtures(
  workspace: CodingCandidateWorkspace,
  targets: string[],
  objective: string,
): Promise<NearbyFixture[]> {
  const terms = new Set((objective.match(/[A-Za-z][A-Za-z0-9]{2,}/gu) ?? []).map((t) => t.toLowerCase()))
  if (!terms.size) return []
  const dirs = new Set(targets.map((f) => path.posix.dirname(f)))
  const named = new Set(targets)
  const paired = new Set(targets.map((f) => f.replace(/\.(?:test|spec)(\.[^.]+)$/u, '$1')))
  const files = workspace.identity.base.files.filter(
    (f) => dirs.has(path.posix.dirname(f.path)) && !privateAcceptancePath.test(f.path),
  )
  const modules = new Map<string, { file: (typeof files)[number]; terms: string[] }>()
  for (const file of files) {
    if (!/\.[jt]sx?$/u.test(file.path) || paired.has(file.path) || validFixturePath(file.path) || file.size > 128 * 1024)
      continue
    const stem = file.path.replace(/\.[jt]sx?$/u, '')
    const tokens = path.posix
      .basename(stem)
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((t) => terms.has(t))
    if (tokens.length) modules.set(stem, { file, terms: tokens })
  }
  if (!modules.size) return []
  const matched: NearbyFixture[] = []
  let readBudget = 8 * 1024 * 1024
  for (const file of files.filter((f) => validFixturePath(f.path) && !named.has(f.path)).slice(0, 384)) {
    if (file.size > 256 * 1024 || file.size > readBudget) continue
    readBudget -= file.size
    const bytes = await workspace.blob(file.hash)
    if (bytes.includes(0)) continue
    const source = bytes.toString('utf8')
    const imports = ts.preProcessFile(source, true, true).importedFiles
    const resolve = (specifier: string) =>
      specifier.startsWith('.')
        ? modules.get(path.posix.join(path.posix.dirname(file.path), specifier.replace(/\.[cm]?[jt]sx?$/u, '')))
        : undefined
    const used = imports.flatMap((i) => {
      const owner = resolve(i.fileName)
      return owner ? [{ owner, pos: i.pos }] : []
    })
    if (!used.length) continue
    const fixture = fixtureTemplate(file.path, source)
    if (fixture.hash !== file.hash || fixture.anchors.length > 500) continue
    const aliases = new Map<string, Set<string>>()
    for (const node of fixture.tree.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.importClause?.isTypeOnly)
        continue
      const owner = resolve(node.moduleSpecifier.text)
      if (!owner || !node.importClause) continue
      const names = aliases.get(owner.file.path) ?? new Set<string>()
      const { name, namedBindings } = node.importClause
      if (name) names.add(name.text)
      if (namedBindings && ts.isNamespaceImport(namedBindings)) names.add(namedBindings.name.text)
      else if (namedBindings) for (const item of namedBindings.elements) if (!item.isTypeOnly) names.add(item.name.text)
      aliases.set(owner.file.path, names)
    }
    const owners = new Set<(typeof used)[number]['owner']>()
    let selected = 0
    for (const anchor of fixture.anchors) {
      const scope = (anchor.suite ?? '').toLowerCase().split(/[^a-z0-9]+/u)
      const names = new Set(anchor.control?.match(/[\w$]+/gu) ?? [])
      const matches = used.filter(
        ({ owner, pos }) =>
          owner.terms.some((t) => scope.includes(t)) &&
          ((anchor.start <= pos && pos < anchor.end) || [...(aliases.get(owner.file.path) ?? [])].some((n) => names.has(n))),
      )
      if (!matches.length || selected >= 4) {
        anchor.selectable = false
        continue
      }
      if (!anchor.selectable) continue
      selected++
      for (const m of matches) owners.add(m.owner)
    }
    if (!selected) continue
    const details: Owner[] = []
    for (const m of [...owners].slice(0, 3)) {
      const text = redactSensitiveText((await workspace.blob(m.file.hash)).toString('utf8')).value
      const symbols = [...text.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const)\s+([\w$]+)/gu)]
        .slice(0, 25)
        .map((x) => x[1]!)
      details.push({
        path: m.file.path,
        exports: symbols,
        source: text.length <= 3200 ? text : text.slice(0, 1800) + '\n[... omitted ...]\n' + text.slice(-1200),
      })
    }
    matched.push({ fixture, owners: details })
    if (matched.length === 6) break
  }
  return matched
}
