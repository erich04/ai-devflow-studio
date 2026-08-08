import type { WorkRequest } from '@ai-devflow/shared'

const statusLabels: Record<WorkRequest['status'], string> = {
  open: '待领取',
  claim_pending: '待恢复',
  materialized: '已创建',
  expired: '已过期',
  cancelled: '已取消',
}

function actionLabel(workRequest: WorkRequest): string {
  if (workRequest.status === 'claim_pending') {
    return '恢复本地 Run'
  }
  if (workRequest.status === 'materialized') {
    return '打开本地 Run'
  }
  return '创建本地 Run'
}

export function WorkRequestInbox({
  workRequests,
  isPaired,
  isLoading,
  materializingId,
  error,
  onRefresh,
  onMaterialize,
}: {
  workRequests: WorkRequest[]
  isPaired: boolean
  isLoading: boolean
  materializingId: string | null
  error: string | null
  onRefresh: () => void
  onMaterialize: (workRequest: WorkRequest) => void
}) {
  return (
    <section className="work-request-inbox" aria-label="Work Request Inbox">
      <div className="section-heading work-request-inbox__heading">
        <span>Work Requests</span>
        <button
          className="ghost-button"
          type="button"
          onClick={onRefresh}
          disabled={!isPaired || isLoading}
        >
          刷新
        </button>
      </div>

      {!isPaired ? (
        <p className="empty-note">绑定 Team Project 后可领取工作请求</p>
      ) : isLoading ? (
        <p className="empty-note">正在加载 Work Requests…</p>
      ) : error ? (
        <p className="empty-note" role="alert">{error}</p>
      ) : workRequests.length === 0 ? (
        <p className="empty-note">当前没有可执行的 Work Request</p>
      ) : (
        <div className="work-request-inbox__list">
          {workRequests.map((workRequest) => {
            const isBusy = materializingId === workRequest.id
            const action = actionLabel(workRequest)
            return (
              <article className="work-request-row" key={workRequest.id}>
                <div className="work-request-row__summary">
                  <strong>{workRequest.title}</strong>
                  <span className="pill soft">{statusLabels[workRequest.status]}</span>
                  <small>v{workRequest.version}</small>
                </div>
                <p>{workRequest.request}</p>
                {workRequest.status !== 'expired' && workRequest.status !== 'cancelled' ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={materializingId !== null}
                    aria-label={`${isBusy ? '正在创建' : action}：${workRequest.title}`}
                    onClick={() => onMaterialize(workRequest)}
                  >
                    {isBusy ? '处理中…' : action}
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
