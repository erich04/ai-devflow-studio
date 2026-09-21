import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { createDiagnosticLog } from '@ai-devflow/shared/node/diagnostic-log'

async function main() {
const { values } = parseArgs({ options: Object.fromEntries(
  ['file', 'id', 'from', 'to', 'operation', 'reason', 'project', 'run', 'export'].map((name) => [name, { type: 'string' as const }]),
) })
if (!values.file) throw new Error('Usage: pnpm exec tsx scripts/query-diagnostics.ts --file <diagnostics.json> [--id UUID] [--from ISO] [--to ISO] [--operation name] [--reason code] [--project id] [--run id] [--export new-file.json]')
for (const key of ['from', 'to']) if (values[key] && !Number.isFinite(Date.parse(values[key]!))) throw new Error('Invalid time filter')
const records = (await createDiagnosticLog(values.file).list()).filter((record) =>
  (!values.id || record.id === values.id) &&
  (!values.from || Date.parse(record.timestamp) >= Date.parse(values.from)) &&
  (!values.to || Date.parse(record.timestamp) <= Date.parse(values.to)) &&
  (!values.operation || record.operation === values.operation) &&
  (!values.reason || record.reason === values.reason) &&
  (!values.project || record.projectId === values.project) &&
  (!values.run || record.runId === values.run),
)
const output = JSON.stringify(records, null, 2)
if (values.export) await writeFile(values.export, output, { mode: 0o600, flag: 'wx' })
else process.stdout.write(output + '\n')

}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Diagnostics unavailable'); process.exitCode = 1 })
