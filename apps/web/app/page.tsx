import {
  AlertTriangle,
  CircleDot,
  FileText,
  Gauge,
  Github,
  ListChecks,
  Sparkles,
} from 'lucide-react'
import { cookies } from 'next/headers'
import {
  createDemoTeamSessionHeaders,
  resolveDevFlowRuntimeFlags,
  type DevFlowSessionHeaders,
  type GateCommand,
  type GitHubRepositoryBinding,
  type WorkRequest,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  fetchTeamOverview,
  fetchWorkRequests,
  fetchGateCommands,
  fetchGitHubDeliveryRequests,
  fetchGitHubRepositoryBinding,
  evaluateGateCommandSnapshot,
  DevFlowApiError,
  fetchAuthSession,
  resolveDevFlowPublicApiBaseUrl,
  runKnowledgeReview,
  type TeamOverviewResponse,
  type BrowserAuthSessionResponse,
  type GateCommandEvaluationSnapshot,
  type GitHubDeliveryRequestView,
} from './lib/devflow-api'
import { PairingCodePanel } from './PairingCodePanel'
import { WorkRequestPanel } from './WorkRequestPanel'
import { GitHubDeliveryApprovals, GitHubRepositoryBindingSettings } from './GitHubDeliveryPanel'
import { selectGateCommandTarget } from './gate-command-view-model'
import { ThemePreferenceControl } from './ThemePreferenceControl'
import { StudioManagement } from './StudioManagement'
import { ProjectCreateDialog } from './ProjectCreateDialog'
import { LegacyAnchorRedirect } from './LegacyAnchorRedirect'
import { WebTodoView } from './WebTodoView'
import { WebTaskList } from './WebTaskList'
import { WebTaskDetail } from './WebTaskDetail'
import { EmptyProductState, StatusPill, statusTone } from './studio-ui'
import { parseStudioLocation, studioHref, type StudioLocation, type StudioView } from './studio-navigation'
import { buildWebTodo, type DeliveryFacts } from './web-todo-view-model'
import { effectiveProjectRole, roleLabel, runStatusLabel, shortIdentifier } from './web-labels'

type PageSearchParams = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: Promise<PageSearchParams>
}

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

function getDemoSessionHeadersIfEnabled(): DevFlowSessionHeaders | undefined {
  return resolveDevFlowRuntimeFlags({
    DEVFLOW_ENABLE_DEMO_DATA: process.env.DEVFLOW_ENABLE_DEMO_DATA,
  }).demoDataEnabled
    ? createDemoTeamSessionHeaders()
    : undefined
}

async function runKnowledgeReviewAction(formData: FormData) {
  'use server'

  const runId = String(formData.get('runId') ?? '')
  const nodeId = String(formData.get('nodeId') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const providerId = String(formData.get('providerId') ?? '').trim()

  if (!runId || !nodeId || !projectId) return

  const cookieHeader = await getDevFlowCookieHeader()
  const sessionHeaders = cookieHeader ? undefined : getDemoSessionHeadersIfEnabled()
  await runKnowledgeReview({
    runId,
    nodeId,
    projectId,
    providerId,
    ...(cookieHeader ? { cookieHeader } : {}),
    ...(sessionHeaders ? { sessionHeaders } : {}),
  })
}

const viewTitles: Record<Exclude<StudioLocation['view'], 'task'>, { title: string; body: string }> = {
  todo: { title: '我的待办', body: '当前项目中等待你处理的审批、交付与异常。' },
  tasks: { title: '项目任务', body: '团队请求和开发任务的进度，只读；执行在桌面端完成。' },
  team: { title: '团队', body: '团队成员、各项目费用与最近的交付进度。' },
  settings: { title: '团队设置', body: '预算、策略、桌面连接和 GitHub 仓库绑定。桌面端更新团队数据后使用最新设置。' },
}

export default async function Page({ searchParams }: PageProps) {
  const apiBaseUrl = resolveDevFlowPublicApiBaseUrl()
  const cookieHeader = await getDevFlowCookieHeader()
  const sessionHeaders = cookieHeader ? undefined : getDemoSessionHeadersIfEnabled()
  const localAuthEnabled = resolveDevFlowRuntimeFlags({
    DEVFLOW_LOCAL_AUTH_ENABLED: process.env.DEVFLOW_LOCAL_AUTH_ENABLED,
  }).localDevelopmentAuthEnabled

  let overview: TeamOverviewResponse
  try {
    overview = await fetchTeamOverview({
      ...(cookieHeader ? { cookieHeader } : {}),
      ...(sessionHeaders ? { sessionHeaders } : {}),
    })
  } catch (error) {
    const authenticationRequired =
      error instanceof DevFlowApiError && error.status === 401
    return (
      <ErrorShell
        apiBaseUrl={apiBaseUrl}
        authenticationRequired={authenticationRequired}
        organizationUnavailable={error instanceof DevFlowApiError && error.status === 403}
        localAuthEnabled={localAuthEnabled}
      />
    )
  }
  // The moment this page read the team data; shown as its freshness (plan S5, Q2).
  const readAt = new Date().toISOString()

  let browserSession: BrowserAuthSessionResponse | null = null
  if (cookieHeader) {
    try {
      browserSession = await fetchAuthSession({ cookieHeader })
    } catch {
      browserSession = null
    }
  }

  const params = await searchParams
  const location = parseStudioLocation(params)
  const { activeProject, activeRun, projectRuns, selectionError } = resolvePageSelection(overview, params, location)
  const navView: StudioView = location.view === 'task' ? 'tasks' : location.view

  let workRequests: WorkRequest[] = []
  let workRequestLoadFailed = false
  let gateCommands: GateCommand[] = []
  let githubBinding: GitHubRepositoryBinding | null = null
  let githubDeliveries: GitHubDeliveryRequestView[] = []
  let deliveryFacts: DeliveryFacts = { status: 'not_loaded' }
  let gateEvaluation: GateCommandEvaluationSnapshot | null = null
  const needsDeliveries = location.view === 'todo' || (location.view === 'task' && Boolean(activeRun))
  const needsBinding = needsDeliveries && location.view === 'task' || (location.view === 'settings' && location.section === 'github')

  if (activeProject && location.view === 'tasks') {
    try {
      workRequests = await fetchWorkRequests({
        projectId: activeProject.id,
        ...(cookieHeader ? { cookieHeader } : {}),
        ...(sessionHeaders ? { sessionHeaders } : {}),
      })
    } catch {
      workRequestLoadFailed = true
    }
  }
  if (activeProject && cookieHeader && (needsDeliveries || needsBinding)) {
    try {
      const [loadedBinding, loadedDeliveries] = await Promise.all([
        needsBinding
          ? fetchGitHubRepositoryBinding({ projectId: activeProject.id, cookieHeader })
          : Promise.resolve(null),
        needsDeliveries
          ? fetchGitHubDeliveryRequests({ projectId: activeProject.id, cookieHeader })
          : Promise.resolve([]),
      ])
      githubBinding = loadedBinding
      githubDeliveries = loadedDeliveries
      deliveryFacts = { status: 'loaded', items: loadedDeliveries }
    } catch {
      deliveryFacts = { status: 'failed' }
    }
  }
  if (activeProject && activeRun && cookieHeader) {
    try {
      gateCommands = await fetchGateCommands({ projectId: activeProject.id, cookieHeader })
    } catch {
      gateCommands = []
    }
    const gateTarget = selectGateCommandTarget(activeRun)
    if (
      activeRun.status === 'paused_at_gate' &&
      gateTarget &&
      (gateTarget.node.status === 'running' || gateTarget.node.status === 'blocked')
    ) {
      try {
        gateEvaluation = await evaluateGateCommandSnapshot({
          projectId: activeProject.id,
          runId: activeRun.id,
          nodeId: gateTarget.commandNodeId,
          cookieHeader,
        })
      } catch {
        gateEvaluation = null
      }
    }
  }

  const role = activeProject ? effectiveProjectRole(browserSession, activeProject.id) : null
  const heading = location.view === 'task'
    ? { title: activeRun?.title ?? '任务不可用', body: activeRun?.request ?? selectionError ?? '' }
    : viewTitles[location.view]

  return (
    <main className="studio-shell">
      <aside className="studio-rail" aria-label="AI DevFlow 导航">
        <div className="studio-brand">
          <span aria-hidden="true">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>AI DevFlow</strong>
            <small>Studio</small>
          </div>
        </div>

        <nav className="studio-nav" aria-label="主导航">
          <a href={studioHref(activeProject?.id, 'todo')} aria-current={navView === 'todo' ? 'page' : undefined}><ListChecks size={16} />我的待办</a>
          <a href={studioHref(activeProject?.id, 'tasks')} aria-current={navView === 'tasks' ? 'page' : undefined}><CircleDot size={16} />项目任务</a>
          <a href={studioHref(activeProject?.id, 'team')} aria-current={navView === 'team' ? 'page' : undefined}><FileText size={16} />团队</a>
          <a href={studioHref(activeProject?.id, 'settings')} aria-current={navView === 'settings' ? 'page' : undefined}><Gauge size={16} />设置</a>
        </nav>

        <div className="studio-rail-footer">
          <span>{activeProject?.name ?? '未选择项目'}</span>
          <strong>{browserSession ? `${browserSession.user.name}${role ? ` · ${roleLabel(role)}` : ''}` : '未建立浏览器身份'}</strong>
        </div>
      </aside>

      <section className="studio-workspace">
        <header className="studio-topbar">
          <div>
            {location.view === 'task' ? (
              <div className="studio-run-kicker">
                <a href={studioHref(activeProject?.id, 'tasks')}>项目任务</a>
                <span>{activeRun ? `任务 ${shortIdentifier(activeRun.id)}` : '任务'}</span>
                {activeRun ? <StatusPill tone={statusTone(activeRun.status)}>{runStatusLabel(activeRun.status)}</StatusPill> : null}
              </div>
            ) : null}
            <h1>{heading.title}</h1>
            {heading.body ? <p>{heading.body}</p> : null}
          </div>
          <div className="studio-top-actions">
            {browserSession ? <a href="/organizations">组织与成员</a> : null}
            <ThemePreferenceControl />
            <BrowserSessionControls
              apiBaseUrl={apiBaseUrl}
              hasSessionCookie={Boolean(cookieHeader)}
              session={browserSession}
            />
          </div>
        </header>

        <section className="studio-selection" aria-label="项目选择">
          <div>
            <span>项目</span>
            {overview.projects.length > 0 ? (
              <nav aria-label="选择项目">
                {overview.projects.map((project) => (
                  <a
                    aria-current={project.id === activeProject?.id ? 'page' : undefined}
                    href={studioHref(project.id, navView, location.view === 'settings' ? location.section : undefined)}
                    key={project.id}
                  >
                    <strong>{project.name}</strong>
                    <small>{project.repository}</small>
                  </a>
                ))}
              </nav>
            ) : (
              <p>还没有团队项目。</p>
            )}
            {browserSession?.user.role === 'owner' ? <ProjectCreateDialog signInUrl={`${apiBaseUrl}/api/auth/github/start`} /> : <small>项目创建需要组织 Owner。</small>}
          </div>
        </section>

        {location.view === 'team' || location.view === 'settings' ? (
          <StudioManagement
            overview={overview}
            session={browserSession}
            project={activeProject}
            view={location.view}
            section={location.view === 'settings' ? location.section : 'budget'}
            {...(activeProject && browserSession ? {
              desktopConnection: (
                <PairingCodePanel
                  key={activeProject.id}
                  projectId={activeProject.id}
                  projectName={activeProject.name}
                  subject={(() => {
                    const membership = browserSession.projectMemberships?.find(
                      (candidate) => candidate.projectId === activeProject.id,
                    )
                    return membership
                      ? { userId: browserSession.user.id, userName: browserSession.user.name, role: membership.role }
                      : null
                  })()}
                />
              ),
            } : {})}
            {...(activeProject && cookieHeader && location.view === 'settings' && location.section === 'github' ? {
              githubRepository: deliveryFacts.status === 'failed' ? (
                <><h2>GitHub 仓库</h2><p>无法安全读取仓库绑定；没有授予任何发布权限。请稍后刷新。</p></>
              ) : (
                <GitHubRepositoryBindingSettings
                  key={`github-binding-${activeProject.id}`}
                  projectId={activeProject.id}
                  projectName={activeProject.name}
                  initialBinding={githubBinding}
                  canManage={role === 'owner'}
                />
              ),
            } : {})}
          />
        ) : !activeProject ? (
          <EmptyProductState
            title={selectionError ?? '还没有团队项目'}
            body={overview.projects.length ? '请先在上方选择一个项目。待办、任务和设置都按项目显示，不会回退到其他项目的数据。' : '由组织 Owner 创建团队项目后，这里会显示待办与任务。'}
          />
        ) : location.view === 'todo' ? (
          <>
            <LegacyAnchorRedirect projectId={activeProject.id} />
            <WebTodoView
              todo={buildWebTodo({
                project: activeProject,
                runs: projectRuns,
                members: overview.members,
                session: browserSession,
                deliveries: deliveryFacts,
                readAt,
              })}
            />
          </>
        ) : location.view === 'tasks' ? (
          <>
            <LegacyAnchorRedirect projectId={activeProject.id} />
            <WebTaskList
              project={activeProject}
              runs={projectRuns}
              workRequests={workRequestLoadFailed ? (
                <section className="work-request-panel" id="work-request" aria-label="团队请求">
                  <div>
                    <span>团队请求</span>
                    <h2>团队请求暂时不可用</h2>
                    <p>无法安全读取所选项目的团队请求，请稍后重试。</p>
                  </div>
                </section>
              ) : (
                <WorkRequestPanel
                  key={activeProject.id}
                  projectId={activeProject.id}
                  initialWorkRequests={workRequests}
                />
              )}
            />
          </>
        ) : activeRun ? (
          <WebTaskDetail
            project={activeProject}
            run={activeRun}
            overview={overview}
            session={browserSession}
            hasBrowserSession={Boolean(cookieHeader)}
            gateCommands={gateCommands}
            gateEvaluation={gateEvaluation}
            knowledgeReviewAction={runKnowledgeReviewAction}
            deliverySection={cookieHeader ? (
              deliveryFacts.status === 'failed' ? (
                <section className="github-delivery-panel" id="github-delivery" aria-label="交付审批">
                  <div className="studio-section-heading compact">
                    <div>
                      <span>交付审批</span>
                      <h2>交付请求暂时不可用</h2>
                      <p>无法安全读取仓库绑定和交付请求；没有授予任何发布权限。</p>
                    </div>
                  </div>
                </section>
              ) : (
                <GitHubDeliveryApprovals
                  key={`github-delivery-${activeProject.id}-${activeRun.id}`}
                  projectId={activeProject.id}
                  runId={activeRun.id}
                  binding={githubBinding}
                  initialDeliveries={githubDeliveries}
                  canDecide={role === 'lead' || role === 'owner'}
                />
              )
            ) : (
              <section className="github-delivery-panel" id="github-delivery" aria-label="交付审批">
                <p className="studio-notice" role="note">登录浏览器身份后才能读取交付请求。</p>
              </section>
            )}
          />
        ) : (
          <EmptyProductState
            title={selectionError ?? '任务不可用'}
            body="请从项目任务中重新选择；页面不会回退到其他项目或其他任务。"
          />
        )}
      </section>
    </main>
  )
}

function ErrorShell({
  apiBaseUrl,
  authenticationRequired,
  localAuthEnabled,
  organizationUnavailable = false,
}: {
  apiBaseUrl: string
  authenticationRequired: boolean
  localAuthEnabled: boolean
  organizationUnavailable?: boolean
}) {
  return (
    <main className="studio-shell studio-shell--error">
      <section className="studio-error-panel">
        <ThemePreferenceControl />
        <AlertTriangle size={28} />
        <span>DevFlow API</span>
        <h1>{authenticationRequired ? '需要登录' : organizationUnavailable ? '当前组织暂不可用' : '团队数据暂时不可用'}</h1>
        <p>
          {authenticationRequired
            ? '请先建立浏览器身份，再进入团队工作台。'
            : organizationUnavailable ? '当前组织可能已归档。可进入组织管理切换组织，或由管理员恢复。' : '无法连接 DevFlow API，请确认本地服务与数据库已经启动。'}
        </p>
        {authenticationRequired && localAuthEnabled ? (
          <form action={`${apiBaseUrl}/api/auth/local/start`} method="post">
            <button type="submit">使用本地开发身份</button>
          </form>
        ) : null}
        {authenticationRequired ? (
          <a href={`${apiBaseUrl}/api/auth/github/start`}>Sign in with GitHub</a>
        ) : null}
        <a href="/">重新加载工作台</a>
        <a href="/organizations">组织与成员</a>
      </section>
    </main>
  )
}

function BrowserSessionControls({
  apiBaseUrl,
  hasSessionCookie,
  session,
}: {
  apiBaseUrl: string
  hasSessionCookie: boolean
  session: BrowserAuthSessionResponse | null
}) {
  if (!hasSessionCookie) {
    return (
      <a className="studio-secondary-link" href={`${apiBaseUrl}/api/auth/github/start`}>
        <Github size={16} />
        Sign in with GitHub
      </a>
    )
  }

  const label = session
    ? session.authentication.provider === 'local-development'
      ? '本地开发身份 · 仅本机'
      : `${session.user.name} · GitHub`
    : '会话信息暂时不可用'
  return (
    <>
      <span className="studio-secondary-link">{label}</span>
      <form action="/api/auth/logout" method="post">
        <button type="submit">退出登录</button>
      </form>
    </>
  )
}

const byLatestUpdate = (left: WorkflowRun, right: WorkflowRun) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt)

function readSearchParam(searchParams: PageSearchParams | undefined, key: string) {
  const value = searchParams?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Project and task selection never falls back to another project or the latest task; a wrong
 * or foreign identifier is reported as such.
 */
function resolvePageSelection(
  overview: TeamOverviewResponse,
  searchParams: PageSearchParams | undefined,
  location: StudioLocation,
) {
  const requestedProjectId = readSearchParam(searchParams, 'projectId')

  if (overview.projects.length === 0) {
    return { activeProject: undefined, activeRun: undefined, projectRuns: [], selectionError: undefined }
  }
  if (!requestedProjectId) {
    return { activeProject: undefined, activeRun: undefined, projectRuns: [], selectionError: '请选择项目' }
  }

  const activeProject = overview.projects.find((project) => project.id === requestedProjectId)
  if (!activeProject) {
    return { activeProject: undefined, activeRun: undefined, projectRuns: [], selectionError: '所选项目不存在或无权访问' }
  }

  const projectRuns = overview.runs
    .filter((run) => run.projectId === activeProject.id)
    .sort(byLatestUpdate)
  if (location.view !== 'task') {
    return { activeProject, activeRun: undefined, projectRuns, selectionError: undefined }
  }

  const requestedRun = overview.runs.find((run) => run.id === location.runId)
  if (!requestedRun) {
    return { activeProject, activeRun: undefined, projectRuns, selectionError: '所选任务不存在或无权访问' }
  }
  if (requestedRun.projectId !== activeProject.id) {
    return { activeProject, activeRun: undefined, projectRuns, selectionError: '任务不属于所选项目' }
  }

  return { activeProject, activeRun: requestedRun, projectRuns, selectionError: undefined }
}
