import type { Database } from 'sql.js'
import { isActiveCodingAgentRunStatus, type CodingAgentRun, type ProviderCredentialMetadata, type ProviderRemovalCheck } from '@ai-devflow/shared'

function records<T>(db: Database, sql: string, values: string[]): T[] {
  return (db.exec(sql, values)[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as T)
}

export function inspectStoredProviderRemoval(db: Database, providerId: string): ProviderRemovalCheck {
  const credential = records<ProviderCredentialMetadata>(db,
    'select json from provider_credentials where provider_id = ?', [providerId])[0] ?? null
  const configurations = records<{ projectId: string }>(db,
    'select json from coding_runtime_configurations where provider_id = ?', [providerId])
  const codingRuns = records<CodingAgentRun>(db,
    "select json from coding_agent_runs where json_extract(json, '$.providerId') = ?", [providerId])
  const references: ProviderRemovalCheck['references'] = configurations.map((configuration) => {
    const project = records<{ name: string }>(db, 'select json from local_projects where id = ?', [configuration.projectId])[0]
    return {
      kind: 'coding_configuration', id: configuration.projectId, projectId: configuration.projectId,
      label: `项目配置：${project?.name ?? configuration.projectId}`,
      remediation: '先在该项目的 Coding Executor 配置中选择并保存其他 Provider。',
    }
  })
  for (const run of codingRuns.filter((run) => isActiveCodingAgentRunStatus(run.status))) {
    references.push({ kind: 'coding_run', id: run.id, projectId: run.projectId, remediation: '等待该 Coding Run 结束，或先取消执行。' })
  }
  const historicalRecordCount = ['agent_reviews', 'agent_traces', 'agent_token_usage', 'coding_agent_runs']
    .reduce((sum, table) => sum + Number(db.exec(
      `select count(*) from ${table} where json_extract(json, '$.providerId') = ?`, [providerId],
    )[0]?.values[0]?.[0] ?? 0), 0)
  return { providerId, credential, references, historicalRecordCount }
}
