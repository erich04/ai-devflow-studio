import { lstat, readdir, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  )
}

export async function assertSelfContainedDirectory(rootDirectory) {
  const canonicalRoot = await realpath(rootDirectory)

  async function visit(relativeDirectory = '') {
    const absoluteDirectory = path.join(canonicalRoot, relativeDirectory)
    const entries = await readdir(absoluteDirectory)
    entries.sort()

    for (const name of entries) {
      const relativePath = path.join(relativeDirectory, name)
      const absolutePath = path.join(canonicalRoot, relativePath)
      const stats = await lstat(absolutePath)
      if (stats.isDirectory()) {
        await visit(relativePath)
        continue
      }
      if (!stats.isSymbolicLink()) continue

      const target = await readlink(absolutePath)
      if (path.isAbsolute(target)) {
        throw new Error(
          `Standalone artifact contains an absolute symlink: ${relativePath}`,
        )
      }
      const resolvedTarget = path.resolve(path.dirname(absolutePath), target)
      let canonicalTarget
      try {
        canonicalTarget = await realpath(resolvedTarget)
      } catch {
        throw new Error(
          `Standalone artifact contains a dangling symlink: ${relativePath}`,
        )
      }
      if (
        !isWithin(canonicalRoot, resolvedTarget) ||
        !isWithin(canonicalRoot, canonicalTarget)
      ) {
        throw new Error(
          `Standalone artifact symlink escapes its root: ${relativePath}`,
        )
      }
    }
  }

  await visit()
}
