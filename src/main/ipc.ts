import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { store, AUDIO_DIR } from './services/store'
import { getMediaServerPort } from './services/mediaServer'
import { extractAudio, getAudioDuration, isAudioFile } from './services/ffmpeg'
import { transcribeAudio, buildSentences } from './services/whisper'
import { checkSetup, installFasterWhisper } from './services/setup'
import type { Project, ProcessingProgress } from '../shared/types'

const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.mp4', '.mkv', '.mov', '.webm']

export function registerIpcHandlers(): void {
  // ── Library ────────────────────────────────────────────────────────────────

  ipcMain.handle('library:list', () => store.getProjects())

  ipcMain.handle('library:delete', (_e, id: string) => {
    const project = store.getProject(id)
    if (project?.audioPath && fs.existsSync(project.audioPath)) {
      fs.unlinkSync(project.audioPath)
    }
    store.deleteProject(id)
    return { ok: true }
  })

  // ── Import ─────────────────────────────────────────────────────────────────

  ipcMain.handle('import:select-file', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const result = await dialog.showOpenDialog(win, {
      title: '选择音视频文件',
      filters: [
        { name: '音视频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'mp4', 'mkv', 'mov', 'webm'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('import:create-project', async (_e, filePath: string, title: string) => {
    const ext = path.extname(filePath).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`不支持的文件格式: ${ext}`)
    }

    const id = crypto.randomUUID()
    const audioExt = isAudioFile(ext) ? ext : '.mp3'
    const audioPath = path.join(AUDIO_DIR, `${id}${audioExt}`)

    const project: Project = {
      id,
      title: title || path.basename(filePath, ext),
      originalPath: filePath,
      audioPath,
      duration: 0,
      status: 'pending',
      createdAt: Date.now()
    }
    store.upsertProject(project)
    return project
  })

  ipcMain.handle('import:process', async (e, projectId: string) => {
    const project = store.getProject(projectId)
    if (!project) throw new Error('Project not found')

    const settings = store.getSettings()
    const win = BrowserWindow.fromWebContents(e.sender)!

    const emit = (progress: ProcessingProgress) => {
      win.webContents.send('processing:progress', progress)
    }

    try {
      store.upsertProject({ ...project, status: 'processing' })

      // Stage 1: extract / copy audio
      emit({ projectId, stage: 'extracting', percent: 5, message: '正在提取音频...' })
      await extractAudio(project.originalPath, project.audioPath, (pct) => {
        emit({ projectId, stage: 'extracting', percent: 5 + pct * 0.25, message: '正在提取音频...' })
      })

      // Get duration
      const duration = await getAudioDuration(project.audioPath)
      store.upsertProject({ ...project, audioPath: project.audioPath, duration, status: 'processing' })

      // Stage 2: local Whisper transcription
      emit({ projectId, stage: 'transcribing', percent: 30, message: `加载本地 Whisper 模型 (${settings.whisperModel})...` })

      const segments = await transcribeAudio(
        project.audioPath,
        settings.whisperModel,
        (msg) => {
          // Forward progress messages from Python stderr
          emit({ projectId, stage: 'transcribing', percent: 40, message: msg })
        }
      )

      emit({ projectId, stage: 'transcribing', percent: 85, message: '转录完成，正在整理断句...' })

      // Stage 3: build sentences
      emit({ projectId, stage: 'segmenting', percent: 90, message: '正在整理句子...' })
      const sentences = buildSentences(projectId, segments)
      store.setSentences(projectId, sentences)

      store.upsertProject({ ...project, audioPath: project.audioPath, duration, status: 'completed' })
      emit({ projectId, stage: 'done', percent: 100, message: `处理完成，共 ${sentences.length} 个句子` })

      return { ok: true, sentenceCount: sentences.length }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      store.upsertProject({ ...project, status: 'failed', error: message })
      emit({ projectId, stage: 'error', percent: 0, message: `处理失败: ${message}`, error: message })
      throw err
    }
  })

  // ── Player ─────────────────────────────────────────────────────────────────

  ipcMain.handle('player:get-project', (_e, id: string) => {
    const project = store.getProject(id)
    if (!project) throw new Error('Project not found')
    const sentences = store.getSentences(id)
    return { project, sentences }
  })

  // ── Settings ───────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => store.getSettings())

  ipcMain.handle('settings:save', (_e, settings) => {
    store.saveSettings(settings)
    return { ok: true }
  })

  // ── Sentence editing ──────────────────────────────────────────────────────

  ipcMain.handle('sentences:save', async (_e, projectId: string, sentences: unknown[]) => {
    // Re-assign sequential indices so they're always clean after edits
    const typed = (sentences as Array<{ id: string; projectId: string; index: number; start: number; end: number; text: string }>)
      .map((s, i) => ({ ...s, index: i }))
    // Async write: must NOT block the main-process event loop, otherwise
    // the media:// protocol handler stalls and the renderer's preview
    // audio element ends up in a wedged state until a manual reload.
    await store.setSentencesAsync(projectId, typed)
    return { ok: true, count: typed.length }
  })

  // ── Setup / environment check ──────────────────────────────────────────────

  ipcMain.handle('setup:check', () => checkSetup())

  ipcMain.handle('setup:install', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    try {
      await installFasterWhisper((line) => {
        win.webContents.send('setup:install-progress', line)
      })
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Media server ──────────────────────────────────────────────────────────
  //
  // The renderer needs the HTTP media server's port to build audio URLs.
  // We expose it via a synchronous IPC channel so preload can fetch it once
  // at context-bridge setup time and bake it into electronAPI.getAudioUrl
  // (a sync function as far as the renderer is concerned).  startMediaServer
  // has already completed by the time the window loads (see main/index.ts).
  ipcMain.on('media:get-port', (e) => {
    e.returnValue = getMediaServerPort()
  })
}

// Media serving was moved to a real local HTTP server (see
// services/mediaServer.ts).  The previous media:// custom protocol
// implementation in this file had irreproducible "MEDIA_ERR_NETWORK after
// preview" issues caused by Chromium's audio element interacting badly
// with Electron's custom protocol stack (ResourceMultiBuffer wedges, abort
// vs cancel confusion, etc.).  HTTP avoids all of that — <audio> was
// designed for HTTP.

