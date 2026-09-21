'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { OrganizationAccess, Role } from '@ai-devflow/shared'
import type { OrganizationActionResult } from './organization-actions'

export type OrganizationIndex = { selectedOrganizationId: string; multiOrganizationEnabled: boolean; organizations: OrganizationAccess[] }
type ProjectChoice = { id: string; name: string }
type Access = { role: Role; status: 'active' | 'disabled'; projects: { projectId: string; role: Role }[] }
type Member = Access & { userId: string; name: string; providerAccountId: string }
type Invitation = { id: string; providerAccountId: string; role: Role; expiresAt: string; consumedAt: string | null; revokedAt: string | null }
type AuditEvent = { id: string; action: string; subjectId: string; createdAt: string }
type RequestAction = (path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) => Promise<OrganizationActionResult>
const roleLabel: Record<Role, string> = { owner: '组织管理员', lead: '项目负责人', member: '普通成员' }
const projectRoleLabel: Record<Role, string> = { owner: '项目管理员', lead: '项目负责人', member: '普通成员' }

function readAccess(data: FormData, projects: ProjectChoice[]): Access {
  return {
    role: String(data.get('role')) as Role,
    status: String(data.get('status') ?? 'active') as Access['status'],
    projects: projects.flatMap(project => {
      const role = String(data.get(`project:${project.id}`) ?? '')
      return role ? [{ projectId: project.id, role: role as Role }] : []
    }),
  }
}

function AccessFields({ projects, current }: { projects: ProjectChoice[]; current?: Access }) {
  return <>
    <label>组织角色<select name="role" defaultValue={current?.role ?? 'member'}>{Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>成员状态<select name="status" defaultValue={current?.status ?? 'active'}><option value="active">启用</option>{current ? <option value="disabled">停用</option> : null}</select></label>
    <fieldset><legend>项目权限</legend><p>管理员可查看组织内所有项目；Desktop 配对仍需明确的项目权限。</p>
      {projects.length ? projects.map(project => <label key={project.id}>{project.name}<select name={`project:${project.id}`} defaultValue={current?.projects.find(p => p.projectId === project.id)?.role ?? ''}>
        <option value="">无访问权限</option>{Object.entries(projectRoleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>) : <p>当前组织尚无项目，可以加入组织后再分配项目。</p>}
    </fieldset>
  </>
}

export function OrganizationManager({ initial, projects, requestAction, onSelected = () => window.location.assign('/') }: {
  initial: OrganizationIndex; projects: ProjectChoice[]; requestAction: RequestAction; onSelected?: () => void
}) {
  const [index, setIndex] = useState(initial)
  const [requestPending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  // Before hydration, native form submission would bypass the server action.
  const pending = !ready || requestPending
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [createdToken, setCreatedToken] = useState<{ token: string; expiresAt: string } | null>(null)
  const selected = index.organizations.find(o => o.id === index.selectedOrganizationId)
  const base = `/api/organizations/${selected?.id}`
  const owner = selected?.role === 'owner'

  async function perform(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) {
    if (inFlight.current) return null
    inFlight.current = true; setPending(true); setError(''); setNotice('')
    try {
      const result = body === undefined ? await requestAction(path, method) : await requestAction(path, method, body)
      if (!result.ok) { setError(result.error); return null }
      return result
    } catch { setError('无法确认操作结果，请刷新后核对。'); return null }
    finally { inFlight.current = false; setPending(false) }
  }

  async function refreshIndex() {
    const result = await perform('/api/organizations', 'GET')
    if (result) setIndex(result.data as OrganizationIndex)
  }

  async function loadMembers() {
    const result = await perform(`${base}/members`, 'GET')
    if (result) setMembers((result.data as { members: Member[] }).members)
  }

  async function submit(event: FormEvent<HTMLFormElement>, run: (data: FormData) => Promise<void>) {
    event.preventDefault()
    await run(new FormData(event.currentTarget))
  }

  return <div className="organization-manager">
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <section aria-label="我的组织"><h2>我的组织</h2><p>切换只影响当前 Web 登录。Desktop 仍绑定原来的团队项目，需另外配对。</p>
      <div className="organization-cards">{index.organizations.map(organization => <article key={organization.id}>
        <h3>{organization.name}</h3><p>{roleLabel[organization.role]} · {organization.status === 'active' ? '可用' : '已归档'}</p><small>{organization.slug}</small>
        <details><summary>组织标识（供部署配置使用）</summary><code>{organization.id}</code></details>
        <button disabled={pending || organization.id === index.selectedOrganizationId} onClick={async () => {
          const result = await perform(`/api/organizations/${organization.id}/select`, 'POST')
          if (result) onSelected()
        }}>{organization.id === index.selectedOrganizationId ? '当前组织' : `切换到 ${organization.name}`}</button>
      </article>)}</div>
    </section>

    {index.multiOrganizationEnabled ? <section><h2>创建独立组织</h2><p>新组织从空白开始，拥有独立的项目、成员、策略和预算。</p>
      <form method="post" onSubmit={event => void submit(event, async data => {
        const result = await perform('/api/organizations', 'POST', { name: data.get('name'), slug: data.get('slug') })
        if (result) { await refreshIndex(); setNotice('组织已创建。点击上方对应的切换按钮即可进入。') }
      })}><fieldset disabled={pending}><label>组织名称<input name="name" required maxLength={120} /></label><label>组织标识<input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="my-team" /></label><button>创建组织</button></fieldset></form>
    </section> : <p>当前部署未开放新组织入驻，已有组织仍可正常切换和管理。</p>}

    <section><h2>接受成员邀请</h2><p>使用邀请指定的 GitHub 账号登录后，粘贴邀请凭据。接受后再切换到该组织。</p>
      <form method="post" onSubmit={event => void submit(event, async data => {
        const result = await perform('/api/organizations/invitations/accept', 'POST', { token: String(data.get('token') ?? '').trim() })
        if (result) { await refreshIndex(); setNotice('已加入组织，可以在上方切换。') }
      })}><fieldset disabled={pending}><label>邀请凭据<input name="token" type="password" autoComplete="off" required maxLength={100} /></label><button>接受邀请</button></fieldset></form>
    </section>

    {owner && selected ? <section aria-label="管理当前组织"><h2>管理「{selected.name}」</h2>
      <form method="post" key={`${selected.id}:${selected.status}:${selected.name}`} onSubmit={event => void submit(event, async data => {
        const result = await perform(base, 'PUT', { name: data.get('name'), status: data.get('status') })
        if (result) { await refreshIndex(); setNotice('组织设置已保存。归档后恢复使用，需要重新配对 Desktop。') }
      })}><fieldset disabled={pending}><label>当前组织名称<input name="name" defaultValue={selected.name} required maxLength={120} /></label>
        <label>组织状态<select name="status" defaultValue={selected.status}><option value="active">启用</option><option value="archived">归档</option></select></label>
        <p>归档会暂停团队访问并撤销配对凭据，保留全部数据。管理员可以恢复组织。</p><button>保存组织设置</button></fieldset></form>

      {selected.status === 'active' ? <><h3>邀请成员</h3><form method="post" onSubmit={event => void submit(event, async data => {
        setCreatedToken(null)
        const result = await perform(`${base}/invitations`, 'POST', { providerAccountId: data.get('providerAccountId'), ...readAccess(data, projects) })
        if (result) setCreatedToken(result.data as { token: string; expiresAt: string })
      })}><fieldset disabled={pending}><label>GitHub 账号 ID<input name="providerAccountId" inputMode="numeric" pattern="[1-9][0-9]{0,19}" required /></label>
        <p>填写对方在本页显示的数字账号 ID。它不会随 GitHub 用户名修改而改变。入驻关闭时，受邀人须已在本部署登录注册。</p><AccessFields projects={projects} /><button>生成成员邀请</button></fieldset></form>
        {createdToken ? <div role="status"><p>邀请凭据仅在本次生成后显示，有效期至 {new Date(createdToken.expiresAt).toLocaleString()}。请只交给受邀人。</p><code className="organization-secret">{createdToken.token}</code></div> : null}</> : null}

      <h3>现有成员</h3><button disabled={pending} onClick={() => void loadMembers()}>加载或刷新成员</button>
      {members?.map(member => <form method="post" key={`${member.userId}:${member.role}:${member.status}:${JSON.stringify(member.projects)}`} onSubmit={event => void submit(event, async data => {
        const result = await perform(`${base}/members/${member.userId}`, 'PUT', readAccess(data, projects))
        if (result) {
          if (member.userId === selected.userId) { onSelected(); return }
          await loadMembers(); setNotice('成员权限已保存；该成员的旧 Desktop 凭据已撤销。')
        }
      })}><h4>{member.name} · {member.providerAccountId}</h4><fieldset disabled={pending || selected.status === 'archived'}><AccessFields projects={projects} current={member} /><button>保存 {member.name} 的权限</button></fieldset></form>)}

      <h3>邀请记录</h3><button disabled={pending} onClick={async () => { const result = await perform(`${base}/invitations`, 'GET'); if (result) setInvitations((result.data as { invitations: Invitation[] }).invitations) }}>查看邀请记录</button>
      <ul>{invitations.map(invitation => <li key={invitation.id}>{invitation.providerAccountId} · {roleLabel[invitation.role]} · {invitation.consumedAt ? '已接受' : invitation.revokedAt ? '已撤销' : new Date(invitation.expiresAt).getTime() < Date.now() ? '已过期' : '待接受'}
        {!invitation.consumedAt && !invitation.revokedAt ? <button disabled={pending} onClick={async () => { const result = await perform(`${base}/invitations/${invitation.id}/revoke`, 'POST'); if (result) { setInvitations(list => list.filter(i => i.id !== invitation.id)); setNotice('邀请已撤销。') } }}>撤销此邀请</button> : null}</li>)}</ul>

      <h3>组织操作记录</h3><button disabled={pending} onClick={async () => { const result = await perform(`${base}/audit`, 'GET'); if (result) setAudit((result.data as { events: AuditEvent[] }).events) }}>查看最近操作记录</button>
      <ul>{audit.map(event => <li key={event.id}>{new Date(event.createdAt).toLocaleString()} · {event.action}</li>)}</ul>
    </section> : null}
  </div>
}
