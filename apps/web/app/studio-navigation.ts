/**
 * Web control-plane navigation (plan S5, Q1): 我的待办, 项目任务, 团队, 设置. A task detail is a
 * project task with a `runId`. Old links keep resolving: `projectId + runId` opens the task,
 * `view=team` and `view=settings` still parse, and the old `view=workbench` means the task list.
 */
export type StudioView = 'todo' | 'tasks' | 'team' | 'settings'
export type StudioSettingsSection = 'budget' | 'policy' | 'desktop' | 'github'

export const studioSettingsSections: ReadonlyArray<{ id: StudioSettingsSection; label: string }> = [
  { id: 'budget', label: '预算' },
  { id: 'policy', label: '策略' },
  { id: 'desktop', label: '桌面连接' },
  { id: 'github', label: 'GitHub 仓库' },
]

export function studioHref(projectId?: string, view: StudioView = 'todo', section?: StudioSettingsSection): string {
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (view !== 'todo') params.set('view', view)
  if (view === 'settings' && section) params.set('section', section)
  return params.size ? `/?${params}` : '/'
}

/** The task detail; the optional anchor points at one of its sections. */
export function taskHref(projectId: string, runId: string, anchor?: string): string {
  const params = new URLSearchParams({ projectId, runId })
  return `/?${params}${anchor ? `#${anchor}` : ''}`
}

export type StudioLocation =
  | { view: 'todo' | 'tasks' | 'team'; section?: undefined; runId?: undefined }
  | { view: 'task'; runId: string; section?: undefined }
  | { view: 'settings'; section: StudioSettingsSection; runId?: undefined }

function readParam(params: Record<string, string | string[] | undefined> | undefined, key: string): string | undefined {
  const value = params?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseStudioLocation(params: Record<string, string | string[] | undefined> | undefined): StudioLocation {
  const view = readParam(params, 'view')
  if (view === 'team') return { view: 'team' }
  if (view === 'settings') {
    const section = readParam(params, 'section')
    return {
      view: 'settings',
      section: studioSettingsSections.some((candidate) => candidate.id === section)
        ? section as StudioSettingsSection
        : 'budget',
    }
  }
  const runId = readParam(params, 'runId')
  if (runId) return { view: 'task', runId }
  if (view === 'tasks' || view === 'workbench') return { view: 'tasks' }
  return { view: 'todo' }
}

/**
 * Anchors of the old single-page workbench that no longer exist outside a task. Task-detail
 * anchors (`human-gate`, `evidence-chain`, `agents`, `tests`, `github-delivery`, `runtime`,
 * `policy`) are kept on the task page itself.
 */
export function legacyAnchorTarget(projectId: string | undefined, anchor: string): string | null {
  if (anchor === 'runtime') return studioHref(projectId, 'settings', 'budget')
  if (anchor === 'policy') return studioHref(projectId, 'settings', 'policy')
  if (anchor === 'work-request') return `${studioHref(projectId, 'tasks')}#work-request`
  return null
}
