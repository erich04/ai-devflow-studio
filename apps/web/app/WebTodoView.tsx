import type { TodoItem, WebTodo } from './web-todo-view-model'
import { describeTodoFreshness } from './web-todo-view-model'
import { formatWebTime } from './web-labels'

/** 我的待办 (plan S5, Q2): one row per decision, each with a single 「查看」. */
function TodoGroup({ title, items, empty }: { title: string; items: TodoItem[]; empty: string }) {
  return (
    <section className="studio-todo-group" aria-label={title}>
      <h2>{title}{items.length ? ` · ${items.length}` : ''}</h2>
      {items.length ? (
        <ul className="studio-todo-list">
          {items.map((item) => (
            <li key={item.id}>
              <article className={`studio-todo-row is-${item.responsibility}`} aria-label={`${item.label} · ${item.taskTitle}`}>
                <div className="studio-todo-row__main">
                  <strong>{item.label}</strong>
                  <span>{item.taskTitle}</span>
                </div>
                <dl className="studio-todo-row__facts">
                  <div><dt>请求方</dt><dd>{item.requester}</dd></div>
                  <div><dt>材料版本</dt><dd>{item.material}</dd></div>
                  <div><dt>更新时间</dt><dd><time dateTime={item.updatedAt}>{formatWebTime(item.updatedAt)}</time></dd></div>
                </dl>
                <span className="studio-todo-row__responsibility">{item.responsibilityLabel}</span>
                <a className="studio-todo-row__open" href={item.href} aria-label={`查看 ${item.taskTitle} 的${item.label}`}>查看</a>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-todo-empty">{empty}</p>
      )}
    </section>
  )
}

export function WebTodoView({ todo }: { todo: WebTodo }) {
  const decisions = todo.items.filter((item) => item.kind !== 'anomaly')
  const mine = decisions.filter((item) => item.responsibility === 'mine')
  const others = decisions.filter((item) => item.responsibility !== 'mine')
  const anomalies = todo.items.filter((item) => item.kind === 'anomaly')
  return (
    <section className="studio-todo" aria-label="我的待办">
      <p className="studio-freshness">{describeTodoFreshness(todo)}</p>
      {todo.notices.map((notice) => (
        <p key={notice} className="studio-notice" role="note">{notice}</p>
      ))}
      <TodoGroup
        title="需要你处理"
        items={mine}
        empty={todo.complete ? '当前项目没有需要你处理的审批。' : '已读取的数据中没有需要你处理的审批；列表不完整，见上方说明。'}
      />
      <TodoGroup title="其他待审批" items={others} empty="没有等待其他人处理的审批。" />
      <TodoGroup title="异常" items={anomalies} empty={todo.complete ? '没有失败或需要恢复的任务与交付。' : '已读取的数据中没有异常；列表不完整。'} />
    </section>
  )
}
