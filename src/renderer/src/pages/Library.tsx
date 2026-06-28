import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Card, CardActionArea, CardContent, Grid, Chip, Fab,
  IconButton, CircularProgress, Tooltip, TextField, InputAdornment,
  Skeleton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import type { Project, ProjectStatus } from '../types'
import ImportWizard from './ImportWizard'

interface Props {
  onOpenImport: () => void
  onPlayProject: (id: string) => void
  onProcessProject: (id: string) => void
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '完成',
  failed: '失败'
}

const STATUS_COLORS: Record<ProjectStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  processing: 'warning',
  completed: 'success',
  failed: 'error'
}

function formatDuration(secs: number): string {
  if (!secs) return '--:--'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Library({ onPlayProject, onProcessProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.listProjects() as Project[]
      setProjects(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  // Refresh processing projects every 3s
  useEffect(() => {
    const hasProcessing = projects.some(p => p.status === 'processing')
    if (!hasProcessing) return
    const id = setInterval(loadProjects, 3000)
    return () => clearInterval(id)
  }, [projects, loadProjects])

  const handleDelete = async () => {
    if (!deleteId) return
    await window.electronAPI.deleteProject(deleteId)
    setDeleteId(null)
    loadProjects()
  }

  const filtered = projects.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h5" fontWeight={500} sx={{ flex: 1, color: 'text.primary' }}>
          媒体库
        </Typography>
        <Tooltip title="刷新"><IconButton size="small" onClick={loadProjects}><RefreshIcon /></IconButton></Tooltip>
        <TextField
          size="small"
          placeholder="搜索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment> }}
          sx={{ width: 200, '& .MuiOutlinedInput-root': { borderRadius: 4 } }}
        />
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 2 }}>
        {loading ? (
          <Grid container spacing={2}>
            {[...Array(6)].map((_, i) => (
              <Grid item xs={12} sm={6} md={4} key={i}>
                <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
              </Grid>
            ))}
          </Grid>
        ) : filtered.length === 0 ? (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, opacity: 0.5 }}>
            <MusicNoteIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
            <Typography color="text.secondary">
              {search ? '没有匹配的文件' : '还没有导入任何文件，点击右下角 + 开始'}
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {filtered.map(project => (
              <Grid item xs={12} sm={6} md={4} key={project.id}>
                <ProjectCard
                  project={project}
                  onPlay={() => onPlayProject(project.id)}
                  onProcess={() => onProcessProject(project.id)}
                  onDelete={() => setDeleteId(project.id)}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* FAB */}
      <Fab
        color="primary"
        onClick={() => setImportOpen(true)}
        sx={{ position: 'fixed', bottom: 32, right: 32, bgcolor: 'primary.main', color: 'primary.contrastText' }}
      >
        <AddIcon />
      </Fab>

      {/* Import wizard modal */}
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCreated={(id) => {
          setImportOpen(false)
          loadProjects()
          onProcessProject(id)
        }}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>删除后无法恢复，包含所有转录数据。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>取消</Button>
          <Button color="error" onClick={handleDelete}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function ProjectCard({
  project,
  onPlay,
  onProcess,
  onDelete
}: {
  project: Project
  onPlay: () => void
  onProcess: () => void
  onDelete: () => void
}) {
  return (
    <Card sx={{ position: 'relative', '&:hover .actions': { opacity: 1 } }}>
      <CardActionArea
        disabled={project.status !== 'completed'}
        onClick={onPlay}
        sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <MusicNoteIcon sx={{ color: 'primary.main', fontSize: 20 }} />
          <Typography variant="body1" fontWeight={500} noWrap sx={{ flex: 1 }}>
            {project.title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
          <Chip
            size="small"
            label={STATUS_LABELS[project.status]}
            color={STATUS_COLORS[project.status]}
            icon={project.status === 'processing' ? <CircularProgress size={10} sx={{ color: 'inherit !important' }} /> : undefined}
          />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {formatDuration(project.duration)}
          </Typography>
        </Box>
        {project.error && (
          <Typography variant="caption" color="error.main" noWrap sx={{ width: '100%' }}>
            {project.error}
          </Typography>
        )}
      </CardActionArea>

      {/* Hover actions */}
      <Box
        className="actions"
        sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5, opacity: 0, transition: 'opacity 0.2s' }}
      >
        {project.status === 'completed' && (
          <Tooltip title="播放"><IconButton size="small" onClick={onPlay} sx={{ bgcolor: 'rgba(0,0,0,0.5)' }}><PlayArrowIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        )}
        {(project.status === 'pending' || project.status === 'failed') && (
          <Tooltip title="开始处理"><IconButton size="small" onClick={onProcess} sx={{ bgcolor: 'rgba(0,0,0,0.5)' }}><RefreshIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        )}
        <Tooltip title="删除"><IconButton size="small" onClick={onDelete} sx={{ bgcolor: 'rgba(0,0,0,0.5)' }}><DeleteIcon sx={{ fontSize: 16, color: 'error.main' }} /></IconButton></Tooltip>
      </Box>
    </Card>
  )
}
