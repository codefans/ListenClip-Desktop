import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import * as path from 'path'

if (ffmpegStatic) {
  // When packaged, ffmpeg-static is unpacked from asar to app.asar.unpacked/
  const ffmpegPath = ffmpegStatic.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
  ffmpeg.setFfmpegPath(ffmpegPath)
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

/**
 * Extract or copy audio to a WAV file for Whisper and playback.
 * Audio files are copied as-is (preserving format for HTML5 playback).
 * Video files (mp4, mkv, etc.) are transcoded to mp3.
 */
export function extractAudio(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase()

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)

    if (AUDIO_EXTENSIONS.has(ext)) {
      // Copy audio stream without re-encoding.
      // For MP4-container formats (M4A/AAC) add -movflags faststart so the moov
      // atom is placed at the beginning of the file.  Without this, Chrome must
      // fetch the end of the file to locate moov before it can seek, and if that
      // extra Range request is mishandled the audio element enters a broken state.
      command = command.audioCodec('copy')
      if (ext === '.m4a' || ext === '.aac') {
        command = command.outputOptions(['-movflags', '+faststart'])
      }
    } else {
      // Extract audio from video, convert to mp3
      command = command
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
    }

    command
      .output(outputPath)
      .on('progress', (info) => {
        if (onProgress && info.percent) {
          onProgress(Math.min(info.percent, 100))
        }
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}

export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err)
      resolve(metadata.format.duration ?? 0)
    })
  })
}

export function isAudioFile(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase())
}
