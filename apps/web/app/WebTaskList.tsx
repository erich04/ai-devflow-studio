import type { ReactNode } from 'react'
import type { Project, WorkflowRun } from '@ai-devflow/shared'
import { taskHref } from './studio-navigation'
import { StatusPill, statusTone } from './studio-ui'
import { formatWebTime, runStatusLabel } from './web-labels'

/** 项目任务 (plan S5, Q3): team requests and a read-only list of development tasks. */
export function WebTaskList({ project, runs, workRequests }: {
  project: Project
  runs: readonly WorkflowRun[]
  workRequests: ReactNode
}) {
  const active = runs.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status)).length
  const awaiting = runs.filter((run) => run.status === 'paused_at_gate').length
  return (
    <section className="studio-task-list" aria-label="项目任务">
      {workRequests}
      <section className="studio-task-list__runs" aria-label="开发任务">
        <header className="studio-section-heading compact">
          <div>
            <span>开发任务</span>
            <h2>{project.name}</h2>
            <p>共 {runs.length} 个 · 进行中 {active} 个 · 等待审批 {awaiting} 个。进度来自桌面端最近一次上传。</p>
          </div>
        </header>
        {runs.length ? (
          <ul className="studio-run-list">
            {runs.map((run) => {
              const current = run.nodes.find((node) => node.id === run.currentNodeId)
              return (
                <li key={run.id}>
                  <a href={taskHref(project.id, run.id)}>
                    <strong>{run.title}</strong>
                    <span>当前步骤：{current?.title ?? '未记录'}</span>
                    <small>更新于 {formatWebTime(run.updatedAt)}</small>
                  </a>
                  <StatusPill tone={statusTone(run.status)}>{runStatusLabel(run.status)}</StatusPill>
                </li>
              )
            })}
          </ul>
        ) : (
          <p>所选项目还没有开发任务。新建团队请求后，由已连接的桌面端领取并上传进度。</p>
        )}
      </section>
    </section>
  )
}
