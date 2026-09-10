'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProjectCreateForm } from './ProjectCreateForm'
import { createProjectAction } from './project-actions'

export function ProjectCreateDialog({ signInUrl }: { signInUrl: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  return <>
    <button className="studio-secondary-link" ref={trigger} disabled={!ready} onClick={() => dialog.current?.showModal()}>创建团队项目</button>
    <dialog className="studio-project-dialog" ref={dialog} aria-labelledby="create-project-title" onClose={() => trigger.current?.focus()}>
      <header><h2 id="create-project-title">创建团队项目</h2><button type="button" aria-label="关闭创建项目" onClick={() => dialog.current?.close()}>关闭</button></header>
      <p>填写团队项目和已有仓库信息，创建后继续提交需求及 Desktop 配对。</p>
      <ProjectCreateForm createAction={createProjectAction} signInUrl={signInUrl} onCreated={(projectId) => {
        dialog.current?.close()
        router.push(`/?projectId=${encodeURIComponent(projectId)}`)
        router.refresh()
      }} />
    </dialog>
  </>
}
