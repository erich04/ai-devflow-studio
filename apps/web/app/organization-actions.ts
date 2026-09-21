'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { resolveDevFlowApiBaseUrl } from './lib/devflow-api'

export type OrganizationActionResult = { ok: true; data: unknown } | { ok: false; status: number; error: string }

export async function organizationAction(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<OrganizationActionResult> {
  // This action is intentionally not a general authenticated API proxy.
  if (!['GET', 'POST', 'PUT'].includes(method) || !/^\/api\/organizations(?:\/[A-Za-z0-9_-]+){0,4}$/.test(path)) return { ok: false, status: 400, error: '无效的组织操作。' }
  try {
    const cookieStore = await cookies()
    const session = cookieStore.get('devflow_session')?.value
    if (!session) return { ok: false, status: 401, error: '请先登录后再管理组织。' }
    const response = await fetch(`${resolveDevFlowApiBaseUrl()}${path}`, {
      method, cache: 'no-store', redirect: 'error',
      headers: { cookie: `devflow_session=${session}`, accept: 'application/json', 'content-type': 'application/json' },
      ...(method !== 'GET' && body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const data = await response.json() as unknown
    if (!response.ok) {
      const errors: Record<number, string> = {
        400: '请检查名称、标识、GitHub 账号 ID 和项目权限。',
        401: '登录已过期或成员资格已停用，请重新登录。',
        403: '当前账号没有此项权限，或组织已归档、入驻已关闭。',
        404: '组织、成员或邀请不可用；邀请可能已使用、撤销或过期。',
        409: '操作发生冲突：标识或成员可能已存在，也不能移除最后一位管理员。',
      }
      return { ok: false, status: response.status, error: errors[response.status] ?? '操作暂时失败，请刷新后核对结果再重试。' }
    }
    const setCookie = response.headers.get('set-cookie')
    if (setCookie?.startsWith('devflow_session=')) {
      const value = setCookie.split(';')[0]!.slice('devflow_session='.length)
      cookieStore.set('devflow_session', value, { httpOnly: true, sameSite: 'lax', path: '/', secure: /;\s*Secure(?:;|$)/i.test(setCookie), maxAge: 8 * 60 * 60 })
    }
    if (method !== 'GET') { revalidatePath('/'); revalidatePath('/organizations') }
    return { ok: true, data }
  } catch {
    return { ok: false, status: 503, error: '无法确认操作结果。请刷新核对后再重试，填写内容会保留。' }
  }
}
