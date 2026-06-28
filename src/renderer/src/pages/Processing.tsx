import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Typography, LinearProgress, Button, Alert, Chip, Paper
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import type { ProcessingProgress, Project } from '../types'

interface Props {
  projectId?: string
  onDone: (projectId: string) => void
  onCancel: () => void
}

const STAGE_LABELS = {
  extracting: '提取音频',
  transcribing: 'Whisper 转录',
  segmenting: '整理断句',
  done: '处理完成',
  error: '处理失败'
}

export default function Processing({ projectId, onDone, onCancel }: Props) {
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [started, setStarted] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const startedRef = useRef(false)

  const loadProject = useCallback(async (id: string) => {
    try {
      const data = await window.electronAPI.getProjectData(id) as { project: Project }
      setProject(data.project)
      return data.project
    } catch {
      return null
    }
  }, [])

  const startProcessing = useCallback(async (id: string) => {
    if (startedRef.current) return
    startedRef.current = true
    setStarted(true)
    try {
      await window.electronAPI.processProject(id)
    } catch {
      // error is surfaced via the progress event
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    startedRef.current = false

    const handleProgress = (_e: Electron.IpcRendererEvent, p: ProcessingProgress) => {
      if (p.projectId !== projectId) return
      setProgress(p)
      if (p.stage === 'done') {
        setTimeout(() => onDone(projectId), 1200)
      }
    }

    window.electronAPI.onProcessingProgress(handleProgress)
    loadProject(projectId).then(p => {
      if (p?.status === 'completed') {
        onDone(projectId)
        return
      }
      startProcessing(projectId)
    })

    return () => {
      window.electronAPI.offProcessingProgress(handleProgress)
    }
  }, [projectId, loadProject, startProcessing, onDone])

  const stages = ['extracting', 'transcribing', 'segmenting', 'done'] as const

  const currentStageIdx = progress
    ? stages.indexOf(progress.stage as typeof stages[number])
    : -1

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 4 }}>
      <Paper sx={{ maxWidth: 520, width: '100%', p: 4, bgcolor: 'background.paper', borderRadius: 3 }}>
        <Typography variant="h6" gutterBottom>
          {project?.title ?? 'AI 处理中'}
        </Typography>

        {!started && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
            <HourglassEmptyIcon sx={{ color: 'text.secondary' }} />
            <Typography color="text.secondary">准备中...</Typography>
          </Box>
        )}

        {progress && (
          <>
            {/* Stage chips */}
            <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
              {stages.map((s, i) => {
                const done = i < currentStageIdx || progress.stage === 'done'
                const active = s === progress.stage
                return (
                  <Chip
                    key={s}
                    size="small"
                    label={STAGE_LABELS[s]}
                    icon={done ? <CheckCircleIcon sx={{ fontSize: '14px !important' }} /> : undefined}
                    color={done ? 'success' : active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                  />
                )
              })}
            </Box>

            {/* Progress bar */}
            {progress.stage !== 'error' && progress.stage !== 'done' && (
              <LinearProgress
                variant="determinate"
                value={progress.percent}
                sx={{ mb: 2, height: 8 }}
              />
            )}

            {/* Status message */}
            {progress.stage === 'done' && (
              <Alert
                severity="success"
                icon={<CheckCircleIcon />}
                sx={{ borderRadius: 2 }}
              >
                {progress.message}
              </Alert>
            )}
            {progress.stage === 'error' && (
              <Alert
                severity="error"
                icon={<ErrorIcon />}
                sx={{ borderRadius: 2, mb: 2 }}
              >
                {progress.message}
              </Alert>
            )}
            {progress.stage !== 'done' && progress.stage !== 'error' && (
              <Typography variant="body2" color="text.secondary">
                {progress.message}
              </Typography>
            )}
          </>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3, gap: 1 }}>
          <Button variant="outlined" onClick={onCancel}>
            {progress?.stage === 'done' ? '返回媒体库' : '取消'}
          </Button>
          {progress?.stage === 'error' && projectId && (
            <Button variant="contained" onClick={() => {
              startedRef.current = false
              setProgress(null)
              startProcessing(projectId)
            }}>
              重试
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  )
}
