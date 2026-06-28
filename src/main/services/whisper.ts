import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { findPython } from './setup'
import type { Sentence } from '../../shared/types'

interface RawSegment {
  id: number
  start: number
  end: number
  text: string
}

/** Resolve the path to transcribe.py for both dev and production. */
function getScriptPath(): string {
  // In dev mode, ELECTRON_RENDERER_URL is set by electron-vite
  if (process.env['ELECTRON_RENDERER_URL']) {
    return path.join(app.getAppPath(), 'resources', 'transcribe.py')
  }
  // In production (packaged), resources are at process.resourcesPath
  return path.join(process.resourcesPath, 'transcribe.py')
}

/**
 * Run local Whisper transcription via Python subprocess.
 * Streams PROGRESS lines from stderr back to the onProgress callback.
 */
export function transcribeAudio(
  audioPath: string,
  modelSize: string,
  onProgress?: (message: string) => void
): Promise<RawSegment[]> {
  return new Promise(async (resolve, reject) => {
    const pythonCmd = await findPython()
    if (!pythonCmd) {
      reject(new Error('未找到 Python。请安装 Python 3.9+ 并确保在系统 PATH 中。'))
      return
    }

    const scriptPath = getScriptPath()
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`转录脚本未找到: ${scriptPath}`))
      return
    }

    const args = [scriptPath, audioPath, modelSize, 'en']
    const child = spawn(pythonCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let jsonOutput = ''
    let lastSegmentId = -1

    child.stdout.on('data', (data: Buffer) => {
      jsonOutput += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        if (line.startsWith('PROGRESS:SEGMENT:')) {
          // "PROGRESS:SEGMENT:<id>:<start>:<end>"
          const parts = line.split(':')
          const segId = parseInt(parts[2], 10)
          if (segId > lastSegmentId) {
            lastSegmentId = segId
            onProgress?.(`已转录 ${segId + 1} 段`)
          }
        } else if (line.startsWith('PROGRESS:')) {
          onProgress?.(line.slice('PROGRESS:'.length))
        }
      }
    })

    child.on('close', (code) => {
      if (code !== 0 && !jsonOutput.trim()) {
        reject(new Error(`转录进程异常退出 (code ${code})`))
        return
      }

      try {
        const parsed = JSON.parse(jsonOutput.trim())
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          reject(new Error(parsed.error as string))
          return
        }
        resolve(parsed as RawSegment[])
      } catch {
        reject(new Error(`无法解析转录结果: ${jsonOutput.slice(0, 200)}`))
      }
    })

    child.on('error', (err) => {
      reject(new Error(`无法启动 Python: ${err.message}`))
    })
  })
}

/**
 * Merge very short segments and build Sentence objects.
 */
export function buildSentences(
  projectId: string,
  segments: RawSegment[]
): Sentence[] {
  if (!segments.length) return []

  const merged = mergeShortSegments(segments, 1.0)
  return merged.map((seg, idx) => ({
    id: `${projectId}-s${idx}`,
    projectId,
    index: idx,
    start: Math.max(0, seg.start),
    end: seg.end,
    text: seg.text.trim()
  }))
}

function mergeShortSegments(
  segments: RawSegment[],
  minDuration: number
): RawSegment[] {
  const result: RawSegment[] = []
  for (const seg of segments) {
    if (!result.length) { result.push({ ...seg }); continue }
    const last = result[result.length - 1]
    if (last.end - last.start < minDuration) {
      last.end = seg.end
      last.text = `${last.text} ${seg.text}`
    } else {
      result.push({ ...seg })
    }
  }
  return result.filter(s => s.text.trim().length > 0)
}
