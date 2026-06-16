import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, type DevFlowDesktopApi } from './ipc-contract.js'

const desktopApi: DevFlowDesktopApi = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke(ipcChannels.loadState),
  loadRemoteSnapshot: (input) => ipcRenderer.invoke(ipcChannels.loadRemoteSnapshot, input),
  uploadRunSummary: (summary) => ipcRenderer.invoke(ipcChannels.uploadRunSummary, summary),
  uploadTestEvidenceSummary: (summary) =>
    ipcRenderer.invoke(ipcChannels.uploadTestEvidenceSummary, summary),
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
}

contextBridge.exposeInMainWorld('aiDevFlowDesktop', desktopApi)
