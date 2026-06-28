import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { store } from './services/store'
import { registerIpcHandlers } from './ipc'
import { startMediaServer } from './services/mediaServer'

// Allow audio.play() without requiring a prior user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1C1B1F',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  store.init()
  // Start the local HTTP media server BEFORE creating the window — the
  // preload script fetches the port synchronously during context-bridge
  // setup, and that has to succeed before the renderer can load.  We
  // ditched the media:// custom protocol because Chromium's audio element
  // pipeline interacts unreliably with custom schemes (ResourceMultiBuffer
  // wedges, intermittent MEDIA_ERR_NETWORK after seek, etc.).  A real HTTP
  // server avoids all of that since <audio> was designed for HTTP.
  await startMediaServer()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
