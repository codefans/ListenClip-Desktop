import { useState, useCallback, useRef } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, Typography, CircularProgress, Alert
} from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import type { Project } from '../types'

const SUPPORTED_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.mp4', '.mkv', '.mov', '.webm']

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
}

type Step = 'select' | 'details' | 'creating'

export default function ImportWizard({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>('select')
  const [filePath, setFilePath] = useState('')
  const [fileName, setFileName] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const reset = () => {
    setStep('select')
    setFilePath('')
    setFileName('')
    setTitle('')
    setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const validateAndSetFile = (path: string) => {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    if (!SUPPORTED_EXTS.includes(ext)) {
      setError(`不支持的格式 "${ext}"，请选择：${SUPPORTED_EXTS.join(' ')}`)
      return false
    }
    const name = path.split(/[/\\]/).pop() ?? path
    setFilePath(path)
    setFileName(name)
    setTitle(name.slice(0, name.lastIndexOf('.')) || name)
    setError('')
    setStep('details')
    return true
  }

  const handleBrowse = async () => {
    const path = await window.electronAPI.selectFile()
    if (path) validateAndSetFile(path)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      validateAndSetFile(files[0].path)
    }
  }, [])

  const handleCreate = async () => {
    if (!filePath || !title.trim()) return
    setStep('creating')
    setError('')
    try {
      const project = await window.electronAPI.createProject(filePath, title.trim()) as Project
      reset()
      onCreated(project.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建失败')
      setStep('details')
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3, bgcolor: 'background.paper' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        {step === 'select' ? '导入音视频' : step === 'details' ? '填写信息' : '正在创建...'}
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

        {step === 'select' && (
          <Box
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={handleBrowse}
            sx={{
              border: `2px dashed`,
              borderColor: isDragging ? 'primary.main' : 'rgba(202,196,208,0.3)',
              borderRadius: 3,
              p: 6,
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
              bgcolor: isDragging ? 'rgba(208,188,255,0.06)' : 'transparent',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'rgba(208,188,255,0.04)' }
            }}
          >
            <UploadFileIcon sx={{ fontSize: 48, color: isDragging ? 'primary.main' : 'text.secondary', mb: 1 }} />
            <Typography color="text.primary" gutterBottom>
              拖放文件到此处，或点击选择
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {SUPPORTED_EXTS.join(' · ')}
            </Typography>
          </Box>
        )}

        {step === 'details' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ p: 2, bgcolor: 'rgba(208,188,255,0.08)', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">已选文件</Typography>
              <Typography variant="body1" noWrap>{fileName}</Typography>
            </Box>
            <TextField
              label="标题"
              value={title}
              onChange={e => setTitle(e.target.value)}
              fullWidth
              autoFocus
              helperText="可以修改为更易识别的名称"
            />
          </Box>
        )}

        {step === 'creating' && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, gap: 2 }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">正在创建项目...</Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={step === 'creating'}>取消</Button>
        {step === 'details' && (
          <>
            <Button onClick={() => setStep('select')}>上一步</Button>
            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={!title.trim()}
            >
              开始处理
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
