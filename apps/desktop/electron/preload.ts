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
  uploadRunSummary: (summary) => ipcRenderer.invoke(ipcChannels.uploadRunSummary, summary),
  uploadTestEvidenceSummary: (summary) =>
    ipcRenderer.invoke(ipcChannels.uploadTestEvidenceSummary, summary),
  uploadCodingAgentSummary: (summary) =>
    ipcRenderer.invoke(ipcChannels.uploadCodingAgentSummary, summary),
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
  completeWorkflowAgentNode: (input) =>
    ipcRenderer.invoke(ipcChannels.completeWorkflowAgentNode, input),
  saveRun: (run) => ipcRenderer.invoke(ipcChannels.saveRun, run),
  saveArtifact: (artifact) => ipcRenderer.invoke(ipcChannels.saveArtifact, artifact),
  approveGate: (input) => ipcRenderer.invoke(ipcChannels.approveGate, input),
  saveGateOverride: (input) => ipcRenderer.invoke(ipcChannels.saveGateOverride, input),
  listGateOverrides: (input) => ipcRenderer.invoke(ipcChannels.listGateOverrides, input),
  saveEvent: (event) => ipcRenderer.invoke(ipcChannels.saveEvent, event),
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
  onProjectGitStatusUpdated: (listener) =>
    onIpcPayload(ipcChannels.projectGitStatusUpdated, listener),
}

contextBridge.exposeInMainWorld('aiDevFlowDesktop', desktopApi)
