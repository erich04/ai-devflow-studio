export default function Loading() {
  return (
    <main className="web-shell">
      <aside className="web-sidebar">
        <strong>AI DevFlow</strong>
        <span>Team Console</span>
      </aside>
      <section className="web-main" aria-busy="true">
        <header className="web-header">
          <div>
            <span>Team Overview</span>
            <h1>加载团队数据</h1>
          </div>
        </header>
        <section className="web-panel web-panel--wide">
          <div className="panel-title">
            <span>Loading</span>
            <strong>正在连接 DevFlow API</strong>
          </div>
        </section>
      </section>
    </main>
  )
}
