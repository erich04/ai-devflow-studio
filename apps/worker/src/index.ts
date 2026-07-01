import { rollupTokenUsage, type TokenUsage } from '@ai-devflow/shared'

export function runCostRollupJob(tokenUsage: TokenUsage[] = []) {
  return {
    projectCost: rollupTokenUsage(tokenUsage, 'projectId'),
    memberCost: rollupTokenUsage(tokenUsage, 'userId'),
    generatedAt: new Date().toISOString(),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runCostRollupJob(), null, 2))
}
