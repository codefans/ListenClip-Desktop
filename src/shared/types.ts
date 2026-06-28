export type ProjectStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface Project {
  id: string
  title: string
  originalPath: string
  audioPath: string
  duration: number
  status: ProjectStatus
  createdAt: number
  error?: string
}

export interface Sentence {
  id: string
  projectId: string
  index: number
  start: number
  end: number
  text: string
}

export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'

export interface AppSettings {
  whisperModel: WhisperModelSize
  defaultSpeed: number
  defaultLoopCount: number
}

export interface ProcessingProgress {
  projectId: string
  stage: 'extracting' | 'transcribing' | 'segmenting' | 'done' | 'error'
  percent: number
  message: string
  error?: string
}

export interface StoreData {
  projects: Project[]
  sentences: Record<string, Sentence[]>
  settings: AppSettings
}

export type IpcChannel =
  | 'library:list'
  | 'library:delete'
  | 'import:select-file'
  | 'import:create-project'
  | 'import:process'
  | 'player:get-project'
  | 'settings:get'
  | 'settings:save'
