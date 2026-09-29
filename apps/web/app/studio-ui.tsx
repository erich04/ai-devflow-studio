import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Code2,
  Database,
  GitBranch,
  ShieldCheck,
  TestTube2,
  TimerReset,
  XCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { NodeStatus, WorkflowNode, WorkflowRun } from '@ai-devflow/shared'
import { nodeStatusLabel, stageLabel } from './web-labels'

export type StatusTone = 'done' | 'run' | 'gate' | 'warn' | 'idle' | 'fail'

export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`studio-status-pill is-${tone}`}>{children}</span>
}

export function statusTone(status: WorkflowRun['status']): StatusTone {
  if (status === 'paused_at_gate') return 'gate'
  if (status === 'completed') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'fail'
  if (status === 'created') return 'idle'
  return 'run'
}

export function nodeTone(status: NodeStatus): StatusTone {
  if (status === 'success' || status === 'skipped') return 'done'
  if (status === 'running') return 'run'
  if (status === 'blocked') return 'gate'
  if (status === 'failed') return 'fail'
  return 'idle'
}

function nodeIcon(node: WorkflowNode) {
  if (node.status === 'success') return <CheckCircle2 size={18} />
  if (node.status === 'failed') return <XCircle size={18} />
  if (node.kind === 'gate') return <ShieldCheck size={18} />
  if (node.kind === 'test') return <TestTube2 size={18} />
  if (node.kind === 'task') return <Code2 size={18} />
  if (node.kind === 'pr') return <GitBranch size={18} />
  if (node.kind === 'acceptance') return <ClipboardCheck size={18} />
  if (node.status === 'running') return <TimerReset size={18} />
  return <CircleDot size={18} />
}

export function EvidenceStep({
  node,
  current,
  evidenceCount,
}: {
  node: WorkflowNode
  current: boolean
  evidenceCount: number
}) {
  return (
    <article className={`studio-evidence-step is-${nodeTone(node.status)} ${current ? 'is-current' : ''}`}>
      <div className="studio-step-marker">{nodeIcon(node)}</div>
      <div className="studio-step-body">
        <div className="studio-step-head">
          <span>{stageLabel(node.stage)}</span>
          <StatusPill tone={nodeTone(node.status)}>{nodeStatusLabel(node.status)}</StatusPill>
        </div>
        <h3>{node.title}</h3>
        <p>{node.subtitle}</p>
        <div className="studio-step-meta">
          <span>重试 {node.retryCount} 次</span>
          <span>证据 {evidenceCount} 项</span>
          {current ? <span>当前步骤</span> : null}
        </div>
      </div>
    </article>
  )
}

export function SupportPanel({
  id,
  icon,
  title,
  action,
  actionHref,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  action?: string
  actionHref?: string
  children: ReactNode
}) {
  return (
    <section className="studio-support-panel" id={id} aria-label={title}>
      <header>
        <span>
          {icon}
          {title}
        </span>
        {action && actionHref ? (
          <a href={actionHref}>
            {action}
            <ArrowRight size={14} />
          </a>
        ) : action ? <small>{action}</small> : null}
      </header>
      <div className="studio-support-body">{children}</div>
    </section>
  )
}

export function CompactRow({ title, meta, value }: { title: string; meta: string; value: string }) {
  return (
    <article className="studio-compact-row">
      <div>
        <strong>{title}</strong>
        <p>{meta}</p>
      </div>
      <span>{value}</span>
    </article>
  )
}

export function EmptyProductState({ title, body }: { title: string; body: string }) {
  return (
    <div className="studio-empty-state">
      <Database size={24} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}
