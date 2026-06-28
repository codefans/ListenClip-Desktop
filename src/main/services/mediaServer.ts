/**
 * Local HTTP media server.
 *
 * Replaces the media:// custom Electron protocol.  Chrome's audio element is
 * designed for HTTP; using a real HTTP server avoids all the edge-cases around
 * custom protocols (Range request quirks, stream lifecycle bugs, moov-atom
 * detection failures, concurrent-connection limits, etc.).
 *
 * The server binds to 127.0.0.1 on an ephemeral port chosen by the OS.
 * The renderer obtains the port once via synchronous IPC and constructs
 * audio URLs as  http://127.0.0.1:<port>/<encodeURIComponent(projectId)>
 */

import * as http from 'http'
import * as net  from 'net'
import * as fs   from 'fs'
import * as path from 'path'
import { store } from './store'

let serverPort = 0

const MIME: Record<string, string> = {
  '.mp3' : 'audio/mpeg',
  '.wav' : 'audio/wav',
  '.m4a' : 'audio/mp4',
  '.aac' : 'audio/aac',
  '.ogg' : 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4' : 'video/mp4',
  '.mkv' : 'video/x-matroska',
  '.mov' : 'video/quicktime',
  '.webm': 'video/webm',
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // URL format: /<encodeURIComponent(projectId)>
  const projectId = decodeURIComponent((req.url ?? '/').replace(/^\//, '').replace(/\?.*$/, ''))
  const project   = store.getProject(projectId)
  const filePath  = project?.audioPath

  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }

  const stat        = fs.statSync(filePath)
  const fileSize    = stat.size
  const contentType = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const rangeHeader = req.headers['range']

  // ── Range request ────────────────────────────────────────────────────────
  if (rangeHeader) {
    // bytes=start-[end]  (forward range, used for normal buffering / seeking)
    const fwdMatch = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
    // bytes=-suffixLen   (suffix range, Chrome uses this to locate moov at EOF)
    const sufMatch  = /bytes=-(\d+)$/.exec(rangeHeader)

    let start: number
    let end: number

    if (fwdMatch) {
      start = parseInt(fwdMatch[1], 10)
      end   = fwdMatch[2] ? parseInt(fwdMatch[2], 10) : fileSize - 1
      end   = Math.min(end, fileSize - 1)
    } else if (sufMatch) {
      const n = Math.min(parseInt(sufMatch[1], 10), fileSize)
      start   = fileSize - n
      end     = fileSize - 1
    } else {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
      res.end()
      return
    }

    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Type'  : contentType,
      'Content-Range' : `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges' : 'bytes',
      'Content-Length': chunkSize,
      // Disable Chromium's HTTP/media caches.  Combined with renderer-side
      // cache-buster query strings, this prevents ResourceMultiBuffer from
      // fusing buffers across <audio> elements that share a project id —
      // the exact failure mode we hit with the previous media:// custom
      // protocol implementation (MEDIA_ERR_NETWORK / MEDIA_ERR_SRC_NOT_
      // SUPPORTED after a sentence-editor preview).
      'Cache-Control' : 'no-store',
    })

    if (req.method === 'HEAD') { res.end(); return }

    const stream = fs.createReadStream(filePath, { start, end })
    stream.on('error', () => res.end())
    req.on('close',    () => stream.destroy())
    stream.pipe(res)
    return
  }

  // ── Full file ────────────────────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type'  : contentType,
    'Content-Length': fileSize,
    'Accept-Ranges' : 'bytes',
    'Cache-Control' : 'no-store',
  })

  if (req.method === 'HEAD') { res.end(); return }

  const stream = fs.createReadStream(filePath)
  stream.on('error', () => res.end())
  req.on('close',    () => stream.destroy())
  stream.pipe(res)
}

export function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest)
    server.listen(0, '127.0.0.1', () => {
      serverPort = (server.address() as net.AddressInfo).port
      console.log(`[mediaServer] listening on 127.0.0.1:${serverPort}`)
      resolve(serverPort)
    })
    server.on('error', reject)
  })
}

export function getMediaServerPort(): number {
  return serverPort
}
