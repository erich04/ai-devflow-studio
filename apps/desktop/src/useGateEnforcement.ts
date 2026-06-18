import { useEffect, useState } from 'react'
import {
  canApproveGate,
  type AgentReviewResult,
  type Artifact,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type PolicySnapshot,
  type TeamMember,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'

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
  isLoading: boolean
  canApprove: boolean
  canSaveOverride: boolean
  saveOverride: (reason: string, provisional?: boolean) => Promise<void>
}

export function useGateEnforcement(input: {
  desktopApi: DevFlowDesktopApi | null
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  currentUser: TeamMember | undefined
  artifacts: Artifact[]
  agentReviews: AgentReviewResult[]
  testEvidence: TestEvidence[]
  onToast: (message: string) => void
}): GateEnforcementState {
  const {
    desktopApi,
    selectedRun,
    selectedNode,
    currentUser,
    artifacts,
    agentReviews,
    testEvidence,
    onToast,
  } = input
  const [policySnapshot, setPolicySnapshot] = useState<PolicySnapshot | null>(null)
  const [decision, setDecision] = useState<GateEnforcementDecision | null>(null)
  const [overrides, setOverrides] = useState<GateOverrideDecision[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!desktopApi || !selectedRun || !selectedNode) {
      setPolicySnapshot(null)
      setDecision(null)
      setOverrides([])
      return
    }

    let disposed = false
    setIsLoading(true)
    const api = desktopApi
    const run = selectedRun
    const node = selectedNode

    async function loadGateEnforcement() {
      const snapshot = await api.loadEnforcementPolicy({ projectId: run.projectId })
      const reconciledOverrides = await api.listGateOverrides({ runId: run.id })
      const evaluated = await api.evaluateGateEnforcement({
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
      })

      if (disposed) {
        return
      }

      setPolicySnapshot(snapshot)
      setOverrides(reconciledOverrides)
      setDecision(evaluated)
    }

    loadGateEnforcement()
      .catch((error: unknown) => {
        if (!disposed) {
          onToast(error instanceof Error ? error.message : '加载 Gate Enforcement 失败')
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [
    artifacts.length,
    desktopApi,
    selectedNode?.id,
    selectedRun?.id,
    selectedRun?.projectId,
    agentReviews.length,
    testEvidence.length,
    onToast,
  ])

  async function saveOverride(reason: string, provisional = false) {
    if (!desktopApi || !selectedRun || !selectedNode || !decision || !currentUser) {
      return
    }

    try {
      const override = await desktopApi.saveGateOverride({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedRun.projectId,
        userId: currentUser.id,
        role: currentUser.role,
        reason,
        blockedReasonIds: decision.blockingReasons.map((item) => item.id),
        policyVersion: decision.policyVersion,
        provisional,
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

  return {
    policySnapshot,
    decision,
    overrides,
    isLoading,
    canApprove,
    canSaveOverride,
    saveOverride,
  }
}
