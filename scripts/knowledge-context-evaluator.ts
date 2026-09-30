import {
  assembleKnowledgeStageContext,
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  createWorkflowRunFromRequest,
  lexicalKnowledgeRetriever,
  type NodeStage,
  type RepositoryKnowledgeSnapshot,
  type WorkflowNode,
  type WorkflowRun,
} from '../packages/shared/src/index.ts'

export type KnowledgeContextScenario = {
  id: string
  stage: NodeStage
  request: string
  /** Must be in the stage context in full. */
  required: string[]
  /** Must at least be listed in the catalogue. */
  available: string[]
  /** Exact set of documents the stage's knowledge governance checks list. */
  gate: string[]
}

function nodesFor(run: WorkflowRun, stage: NodeStage): { context: WorkflowNode; governance: WorkflowNode } {
  const stageNodes = run.nodes.filter((node) => node.stage === stage)
  const context = stageNodes.find((node) => node.kind !== 'gate') ?? stageNodes[0]!
  const governance = stageNodes.find((node) => node.kind === 'gate') ?? context
  return { context, governance }
}

export function evaluateKnowledgeContextScenarios(input: {
  snapshot: Pick<RepositoryKnowledgeSnapshot, 'documents' | 'chunks' | 'warnings' | 'knowledgeRoot' | 'projectInstructions'>
  scenarios: KnowledgeContextScenario[]
  mode: 'baseline-lexical' | 'resident-stage-context'
}) {
  const { snapshot } = input
  const pathById = new Map(snapshot.documents.map((document) => [document.id, document.sourcePath]))
  const rows = input.scenarios.map((scenario) => {
    const { run, artifacts } = createWorkflowRunFromRequest({
      runId: `eval-${scenario.id}`,
      title: scenario.request,
      request: scenario.request,
      projectId: 'evaluation',
      creatorId: 'u-eval',
      branchName: 'eval',
      now: '2026-09-29T00:00:00.000Z',
    })
    const { context, governance } = nodesFor(run, scenario.stage)
    let full: Set<string>
    let listed: Set<string>
    let contextBytes = 0
    if (input.mode === 'baseline-lexical') {
      const references = buildKnowledgeReferences({
        run, artifacts, documents: snapshot.documents, chunks: snapshot.chunks, testEvidence: [],
        targetNode: context, retriever: lexicalKnowledgeRetriever,
      })
      full = new Set(references.filter((reference) => reference.relation === 'cites')
        .map((reference) => pathById.get(reference.documentId) ?? reference.sourcePath ?? ''))
      listed = full
    } else {
      const assembled = assembleKnowledgeStageContext({
        stage: scenario.stage,
        documents: snapshot.documents,
        knowledgeRoot: snapshot.knowledgeRoot ?? null,
        projectInstructions: snapshot.projectInstructions ?? null,
        injectInstructions: true,
        canReadFiles: false,
      })
      full = new Set(assembled.manifest.included.map((entry) => entry.sourcePath))
      listed = new Set([...full, ...assembled.manifest.catalogued.map((entry) => entry.sourcePath)])
      contextBytes = assembled.manifest.usedBytes
    }
    const checks = buildKnowledgeGovernanceChecks({
      run, node: governance, artifacts, documents: snapshot.documents, chunks: snapshot.chunks, testEvidence: [],
      ...(input.mode === 'baseline-lexical' ? { retriever: lexicalKnowledgeRetriever } : {}),
    })
    const gateDocs = checks.map((check) => pathById.get(check.documentId) ?? check.documentId)
    const expectedGate = new Set(scenario.gate)
    const requiredHit = scenario.required.filter((sourcePath) => full.has(sourcePath)).length
    const availableHit = scenario.available.filter((sourcePath) => listed.has(sourcePath)).length
    return {
      id: scenario.id,
      stage: scenario.stage,
      requiredHit,
      requiredTotal: scenario.required.length,
      availableHit,
      availableTotal: scenario.available.length,
      fullDocuments: full.size,
      contextBytes,
      gateCount: gateDocs.length,
      gateExact: gateDocs.length === expectedGate.size && gateDocs.every((sourcePath) => expectedGate.has(sourcePath)),
      missing: [
        ...scenario.required.filter((sourcePath) => !full.has(sourcePath)),
        ...scenario.available.filter((sourcePath) => !listed.has(sourcePath)),
      ],
    }
  })
  const requiredTotal = rows.reduce((sum, row) => sum + row.requiredTotal, 0)
  const requiredHit = rows.reduce((sum, row) => sum + row.requiredHit, 0)
  const availableTotal = rows.reduce((sum, row) => sum + row.availableTotal, 0)
  const availableHit = rows.reduce((sum, row) => sum + row.availableHit, 0)
  return {
    mode: input.mode,
    corpus: 'knowledge-context-zh',
    indexedDocuments: snapshot.documents.length,
    indexedChunks: snapshot.chunks.length,
    snapshotWarnings: snapshot.warnings,
    projectInstructions: snapshot.projectInstructions
      ? { sourcePath: snapshot.projectInstructions.sourcePath, bytes: snapshot.projectInstructions.bytes }
      : null,
    scenarios: rows.length,
    requiredRecall: requiredTotal === 0 ? 1 : Number((requiredHit / requiredTotal).toFixed(3)),
    availableRecall: availableTotal === 0 ? 1 : Number((availableHit / availableTotal).toFixed(3)),
    scenariosWithAllRequired: rows.filter((row) => row.requiredHit === row.requiredTotal && row.availableHit === row.availableTotal).length,
    gateExactScenarios: rows.filter((row) => row.gateExact).length,
    gateCountByStage: Object.fromEntries([...new Set(rows.map((row) => row.stage))].map((stage) => [
      stage, rows.find((row) => row.stage === stage)!.gateCount,
    ])),
    maxContextBytesByStage: Object.fromEntries([...new Set(rows.map((row) => row.stage))].map((stage) => [
      stage, Math.max(...rows.filter((row) => row.stage === stage).map((row) => row.contextBytes)),
    ])),
    paidProviderCalls: 0,
    rows,
  }
}
