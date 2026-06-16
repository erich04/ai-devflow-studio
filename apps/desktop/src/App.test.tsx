import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpServers as fixtureMcpServers, runs as fixtureRuns, validateTestCommandSafety } from '@ai-devflow/shared'
import { App } from './App'
import type { DevFlowDesktopApi, RunProjectTestsInput } from './desktop-api'

const localProject = {
  id: 'local-project-1',
  name: 'fixture-project',
  path: '/tmp/fixture-project',
  packageManager: 'pnpm' as const,
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-preference')
  Reflect.deleteProperty(window, 'aiDevFlowDesktop')
})

function installDesktopApi(overrides: Partial<DevFlowDesktopApi> = {}) {
  const api: DevFlowDesktopApi = {
    platform: 'test',
    loadState: vi.fn().mockResolvedValue({
      projects: [],
      runs: [],
      artifacts: [],
      events: [],
      testEvidence: [],
      settings: { themePreference: 'system' },
      mcpServers: [],
    }),
    selectLocalProject: vi.fn().mockResolvedValue(localProject),
    saveProjectTestCommand: vi.fn().mockImplementation(async ({ testCommand }) => ({
      ...localProject,
      testCommand,
      updatedAt: '2026-06-15T00:01:00.000Z',
    })),
    validateTestCommand: vi.fn().mockImplementation(async ({ testCommand }) =>
      validateTestCommandSafety(testCommand),
    ),
    runProjectTests: vi.fn().mockImplementation(async ({ run, nodeId }: RunProjectTestsInput) => {
      const evidence = {
        id: 'evidence-1',
        runId: run.id,
        nodeId,
        projectId: localProject.id,
        command: 'pnpm test -- --run',
        cwd: localProject.path,
        status: 'passed' as const,
        exitCode: 0,
        durationMs: 900,
        stdout: '8 tests passed',
        stderr: '',
        summary: 'Tests passed in 900ms',
        redacted: false,
        createdAt: '2026-06-15T00:02:00.000Z',
      }
      const artifact = {
        id: 'artifact-evidence-1',
        runId: run.id,
        nodeId,
        kind: 'test_report' as const,
        title: 'Local test evidence',
        summary: evidence.summary,
        content: '8 tests passed',
        redacted: false,
        updatedAt: evidence.createdAt,
      }
      const event = {
        id: 'event-evidence-1',
        runId: run.id,
        nodeId,
        sequence: 1,
        kind: 'test_result' as const,
        message: evidence.summary,
        timestamp: evidence.createdAt,
      }
      const updatedRun = {
        ...run,
        status: 'testing' as const,
        nodes: run.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, status: 'success' as const, artifactIds: [...node.artifactIds, artifact.id] }
            : node,
        ),
      }

      return {
        evidence,
        state: {
          projects: [{ ...localProject, testCommand: evidence.command }],
          runs: [updatedRun],
          artifacts: [artifact],
          events: [event],
          testEvidence: [evidence],
          settings: { themePreference: 'system' },
          mcpServers: [],
        },
      }
    }),
    createRun: vi.fn().mockImplementation(async (run) => run),
    saveRun: vi.fn().mockImplementation(async (run) => run),
    saveEvent: vi.fn().mockImplementation(async (event) => event),
    saveSettings: vi.fn().mockImplementation(async (settings) => ({
      themePreference: settings.themePreference ?? 'system',
    })),
    saveMcpServers: vi.fn().mockImplementation(async (servers) => servers),
    ...overrides,
  }

  Object.defineProperty(window, 'aiDevFlowDesktop', {
    configurable: true,
    value: api,
  })

  return api
}

describe('App', () => {
  it('toggles theme preference through the topbar control', () => {
    render(<App />)

    const button = screen.getByTestId('theme-toggle')
    expect(button).toHaveTextContent('跟随系统')

    fireEvent.click(button)
    expect(button).toHaveTextContent('浅色')
  })

  it('approves the selected lead gate and updates the toast', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    expect(screen.getByTestId('toast')).toHaveTextContent('架构 Gate 已通过')
  })

  it('creates a new run from the modal', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    expect(screen.getByText('重构 GitHub webhook 重试策略')).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toHaveTextContent('新 Run 已创建')
  })

  it('persists a newly created run through the desktop API', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /新建 Run/ }))
    fireEvent.click(screen.getByRole('button', { name: /创建并开始澄清/ }))

    await waitFor(() => expect(api.createRun).toHaveBeenCalled())
    expect(api.createRun).toHaveBeenCalledWith(expect.objectContaining({
      title: '重构 GitHub webhook 重试策略',
      status: 'clarifying',
    }))
    expect(screen.getByText('重构 GitHub webhook 重试策略')).toBeInTheDocument()
  })

  it('uses local runs without mixing fixture artifacts and events when SQLite has runs', async () => {
    installDesktopApi({
      loadState: vi.fn().mockResolvedValue({
        projects: [],
        runs: [{
          ...fixtureRuns[0]!,
          id: 'run-local-only',
          title: '本地持久化 Run',
          nodes: fixtureRuns[0]!.nodes.map((node) => ({ ...node, artifactIds: [] })),
        }],
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
      }),
    })
    render(<App />)

    await screen.findByText('本地持久化 Run')
    expect(screen.queryByText('为 Payments API 增加 /health 端点')).not.toBeInTheDocument()
    expect(screen.getByTestId('node-inspector')).not.toHaveTextContent('healthService.check()')
  })

  it('persists gate approval as a run update and approval event', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /通过 Gate/ }))

    await waitFor(() => expect(api.saveRun).toHaveBeenCalled())
    await waitFor(() => expect(api.saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'approval',
      message: expect.stringContaining('Gate 已通过'),
    })))
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('approval')
  })

  it('persists theme and MCP local preferences through the desktop API', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByTestId('theme-toggle'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ themePreference: 'light' }))

    fireEvent.click(screen.getByRole('button', { name: /^MCP$/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /Disable/ })[0]!)

    await waitFor(() =>
      expect(api.saveMcpServers).toHaveBeenCalledWith([
        expect.objectContaining({
          id: fixtureMcpServers[0]!.id,
          enabledLocally: false,
        }),
        ...fixtureMcpServers.slice(1).map((server) => expect.objectContaining({ id: server.id })),
      ]),
    )
  })

  it('filters runs and knowledge with the search box and shows empty states', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'health endpoint' },
    })

    expect(screen.getByText('为 Payments API 增加 /health 端点')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search runs and knowledge'), {
      target: { value: 'nothing matches this' },
    })
    expect(screen.getByText('没有匹配的 Run')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))
    expect(screen.getByText('没有匹配的知识节点')).toBeInTheDocument()
  })

  it('selects a local project, saves an editable test command, and archives local test evidence', async () => {
    const api = installDesktopApi()
    render(<App />)

    await waitFor(() => expect(api.loadState).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')

    const commandInput = screen.getByLabelText('测试命令')
    fireEvent.change(commandInput, { target: { value: 'pnpm test -- --run' } })
    fireEvent.click(screen.getByRole('button', { name: /保存测试命令/ }))

    await waitFor(() =>
      expect(api.saveProjectTestCommand).toHaveBeenCalledWith({
        projectId: 'local-project-1',
        testCommand: 'pnpm test -- --run',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))
    await waitFor(() => expect(api.runProjectTests).toHaveBeenCalled())
    await screen.findByText('Local test evidence')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('8 tests passed')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('Exit code 0')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('900ms')
    expect(screen.getByTestId('tests-view')).toHaveTextContent('Redacted no')
    expect(screen.getByTestId('toast')).toHaveTextContent('测试通过，证据已归档')
  })

  it('shows command safety feedback and blocks dangerous test commands before execution', async () => {
    const api = installDesktopApi()
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /选择本地仓库/ }))
    await screen.findByText('fixture-project')

    fireEvent.change(screen.getByLabelText('测试命令'), { target: { value: 'rm -rf /tmp/devflow' } })
    await screen.findByText(/blocked/i)

    fireEvent.click(screen.getByRole('button', { name: /保存测试命令/ }))
    fireEvent.click(screen.getByRole('button', { name: /执行测试/ }))

    expect(api.runProjectTests).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast')).toHaveTextContent('测试命令已阻断')
  })
})
