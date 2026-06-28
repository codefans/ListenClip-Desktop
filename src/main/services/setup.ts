import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface SetupStatus {
  pythonOk: boolean
  pythonVersion: string
  fasterWhisperOk: boolean
  openaiWhisperOk: boolean
  anyWhisperOk: boolean
}

/** Detect the Python executable (python or python3). */
export async function findPython(): Promise<string | null> {
  for (const cmd of ['python', 'python3']) {
    try {
      const { stdout } = await execFileAsync(cmd, ['--version'])
      const version = stdout.trim()
      if (version.startsWith('Python 3')) return cmd
    } catch {
      // try next
    }
  }
  return null
}

/** Check whether required Python packages are installed. */
export async function checkSetup(): Promise<SetupStatus> {
  const pythonCmd = await findPython()
  if (!pythonCmd) {
    return {
      pythonOk: false,
      pythonVersion: '',
      fasterWhisperOk: false,
      openaiWhisperOk: false,
      anyWhisperOk: false
    }
  }

  let pythonVersion = ''
  try {
    const { stdout } = await execFileAsync(pythonCmd, ['--version'])
    pythonVersion = stdout.trim()
  } catch { /* ignore */ }

  const checkPkg = async (pkg: string) => {
    try {
      await execFileAsync(pythonCmd, ['-c', `import ${pkg}`])
      return true
    } catch {
      return false
    }
  }

  // faster_whisper uses underscore in import
  const fasterWhisperOk = await checkPkg('faster_whisper')
  const openaiWhisperOk = await checkPkg('whisper')

  return {
    pythonOk: true,
    pythonVersion,
    fasterWhisperOk,
    openaiWhisperOk,
    anyWhisperOk: fasterWhisperOk || openaiWhisperOk
  }
}

/**
 * Install faster-whisper via pip, streaming stdout/stderr to the onLine callback.
 * Resolves when installation finishes, rejects on error.
 */
export function installFasterWhisper(
  onLine: (line: string) => void
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const pythonCmd = await findPython()
    if (!pythonCmd) {
      reject(new Error('未找到 Python，请先安装 Python 3.9+'))
      return
    }

    const child = spawn(pythonCmd, [
      '-m', 'pip', 'install', '--upgrade', 'faster-whisper'
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    child.stdout.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(onLine))
    child.stderr.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(onLine))

    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pip 安装失败，退出码 ${code}`))
    })

    child.on('error', reject)
  })
}
