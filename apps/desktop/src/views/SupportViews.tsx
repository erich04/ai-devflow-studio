import type { McpServerDefinition } from '@ai-devflow/shared'

/** 设置／扩展能力 (plan Y2): Skills keep their Gate, policy and evidence limits. */
export function SkillView() {
  return (
    <section className="page-list skill-view" data-testid="skill-view" aria-label="Skills">
      <div className="panel-head">
        <span className="panel-title">团队能力目录（Skills）</span>
        <span className="pill soft">Skills 不能绕过 Gate、策略与证据要求</span>
      </div>
      <div className="panel-body page-grid three">
        <p className="empty-note">未加载团队 Skills。更新团队数据后再显示能力目录。</p>
      </div>
    </section>
  )
}

/** 设置／扩展能力 (plan Y2): local MCP connectors; enabling semantics are unchanged. */
export function McpView({
  servers,
  onToggle,
}: {
  servers: McpServerDefinition[]
  onToggle: (id: string) => void
}) {
  return (
    <section className="page-list" data-testid="mcp-view" aria-label="MCP 连接器">
      <div className="panel-head">
        <span className="panel-title">本机工具连接器（MCP）</span>
        <span className="pill soft">只在本机执行，不是云端集成市场</span>
      </div>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>命令</th>
              <th>权限</th>
              <th>本机启用</th>
              <th>安全边界</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <p className="empty-note">未加载本地 MCP 连接器。</p>
                </td>
              </tr>
            ) : servers.map((server) => (
              <tr key={server.id}>
                <td><strong>{server.name}</strong></td>
                <td className="mono">{server.command}</td>
                <td title={server.permission}>{server.permission}</td>
                <td>
                  <span className={`pill ${server.enabledLocally ? 'good' : 'warn'}`} title={`enabledLocally: ${String(server.enabledLocally)}`}>
                    {server.enabledLocally ? '已启用' : '未启用'}
                  </span>
                </td>
                <td>{server.enabledLocally ? '仅限当前本地项目' : '需要明确启用'}</td>
                <td>
                  <button className="ghost-button" aria-label={`${server.enabledLocally ? '停用' : '启用'} ${server.name}`} onClick={() => onToggle(server.id)}>
                    {server.enabledLocally ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
