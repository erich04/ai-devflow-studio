import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, type DevFlowDesktopApi } from './ipc-contract.js'

function onIpcPayload<T>(channel: string, listener: (payload: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const desktopApi: DevFlowDesktopApi = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke(ipcChannels.loadState),
  loadDesktopPairing: () => ipcRenderer.invoke(ipcChannels.loadDesktopPairing),
  pairDesktop: (input) => ipcRenderer.invoke(ipcChannels.pairDesktop, input),
  loadRemoteSnapshot: (input) => ipcRenderer.invoke(ipcChannels.loadRemoteSnapshot, input),
  listWorkRequests: (input) => ipcRenderer.invoke(ipcChannels.listWorkRequests, input),
  materializeWorkRequest: (input) =>
    ipcRenderer.invoke(ipcChannels.materializeWorkRequest, input),
  loadRepositoryKnowledge: (input) =>
    ipcRenderer.invoke(ipcChannels.loadRepositoryKnowledge, input),
  refreshRepositoryKnowledge: (input) =>
    ipcRenderer.invoke(ipcChannels.refreshRepositoryKnowledge, input),
  retryRemoteSyncOperation: (input) =>
    ipcRenderer.invoke(ipcChannels.retryRemoteSyncOperation, input),
  selectLocalProject: () => ipcRenderer.invoke(ipcChannels.selectProject),
  getProjectGitStatus: (input) => ipcRenderer.invoke(ipcChannels.getProjectGitStatus, input),
  watchProjectGitStatus: (input) => ipcRenderer.invoke(ipcChannels.watchProjectGitStatus, input),
  unwatchProjectGitStatus: (input) => ipcRenderer.invoke(ipcChannels.unwatchProjectGitStatus, input),
  saveProjectTestCommand: (input) =>
    ipcRenderer.invoke(ipcChannels.saveProjectTestCommand, input),
  validateTestCommand: (input) => ipcRenderer.invoke(ipcChannels.validateTestCommand, input),
  runProjectTests: (input) => ipcRenderer.invoke(ipcChannels.runProjectTests, input),
  loadEnforcementPolicy: (input) => ipcRenderer.invoke(ipcChannels.loadEnforcementPolicy, input),
  evaluateGateEnforcement: (input) =>
    ipcRenderer.invoke(ipcChannels.evaluateGateEnforcement, input),
  createRun: (run) => ipcRenderer.invoke(ipcChannels.createRun, run),
  deleteRun: (input) => ipcRenderer.invoke(ipcChannels.deleteRun, input),
  startAgentRuntime: (input) => ipcRenderer.invoke(ipcChannels.startAgentRuntime, input),
  advanceAgentRuntime: (input) => ipcRenderer.invoke(ipcChannels.advanceAgentRuntime, input),
  cancelAgentRuntime: (input) => ipcRenderer.invoke(ipcChannels.cancelAgentRuntime, input),
  listAgentRuntimes: (input) => ipcRenderer.invoke(ipcChannels.listAgentRuntimes, input),
  getAgentRuntime: (input) => ipcRenderer.invoke(ipcChannels.getAgentRuntime, input),
  listCoordinationSessions: (input) =>
    ipcRenderer.invoke(ipcChannels.listCoordinationSessions, input),
  getCoordinationSession: (input) =>
    ipcRenderer.invoke(ipcChannels.getCoordinationSession, input),
  listAgentMemoryLifecycle: (input) =>
    ipcRenderer.invoke(ipcChannels.listAgentMemoryLifecycle, input),
  promoteAgentMemoryCandidate: (input) =>
    ipcRenderer.invoke(ipcChannels.promoteAgentMemoryCandidate, input),
  reviseAgentMemory: (input) =>
    ipcRenderer.invoke(ipcChannels.reviseAgentMemory, input),
  deleteAgentMemory: (input) =>
    ipcRenderer.invoke(ipcChannels.deleteAgentMemory, input),
  completeWorkflowAgentNode: (input) =>
    ipcRenderer.invoke(ipcChannels.completeWorkflowAgentNode, input),
  createPrDraft: (input) => ipcRenderer.invoke(ipcChannels.createPrDraft, input),
  prepareGitHubDelivery: (input) =>
    ipcRenderer.invoke(ipcChannels.prepareGitHubDelivery, input),
  reviseGitHubDelivery: (input) =>
    ipcRenderer.invoke(ipcChannels.reviseGitHubDelivery, input),
  retryGitHubDelivery: (input) =>
    ipcRenderer.invoke(ipcChannels.retryGitHubDelivery, input),
  resumeGitHubDelivery: (input) =>
    ipcRenderer.invoke(ipcChannels.resumeGitHubDelivery, input),
  stopGitHubDelivery: (input) =>
    ipcRenderer.invoke(ipcChannels.stopGitHubDelivery, input),
  verifyGitHubDeliveryRevocation: (input) =>
    ipcRenderer.invoke(ipcChannels.verifyGitHubDeliveryRevocation, input),
  createAcceptanceBundle: (input) =>
    ipcRenderer.invoke(ipcChannels.createAcceptanceBundle, input),
  approveGate: (input) => ipcRenderer.invoke(ipcChannels.approveGate, input),
  saveGateOverride: (input) => ipcRenderer.invoke(ipcChannels.saveGateOverride, input),
  listGateOverrides: (input) => ipcRenderer.invoke(ipcChannels.listGateOverrides, input),
  saveSettings: (settings) => ipcRenderer.invoke(ipcChannels.saveSettings, settings),
  saveMcpServers: (servers) => ipcRenderer.invoke(ipcChannels.saveMcpServers, servers),
  listAgentProviders: () => ipcRenderer.invoke(ipcChannels.listAgentProviders),
  saveAgentProviderCredential: (input) =>
    ipcRenderer.invoke(ipcChannels.saveAgentProviderCredential, input),
  runKnowledgeReview: (input) => ipcRenderer.invoke(ipcChannels.runKnowledgeReview, input),
  listAgentReviews: (input) => ipcRenderer.invoke(ipcChannels.listAgentReviews, input),
  ensureCodingEngine: (input) => ipcRenderer.invoke(ipcChannels.ensureCodingEngine, input),
  runCodingAgent: (input) => ipcRenderer.invoke(ipcChannels.runCodingAgent, input),
  startRetryAttempt: (input) => ipcRenderer.invoke(ipcChannels.startRetryAttempt, input),
  cancelCodingAgentRun: (input) => ipcRenderer.invoke(ipcChannels.cancelCodingAgentRun, input),
  replyCodingPermission: (input) => ipcRenderer.invoke(ipcChannels.replyCodingPermission, input),
  subscribeCodingRun: (input) => ipcRenderer.invoke(ipcChannels.subscribeCodingRun, input),
  listCodingAgentRuns: (input) => ipcRenderer.invoke(ipcChannels.listCodingAgentRuns, input),
  openManagedWorktree: (input) => ipcRenderer.invoke(ipcChannels.openManagedWorktree, input),
  deleteManagedWorktree: (input) => ipcRenderer.invoke(ipcChannels.deleteManagedWorktree, input),
  onCodingRunStatusUpdated: (listener) =>
    onIpcPayload(ipcChannels.codingRunStatusUpdated, listener),
  onCodingEventAppended: (listener) =>
    onIpcPayload(ipcChannels.codingEventAppended, listener),
  onCodingPermissionUpdated: (listener) =>
    onIpcPayload(ipcChannels.codingPermissionUpdated, listener),
  onAgentRuntimeUpdated: (listener) =>
    onIpcPayload(ipcChannels.agentRuntimeUpdated, listener),
  onProjectGitStatusUpdated: (listener) =>
    onIpcPayload(ipcChannels.projectGitStatusUpdated, listener),
  onLocalStateUpdated: (listener) => onIpcPayload(ipcChannels.localStateUpdated, listener),
}

contextBridge.exposeInMainWorld('aiDevFlowDesktop', desktopApi)
