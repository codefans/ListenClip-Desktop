import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ProcessingProgress } from '../shared/types'

// Fetch the local HTTP media server's port synchronously, once, at
// preload time.  The main process starts the server before creating the
// window (see main/index.ts), so by the time this script runs the port
// is guaranteed to be available.  Baking it into a constant lets
// getAudioUrl stay a plain string-builder (no async ceremony).
const mediaPort = ipcRenderer.sendSync('media:get-port') as number

const api = {
  // Library
  listProjects: () => ipcRenderer.invoke('library:list'),
  deleteProject: (id: string) => ipcRenderer.invoke('library:delete', id),

  // Import
  selectFile: () => ipcRenderer.invoke('import:select-file') as Promise<string | null>,
  createProject: (filePath: string, title: string) =>
    ipcRenderer.invoke('import:create-project', filePath, title),
  processProject: (projectId: string) => ipcRenderer.invoke('import:process', projectId),

  // Player
  getProjectData: (id: string) => ipcRenderer.invoke('player:get-project', id),
  // Audio served by the local HTTP server (services/mediaServer.ts) instead
  // of a custom media:// protocol.  HTTP is what <audio> was designed for
  // and avoids Chromium's ResourceMultiBuffer quirks with custom schemes.
  getAudioUrl: (projectId: string) =>
    `http://127.0.0.1:${mediaPort}/${encodeURIComponent(projectId)}`,

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  saveSettings: (s: AppSettings) => ipcRenderer.invoke('settings:save', s),

  // Sentence editing
  saveSentences: (projectId: string, sentences: unknown[]) =>
    ipcRenderer.invoke('sentences:save', projectId, sentences),

  // Setup / environment
  checkSetup: () => ipcRenderer.invoke('setup:check'),
  installFasterWhisper: () => ipcRenderer.invoke('setup:install'),

  // Events
  onProcessingProgress: (cb: (_e: Electron.IpcRendererEvent, p: ProcessingProgress) => void) => {
    ipcRenderer.on('processing:progress', cb)
  },
  offProcessingProgress: (cb: (_e: Electron.IpcRendererEvent, p: ProcessingProgress) => void) => {
    ipcRenderer.off('processing:progress', cb)
  },
  onInstallProgress: (cb: (_e: Electron.IpcRendererEvent, line: string) => void) => {
    ipcRenderer.on('setup:install-progress', cb)
  },
  offInstallProgress: (cb: (_e: Electron.IpcRendererEvent, line: string) => void) => {
    ipcRenderer.off('setup:install-progress', cb)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

// Bridge main-process diagnostic logs straight into the renderer's
// DevTools console so the user can see everything in one place while
// debugging the preview-audio pipeline.
ipcRenderer.on('debug:main-log', (_e, payload: { tag: string } & Record<string, unknown>) => {
  const { tag, ...rest } = payload
  // eslint-disable-next-line no-console
  console.log(`[main:${tag}]`, rest)
})

export type ElectronAPI = typeof api
