'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createTeamProject, DevFlowApiError } from '../lib/devflow-api'

export type CreateProjectResult =
  | { ok: true; projectName: string }
  | { ok: false; error: string; authenticationRequired?: boolean }

export async function createProjectAction(formData: FormData): Promise<CreateProjectResult> {
  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const repository = String(formData.get('repository') ?? '').trim()

  if (!name || !slug || !description || !repository) {
    return { ok: false, error: '请完整填写项目名称、Slug、仓库和描述。' }
  }

  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('devflow_session')?.value
    const project = await createTeamProject({
      name,
      slug,
      description,
      repository,
      ...(sessionCookie ? { cookieHeader: `devflow_session=${sessionCookie}` } : {}),
    })
    revalidatePath('/legacy-shell')
    revalidatePath('/')
    return { ok: true, projectName: project.name }
  } catch (error) {
    if (error instanceof DevFlowApiError) {
      if (error.status === 401) {
        return {
          ok: false,
          error: '登录已过期。请在新窗口重新登录，然后返回这里重试；填写内容已保留。',
          authenticationRequired: true,
        }
      }
      if (error.status === 403) return { ok: false, error: '当前账号没有创建项目的权限，需要组织 owner。' }
      if (error.status === 400) return { ok: false, error: '项目信息无效，请检查 Slug 和仓库格式后重试。' }
      if (error.status === 409) return { ok: false, error: '项目 Slug 已存在，请查看项目列表或使用其他 Slug。' }
    }
    return { ok: false, error: '项目创建结果暂时无法确认。请先刷新项目列表检查，再决定是否重试。' }
  }
}
