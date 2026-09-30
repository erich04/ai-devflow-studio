import { describe, expect, it } from 'vitest'
import {
  legacyAnchorTarget,
  parseStudioLocation,
  studioHref,
  studioSettingsSections,
  taskHref,
} from './studio-navigation'

describe('parseStudioLocation', () => {
  it('opens 我的待办 by default', () => {
    expect(parseStudioLocation(undefined)).toEqual({ view: 'todo' })
    expect(parseStudioLocation({})).toEqual({ view: 'todo' })
    expect(parseStudioLocation({ projectId: 'project-a' })).toEqual({ view: 'todo' })
  })

  it('falls back to 我的待办 for an unknown view', () => {
    expect(parseStudioLocation({ projectId: 'project-a', view: 'dashboard' })).toEqual({ view: 'todo' })
  })

  it('parses view=team', () => {
    expect(parseStudioLocation({ projectId: 'project-a', view: 'team' })).toEqual({ view: 'team' })
  })

  it('keeps view=team ahead of a runId', () => {
    expect(parseStudioLocation({ projectId: 'project-a', view: 'team', runId: 'run-1' })).toEqual({ view: 'team' })
  })

  it.each(studioSettingsSections.map((section) => section.id))('parses view=settings with section=%s', (section) => {
    expect(parseStudioLocation({ projectId: 'project-a', view: 'settings', section })).toEqual({
      view: 'settings',
      section,
    })
  })

  it('lists the four settings sections in order', () => {
    expect(studioSettingsSections.map((section) => section.id)).toEqual(['budget', 'policy', 'desktop', 'github'])
  })

  it('falls back to the budget section for an invalid, missing or array section', () => {
    expect(parseStudioLocation({ view: 'settings', section: 'billing' })).toEqual({ view: 'settings', section: 'budget' })
    expect(parseStudioLocation({ view: 'settings' })).toEqual({ view: 'settings', section: 'budget' })
    expect(parseStudioLocation({ view: 'settings', section: ['policy'] })).toEqual({ view: 'settings', section: 'budget' })
    expect(parseStudioLocation({ view: 'settings', section: '   ' })).toEqual({ view: 'settings', section: 'budget' })
  })

  it('trims a section value', () => {
    expect(parseStudioLocation({ view: 'settings', section: ' policy ' })).toEqual({ view: 'settings', section: 'policy' })
  })

  it('opens the task detail for projectId + runId', () => {
    expect(parseStudioLocation({ projectId: 'project-a', runId: 'run-1' })).toEqual({ view: 'task', runId: 'run-1' })
  })

  it('opens the task detail for a runId with view=workbench, view=tasks or view=todo', () => {
    expect(parseStudioLocation({ projectId: 'project-a', view: 'workbench', runId: 'run-1' })).toEqual({ view: 'task', runId: 'run-1' })
    expect(parseStudioLocation({ projectId: 'project-a', view: 'tasks', runId: 'run-1' })).toEqual({ view: 'task', runId: 'run-1' })
    expect(parseStudioLocation({ projectId: 'project-a', view: 'todo', runId: 'run-1' })).toEqual({ view: 'task', runId: 'run-1' })
  })

  it('trims a runId', () => {
    expect(parseStudioLocation({ runId: '  run-1  ' })).toEqual({ view: 'task', runId: 'run-1' })
  })

  it('opens the task list for view=workbench or view=tasks without a runId', () => {
    expect(parseStudioLocation({ projectId: 'project-a', view: 'workbench' })).toEqual({ view: 'tasks' })
    expect(parseStudioLocation({ projectId: 'project-a', view: 'tasks' })).toEqual({ view: 'tasks' })
  })

  it('ignores array and blank values', () => {
    expect(parseStudioLocation({ view: ['team'] })).toEqual({ view: 'todo' })
    expect(parseStudioLocation({ view: ['settings'], section: 'policy' })).toEqual({ view: 'todo' })
    expect(parseStudioLocation({ runId: ['run-1'] })).toEqual({ view: 'todo' })
    expect(parseStudioLocation({ view: 'tasks', runId: ['run-1', 'run-2'] })).toEqual({ view: 'tasks' })
    expect(parseStudioLocation({ view: '   ', runId: '   ' })).toEqual({ view: 'todo' })
    expect(parseStudioLocation({ view: 'workbench', runId: '' })).toEqual({ view: 'tasks' })
    expect(parseStudioLocation({ view: undefined, runId: undefined })).toEqual({ view: 'todo' })
  })

  it('trims a view value', () => {
    expect(parseStudioLocation({ view: ' team ' })).toEqual({ view: 'team' })
  })
})

describe('studioHref', () => {
  it('returns the root without a project or view', () => {
    expect(studioHref()).toBe('/')
    expect(studioHref(undefined, 'todo')).toBe('/')
    expect(studioHref('', 'todo')).toBe('/')
  })

  it('omits view=todo', () => {
    expect(studioHref('project-a')).toBe('/?projectId=project-a')
    expect(studioHref('project-a', 'todo')).toBe('/?projectId=project-a')
  })

  it('adds the view for tasks and team', () => {
    expect(studioHref('project-a', 'tasks')).toBe('/?projectId=project-a&view=tasks')
    expect(studioHref('project-a', 'team')).toBe('/?projectId=project-a&view=team')
    expect(studioHref(undefined, 'team')).toBe('/?view=team')
  })

  it('adds the section only for settings', () => {
    expect(studioHref('project-a', 'settings', 'policy')).toBe('/?projectId=project-a&view=settings&section=policy')
    expect(studioHref('project-a', 'settings')).toBe('/?projectId=project-a&view=settings')
    expect(studioHref('project-a', 'tasks', 'policy')).toBe('/?projectId=project-a&view=tasks')
  })

  it('encodes the project id', () => {
    expect(studioHref('project a/b&c=d', 'team')).toBe('/?projectId=project+a%2Fb%26c%3Dd&view=team')
  })

  it('round-trips through parseStudioLocation', () => {
    const href = studioHref('project-a', 'settings', 'github')
    const params = Object.fromEntries(new URLSearchParams(href.slice(2)))
    expect(parseStudioLocation(params)).toEqual({ view: 'settings', section: 'github' })
  })
})

describe('taskHref', () => {
  it('links the task detail by project and run', () => {
    expect(taskHref('project-a', 'run-1')).toBe('/?projectId=project-a&runId=run-1')
  })

  it('appends the section anchor', () => {
    expect(taskHref('project-a', 'run-1', 'human-gate')).toBe('/?projectId=project-a&runId=run-1#human-gate')
    expect(taskHref('project-a', 'run-1', 'github-delivery')).toBe('/?projectId=project-a&runId=run-1#github-delivery')
  })

  it('omits an empty anchor', () => {
    expect(taskHref('project-a', 'run-1', '')).toBe('/?projectId=project-a&runId=run-1')
  })

  it('encodes the project and run ids', () => {
    expect(taskHref('project a', 'run&1#x', 'evidence-chain')).toBe('/?projectId=project+a&runId=run%261%23x#evidence-chain')
  })

  it('round-trips through parseStudioLocation', () => {
    const href = taskHref('project-a', 'run-1', 'human-gate')
    const params = Object.fromEntries(new URLSearchParams(href.slice(2, href.indexOf('#'))))
    expect(parseStudioLocation(params)).toEqual({ view: 'task', runId: 'run-1' })
  })
})

describe('legacyAnchorTarget', () => {
  it('sends #runtime to settings › budget', () => {
    expect(legacyAnchorTarget('project-a', 'runtime')).toBe('/?projectId=project-a&view=settings&section=budget')
  })

  it('sends #policy to settings › policy', () => {
    expect(legacyAnchorTarget('project-a', 'policy')).toBe('/?projectId=project-a&view=settings&section=policy')
  })

  it('sends #work-request to the task list and keeps the anchor', () => {
    expect(legacyAnchorTarget('project-a', 'work-request')).toBe('/?projectId=project-a&view=tasks#work-request')
  })

  it('works without a project', () => {
    expect(legacyAnchorTarget(undefined, 'runtime')).toBe('/?view=settings&section=budget')
    expect(legacyAnchorTarget(undefined, 'work-request')).toBe('/?view=tasks#work-request')
  })

  it('returns null for task-detail and unknown anchors', () => {
    expect(legacyAnchorTarget('project-a', 'human-gate')).toBeNull()
    expect(legacyAnchorTarget('project-a', 'github-delivery')).toBeNull()
    expect(legacyAnchorTarget('project-a', 'unknown-anchor')).toBeNull()
    expect(legacyAnchorTarget('project-a', '')).toBeNull()
  })
})
