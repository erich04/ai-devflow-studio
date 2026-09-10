export type StudioView = 'workbench' | 'team' | 'settings'

export function studioHref(projectId?: string, view: StudioView = 'workbench', section?: 'budget' | 'policy'): string {
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (view !== 'workbench') params.set('view', view)
  if (view === 'settings' && section) params.set('section', section)
  return params.size ? `/?${params}` : '/'
}
