'use client'

import { useRef, useState, type FormEvent } from 'react'
import type { CreateProjectResult } from './project-actions'

export function ProjectCreateForm({
  createAction,
  signInUrl,
  onCreated,
}: {
  createAction: (formData: FormData) => Promise<CreateProjectResult>
  signInUrl: string
  onCreated?: (projectId: string) => void
}) {
  const [result, setResult] = useState<CreateProjectResult | null>(null)
  const [isPending, setIsPending] = useState(false)
  const submissionInFlight = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInFlight.current) return
    const form = event.currentTarget
    const formData = new FormData(form)
    submissionInFlight.current = true
    setIsPending(true)
    setResult(null)
    try {
      const response = await createAction(formData)
      setResult(response)
      if (response.ok) {
        form.reset()
        onCreated?.(response.projectId)
      }
    } catch {
      setResult({ ok: false, error: '项目创建结果暂时无法确认。请先刷新项目列表检查，再决定是否重试。' })
    } finally {
      submissionInFlight.current = false
      setIsPending(false)
    }
  }

  return (
    <form className="project-create-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input name="name" placeholder="Agent Platform" readOnly={isPending} required />
      </label>
      <label>
        Slug
        <input name="slug" placeholder="agent-platform" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" readOnly={isPending} required />
      </label>
      <label>
        Repository
        <input name="repository" placeholder="erich/agent-platform" readOnly={isPending} required />
      </label>
      <label>
        Description
        <textarea name="description" placeholder="Pilot project for team delivery." readOnly={isPending} required />
      </label>
      <button disabled={isPending} type="submit">{isPending ? '创建中…' : 'Create project'}</button>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} aria-live="polite">
          {result.ok ? `项目「${result.projectName}」已创建，可以继续 Desktop 配对。` : result.error}
          {!result.ok && result.authenticationRequired ? (
            <> <a href={signInUrl} target="_blank" rel="noreferrer">重新登录 GitHub（新窗口）</a></>
          ) : null}
        </p>
      ) : null}
    </form>
  )
}
