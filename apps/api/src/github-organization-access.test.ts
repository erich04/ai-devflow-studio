import { expect, it } from 'vitest'
import { resolveGitHubRepositoryAssignments } from './github-organization-access'

it('accepts exact operator assignments and keeps the default empty', () => {
  expect(resolveGitHubRepositoryAssignments(undefined)).toEqual([])
  const assignment = { organizationId: 'org-a', installationId: '123', repositoryId: '456' }
  expect(resolveGitHubRepositoryAssignments(JSON.stringify([assignment]))).toEqual([assignment])
})

it.each([
  'invalid', '{}', '[null]',
  '[{"organizationId":"*","installationId":"123","repositoryId":"456"}]',
  '[{"organizationId":"org-a","installationId":"123","repositoryId":"0456"}]',
  '[{"organizationId":"org-a","installationId":"123","repositoryId":"456","allowAll":true}]',
  '[{"organizationId":"org-a","installationId":"123","repositoryId":"456"},{"organizationId":"org-b","installationId":"123","repositoryId":"456"}]',
])('rejects ambiguous or overbroad operator configuration: %s', value => {
  expect(() => resolveGitHubRepositoryAssignments(value)).toThrow('DEVFLOW_GITHUB_REPOSITORY_ASSIGNMENTS')
})
