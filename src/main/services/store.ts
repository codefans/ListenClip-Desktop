import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { StoreData, Project, Sentence, AppSettings } from '../../shared/types'

const DATA_DIR = app.getPath('userData')
const STORE_FILE = path.join(DATA_DIR, 'listencip-store.json')
export const AUDIO_DIR = path.join(DATA_DIR, 'audio')

const DEFAULT_STORE: StoreData = {
  projects: [],
  sentences: {},
  settings: {
    whisperModel: 'base',
    defaultSpeed: 1.0,
    defaultLoopCount: 1
  }
}

function ensureDirs(): void {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true })
}

// ── In-memory cache ─────────────────────────────────────────────────────────
//
// THIS IS THE FIX for "preview stops working after Save / after editing a few
// sentences".  Background:
//
//   The media:// protocol handler calls store.getProject(id) on EVERY Range
//   request from the renderer's <audio> element (and Chromium issues several
//   of these per second during preload + playback).  Without a cache, each
//   call did fs.readFileSync(STORE_FILE) + JSON.parse.
//
//   The Save IPC writes the same STORE_FILE.  When write and read raced
//   (very common during editing/saving), readFileSync occasionally saw a
//   half-written JSON blob → JSON.parse threw → the catch returned
//   DEFAULT_STORE (empty projects) → getProject returned undefined → the
//   protocol handler responded 404 → the <audio> element latched into
//   error state → all subsequent play() calls failed silently.
//
//   That manifested as "after saving, preview is broken" or, with multiple
//   edits in flight, "after editing a few sentences, preview is broken".
//
// The cache eliminates the race two ways:
//   1. read() returns the cached object — no disk read, no JSON.parse, no
//      possibility of seeing a partial write;
//   2. write() / writeAsync() update the cache atomically (single assignment)
//      AND write to disk via tmp+rename so any other reader (now or in the
//      future) is also safe.
let cache: StoreData | null = null

function read(): StoreData {
  if (cache) return cache
  try {
    if (!fs.existsSync(STORE_FILE)) {
      cache = { ...DEFAULT_STORE }
      return cache
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf-8')
    cache = { ...DEFAULT_STORE, ...JSON.parse(raw) }
    return cache
  } catch {
    cache = { ...DEFAULT_STORE }
    return cache
  }
}

// Atomic write: serialize → write to STORE_FILE.tmp → rename onto STORE_FILE.
// rename is atomic on POSIX and effectively atomic on Windows (ReplaceFile),
// so any concurrent reader is guaranteed to see either the old file in full
// or the new file in full — never a partial JSON blob.  Combined with the
// in-memory cache this completely eliminates the "preview wedges after save"
// class of bugs even if a future code path were to bypass the cache.
function write(data: StoreData): void {
  cache = data
  const tmp = STORE_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_FILE)
}

// Async variant.  Used by sentences:save (and any other IPC path triggered
// during interactive editing) so the main-process event loop is never blocked
// long enough to stall in-flight media:// Range responses.
async function writeAsync(data: StoreData): Promise<void> {
  cache = data
  const tmp = STORE_FILE + '.tmp'
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.promises.rename(tmp, STORE_FILE)
}

export const store = {
  init(): void {
    ensureDirs()
  },

  getProjects(): Project[] {
    return read().projects.sort((a, b) => b.createdAt - a.createdAt)
  },

  getProject(id: string): Project | undefined {
    return read().projects.find(p => p.id === id)
  },

  upsertProject(project: Project): void {
    const data = read()
    const idx = data.projects.findIndex(p => p.id === project.id)
    if (idx >= 0) data.projects[idx] = project
    else data.projects.push(project)
    write(data)
  },

  deleteProject(id: string): void {
    const data = read()
    data.projects = data.projects.filter(p => p.id !== id)
    delete data.sentences[id]
    write(data)
  },

  getSentences(projectId: string): Sentence[] {
    const data = read()
    return (data.sentences[projectId] ?? []).sort((a, b) => a.index - b.index)
  },

  setSentences(projectId: string, sentences: Sentence[]): void {
    const data = read()
    data.sentences[projectId] = sentences
    write(data)
  },

  // Async variant of setSentences.  Use this from IPC handlers triggered by
  // user actions (e.g. the editor's Save button) so the synchronous write
  // does not stall Chromium's media:// pipeline on the main process.  See
  // the writeAsync comment above for the full rationale.
  async setSentencesAsync(projectId: string, sentences: Sentence[]): Promise<void> {
    const data = read()
    data.sentences[projectId] = sentences
    await writeAsync(data)
  },

  getSettings(): AppSettings {
    const s = read().settings
    // Migrate: openai model names (whisper-1, etc.) are invalid for local faster-whisper
    const VALID_MODELS = new Set([
      'tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small',
      'medium.en', 'medium', 'large-v1', 'large-v2', 'large-v3', 'large',
      'distil-large-v2', 'distil-medium.en', 'distil-small.en',
      'distil-large-v3', 'distil-large-v3.5', 'large-v3-turbo', 'turbo'
    ])
    if (!VALID_MODELS.has(s.whisperModel as string)) {
      s.whisperModel = 'base'
      // Persist the fix so it doesn't repeat
      const data = read()
      data.settings = s
      write(data)
    }
    return s
  },

  saveSettings(settings: AppSettings): void {
    const data = read()
    data.settings = settings
    write(data)
  }
}
