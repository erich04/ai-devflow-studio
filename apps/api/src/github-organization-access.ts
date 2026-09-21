export type GitHubRepositoryAssignment = {
  organizationId: string
  installationId: string
  repositoryId: string
}

// Operator-owned configuration; organization owners cannot expand App authority.
export function resolveGitHubRepositoryAssignments(value: string | undefined): GitHubRepositoryAssignment[] {
  if (!value?.trim()) return []
  const invalid = () => new Error('DEVFLOW_GITHUB_REPOSITORY_ASSIGNMENTS must be a JSON array of unique organizationId, installationId and repositoryId assignments.')
  if (value.length > 64 * 1024) throw invalid()
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw invalid() }
  if (!Array.isArray(parsed) || parsed.length > 256) throw invalid()
  const repositories = new Set<string>()
  return parsed.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'installationId,organizationId,repositoryId'
      || typeof item.organizationId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(item.organizationId)
      || typeof item.installationId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(item.installationId)
      || typeof item.repositoryId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(item.repositoryId)
      || repositories.has(item.repositoryId)) throw invalid()
    repositories.add(item.repositoryId)
    return { organizationId: item.organizationId, installationId: item.installationId, repositoryId: item.repositoryId }
  })
}
