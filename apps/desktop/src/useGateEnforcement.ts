import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  buildRemediationPlan,
  canApproveGate,
  projectKnowledgeReferencesForNode,
  type AgentReviewResult,
  type Artifact,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type KnowledgeGovernanceCheck,
  type KnowledgeReference,
  type PolicySnapshot,
  type RemediationPlan,
  type TeamMember,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'
import type { PendingInspectorAction } from './app/node-inspector-view-model'

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const map = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return Array.from(map.values())
}

export type GateEnforcementState = {
  policySnapshot: PolicySnapshot | null
  decision: GateEnforcementDecision | null
  overrides: GateOverrideDecision[]
  remediationPlan: RemediationPlan | null
  isLoading: boolean
  refresh: () => Promise<PolicySnapshot | null>
  canApprove: boolean
  canSaveOverride: boolean
  saveOverride: (reason: string) => Promise<void>
}

export function useGateEnforcement(input: {
  desktopApi: DevFlowDesktopApi | null
  isEnabled?: boolean
  projectId?: string | undefined
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  currentUser: TeamMember | undefined
  artifacts: Artifact[]
  agentReviews: AgentReviewResult[]
  testEvidence: TestEvidence[]
  governanceChecks: KnowledgeGovernanceCheck[]
  knowledgeReferences: KnowledgeReference[]
  knowledgeContentHash: string
  pendingInspectorAction: PendingInspectorAction | null
  setPendingInspectorAction: Dispatch<SetStateAction<PendingInspectorAction | null>>
  onToast: (message: string) => void
}): GateEnforcementState {
  const {
    desktopApi,
    isEnabled = true,
    selectedRun,
    selectedNode,
    currentUser,
    artifacts,
    agentReviews,
    testEvidence,
    governanceChecks,
    knowledgeReferences,
    knowledgeContentHash,
    pendingInspectorAction,
    setPendingInspectorAction,
    onToast,
  } = input
  const [policySnapshot, setPolicySnapshot] = useState<PolicySnapshot | null>(null)
  const [snapshotProjectId, setSnapshotProjectId] = useState<string | undefined>()
  const [decision, setDecision] = useState<GateEnforcementDecision | null>(null)
  const [overrides, setOverrides] = useState<GateOverrideDecision[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const projectId = input.projectId ?? selectedRun?.projectId
  const refreshGeneration = useRef(0)

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    setDecision(null)
    setOverrides([])
    if (!desktopApi || !projectId) {
      setPolicySnapshot(null)
      setIsLoading(false)
      return null
    }

    setIsLoading(true)
    try {
      const snapshot = await desktopApi.loadEnforcementPolicy({ projectId })
      if (generation !== refreshGeneration.current) return null
      setPolicySnapshot(snapshot)
      setSnapshotProjectId(projectId)
      if (isEnabled && selectedRun && selectedNode) {
        const [reconciledOverrides, evaluated] = await Promise.all([
          desktopApi.listGateOverrides({ runId: selectedRun.id }),
          desktopApi.evaluateGateEnforcement({
            runId: selectedRun.id,
            nodeId: selectedNode.id,
            projectId: selectedRun.projectId,
          }),
        ])
        if (generation !== refreshGeneration.current) return null
        setOverrides(reconciledOverrides)
        setDecision(evaluated)
      }
      return snapshot
    } finally {
      if (generation === refreshGeneration.current) setIsLoading(false)
    }
  }, [
    artifacts.length,
    desktopApi,
    isEnabled,
    projectId,
    knowledgeContentHash,
    selectedNode?.id,
    selectedRun?.id,
    selectedRun?.projectId,
    selectedRun?.version,
    selectedNode?.status,
    agentReviews.length,
    testEvidence.length,
  ])

  useEffect(() => {
    let disposed = false
    void refresh().catch((error: unknown) => {
      if (!disposed) onToast(error instanceof Error ? error.message : '加载 Gate Enforcement 失败')
    })
    return () => {
      disposed = true
      refreshGeneration.current += 1
    }
  }, [refresh, onToast])

  async function saveOverride(reason: string) {
    if (!desktopApi || !selectedRun || !selectedNode || !decision || !currentUser) {
      return
    }

    if (pendingInspectorAction) {
      onToast('其他 Inspector 操作正在进行中，请稍后再试')
      return
    }

    const pending: PendingInspectorAction = {
      actionId: 'saveGateOverride',
      runId: selectedRun.id,
      nodeId: selectedNode.id,
    }
    setPendingInspectorAction(pending)
    onToast('正在保存 Gate Override...')

    try {
      const override = await desktopApi.saveGateOverride({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        reason,
      })
      setOverrides((previous) => mergeById(previous, [override]))
      const evaluated = await desktopApi.evaluateGateEnforcement({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedRun.projectId,
      })
      setDecision(evaluated)
      if (override.status === 'rejected') {
        onToast('Gate override 已被团队策略拒绝，请重新评估后处理')
      } else {
        onToast(override.provisional ? '临时 override 已保存，等待团队确认' : 'Lead override 已保存')
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存 Gate override 失败')
    } finally {
      setPendingInspectorAction((current) =>
        current &&
        current.actionId === pending.actionId &&
        current.runId === pending.runId &&
        current.nodeId === pending.nodeId
          ? null
          : current,
      )
    }
  }

  const roleCanApprove = selectedNode ? canApproveGate(currentUser?.role ?? 'member', selectedNode) : false
  const policyAllowsApproval = decision ? !decision.blocksApproval : true
  const canApprove = roleCanApprove && policyAllowsApproval
  const canSaveOverride = Boolean(
    selectedRun &&
      selectedNode &&
      currentUser?.role === 'lead' &&
      currentUser.id !== selectedRun.creatorId &&
      currentUser.id !== selectedNode.ownerId,
  )
  const remediationPlan = useMemo(() => {
    if (!selectedRun || !selectedNode || !decision) {
      return null
    }

    return buildRemediationPlan({
      run: selectedRun,
      node: selectedNode,
      decision,
      governanceChecks,
      agentPolicyFindings: agentReviews
        .filter((review) => review.runId === selectedRun.id && review.nodeId === selectedNode.id)
        .flatMap((review) => review.policyFindings),
      testEvidence,
      knowledgeReferences: projectKnowledgeReferencesForNode({
        node: selectedNode,
        references: knowledgeReferences,
        subjectArtifactIds: selectedNode.artifactIds,
        testEvidenceIds: testEvidence.map((evidence) => evidence.id),
      }),
      createdAt: new Date().toISOString(),
    })
  }, [agentReviews, decision, governanceChecks, knowledgeReferences, selectedNode, selectedRun, testEvidence])

  return {
    policySnapshot: snapshotProjectId === projectId ? policySnapshot : null,
    decision: isEnabled ? decision : null,
    overrides,
    remediationPlan,
    isLoading,
    refresh,
    canApprove,
    canSaveOverride,
    saveOverride,
  }
}
