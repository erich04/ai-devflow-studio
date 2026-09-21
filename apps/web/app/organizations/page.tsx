import { cookies } from 'next/headers'
import { OrganizationManager, type OrganizationIndex } from '../OrganizationManager'
import { organizationAction } from '../organization-actions'
import { fetchAuthSession, fetchTeamOverview, resolveDevFlowApiBaseUrl, resolveDevFlowPublicApiBaseUrl } from '../lib/devflow-api'

export default async function OrganizationsPage() {
  const sessionCookie = (await cookies()).get('devflow_session')?.value
  const login = `${resolveDevFlowPublicApiBaseUrl()}/api/auth/github/start`
  if (!sessionCookie) return <main className="organization-page"><h1>组织管理</h1><p>请先登录，再查看自己加入的组织。</p><a href={login}>使用 GitHub 登录</a></main>
  const cookieHeader = `devflow_session=${sessionCookie}`
  try {
    const response = await fetch(`${resolveDevFlowApiBaseUrl()}/api/organizations`, { cache: 'no-store', headers: { cookie: cookieHeader } })
    if (!response.ok) throw new Error('Organization list unavailable')
    const initial = await response.json() as OrganizationIndex
    const session = await fetchAuthSession({ cookieHeader })
    const selected = initial.organizations.find(o => o.id === initial.selectedOrganizationId)
    const projects = selected?.status === 'active' ? (await fetchTeamOverview({ cookieHeader })).projects : []
    return <main className="organization-page"><a href="/">← 返回工作台</a><h1>组织与成员</h1><p>{session.user.name}{session.authentication.provider === 'github' && session.authentication.providerAccountId ? ` · GitHub 账号 ID：${session.authentication.providerAccountId}` : ' · 本地开发账号'}</p>
      <OrganizationManager initial={initial} projects={projects.map(p => ({ id: p.id, name: p.name }))} requestAction={organizationAction} />
    </main>
  } catch {
    return <main className="organization-page"><h1>暂时无法加载组织</h1><p>登录可能已过期、成员资格已停用，或服务暂不可用。组织管理需要 Postgres。</p><a href={login}>重新登录 GitHub</a> · <a href="/">返回工作台</a></main>
  }
}
