import { pathToFileURL } from 'node:url'

export function resolveReleaseArtifactLabel(env = process.env) {
  if (env.GITHUB_REF?.startsWith('refs/tags/')) {
    const tag = env.GITHUB_REF_NAME?.trim()
    if (!tag) {
      throw new Error('GITHUB_REF_NAME is required for tagged release artifacts')
    }
    return tag
  }

  const runNumber = env.GITHUB_RUN_NUMBER?.trim()
  if (!runNumber || !/^\d+$/.test(runNumber)) {
    throw new Error('GITHUB_RUN_NUMBER must be a positive integer for manual release artifacts')
  }
  return `manual-${runNumber}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(resolveReleaseArtifactLabel())
}
