import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, type DevFlowDesktopApi } from './ipc-contract.js'

const desktopApi: DevFlowDesktopApi = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke(ipcChannels.loadState),
  loadRemoteSnapshot: (input) => ipcRenderer.invoke(ipcChannels.loadRemoteSnapshot, input),
  uploadRunSummary: (summary) => ipcRenderer.invoke(ipcChannels.uploadRunSummary, summary),
  uploadTestEvidenceSummary: (summary) =>
    ipcRenderer.invoke(ipcChannels.uploadTestEvidenceSummary, summary),
  uploadCodingAgentSummary: (summary) =>
    ipcRenderer.invoke(ipcChannels.uploadCodingAgentSummary, summary),
  selectLocalProject: () => ipcRenderer.invoke(ipcChannels.selectProject),
  saveProjectTestCommand: (input) =>
    ipcRenderer.invoke(ipcChannels.saveProjectTestCommand, input),
  validateTestCommand: (input) => ipcRenderer.invoke(ipcChannels.validateTestCommand, input),
  runProjectTests: (input) => ipcRenderer.invoke(ipcChannels.runProjectTests, input),
  createRun: (run) => ipcRenderer.invoke(ipcChannels.createRun, run),
  saveRun: (run) => ipcRenderer.invoke(ipcChannels.saveRun, run),
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
  cancelCodingAgentRun: (input) => ipcRenderer.invoke(ipcChannels.cancelCodingAgentRun, input),
  replyCodingPermission: (input) => ipcRenderer.invoke(ipcChannels.replyCodingPermission, input),
  subscribeCodingRun: (input) => ipcRenderer.invoke(ipcChannels.subscribeCodingRun, input),
  listCodingAgentRuns: (input) => ipcRenderer.invoke(ipcChannels.listCodingAgentRuns, input),
  openManagedWorktree: (input) => ipcRenderer.invoke(ipcChannels.openManagedWorktree, input),
  deleteManagedWorktree: (input) => ipcRenderer.invoke(ipcChannels.deleteManagedWorktree, input),
}

contextBridge.exposeInMainWorld('aiDevFlowDesktop', desktopApi)
