// Re-export shared types for renderer convenience
export type {
  Project,
  Sentence,
  AppSettings,
  ProjectStatus,
  ProcessingProgress,
  StoreData
} from '../../shared/types'

// Augment Window with our preload API
import type { ElectronAPI } from '../../preload/index'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
