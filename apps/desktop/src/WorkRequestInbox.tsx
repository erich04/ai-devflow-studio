import type { WorkRequest } from '@ai-devflow/shared'

const statusLabels: Record<WorkRequest['status'], string> = {
  open: '待领取',
  claim_pending: '待恢复',
  materialized: '已创建本地任务',
  expired: '已过期',
  cancelled: '已取消',
}

function actionLabel(workRequest: WorkRequest): string {
  if (workRequest.status === 'claim_pending') {
    return '恢复本地任务'
  }
  if (workRequest.status === 'materialized') {
    return '打开本地任务'
  }
  return '创建本地任务'
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
    <section className="work-request-inbox" aria-label="团队请求">
      <div className="section-heading work-request-inbox__heading">
        <span>团队请求</span>
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
        <p className="empty-note">连接团队项目后可领取团队请求</p>
      ) : isLoading ? (
        <p className="empty-note">正在读取团队请求…</p>
      ) : error ? (
        <p className="empty-note" role="alert">{error}</p>
      ) : workRequests.length === 0 ? (
        <p className="empty-note">当前没有可领取的团队请求</p>
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
