import { useState, useEffect, useRef } from 'react'
import {
  Box, Typography, Button, Paper, Divider, IconButton,
  Snackbar, MenuItem, Select, FormControl, InputLabel, FormHelperText,
  Chip, CircularProgress, Alert, List, ListItem, ListItemText,
  Accordion, AccordionSummary, AccordionDetails
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SaveIcon from '@mui/icons-material/Save'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { AppSettings, WhisperModelSize } from '../types'

interface SetupStatus {
  pythonOk: boolean
  pythonVersion: string
  fasterWhisperOk: boolean
  openaiWhisperOk: boolean
  anyWhisperOk: boolean
}

const MODEL_OPTIONS: { value: WhisperModelSize; label: string; size: string; note: string }[] = [
  { value: 'tiny',     label: 'Tiny',     size: '~75 MB',  note: '最快，精度较低，适合简单内容' },
  { value: 'base',     label: 'Base',     size: '~145 MB', note: '推荐入门，速度与精度均衡' },
  { value: 'small',    label: 'Small',    size: '~480 MB', note: '精度明显提升，适合大多数内容' },
  { value: 'medium',   label: 'Medium',   size: '~1.5 GB', note: '高精度，需要较多内存' },
  { value: 'large-v3', label: 'Large v3', size: '~3.1 GB', note: '最高精度，运行较慢' }
]

const DEFAULT_SETTINGS: AppSettings = {
  whisperModel: 'base',
  defaultSpeed: 1.0,
  defaultLoopCount: 1
}

export default function Settings({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  // Environment check
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null)
  const [checkingSetup, setCheckingSetup] = useState(false)

  // Install state
  const [installing, setInstalling] = useState(false)
  const [installLines, setInstallLines] = useState<string[]>([])
  const [installError, setInstallError] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then(s => setSettings(s)).catch(console.error)
    refreshSetupCheck()
  }, [])

  // Auto scroll pip log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [installLines])

  // Subscribe to install progress events
  useEffect(() => {
    const handler = (_e: Electron.IpcRendererEvent, line: string) => {
      setInstallLines(prev => [...prev.slice(-200), line])
    }
    window.electronAPI.onInstallProgress(handler)
    return () => window.electronAPI.offInstallProgress(handler)
  }, [])

  const refreshSetupCheck = async () => {
    setCheckingSetup(true)
    try {
      const status = await window.electronAPI.checkSetup() as SetupStatus
      setSetupStatus(status)
    } finally {
      setCheckingSetup(false)
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    setInstallLines([])
    setInstallError('')
    try {
      const result = await window.electronAPI.installFasterWhisper() as { ok: boolean; error?: string }
      if (result.ok) {
        await refreshSetupCheck()
      } else {
        setInstallError(result.error ?? '安装失败')
      }
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setInstalling(false)
    }
  }

  const handleSave = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setSettings(prev => ({ ...prev, [k]: v }))

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 3, py: 1.5, gap: 1 }}>
        <IconButton size="small" onClick={onBack}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>设置</Typography>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>保存</Button>
      </Box>

      <Divider />

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 3 }}>
        <Box sx={{ maxWidth: 600 }}>

          {/* ── Environment Status ─────────────────────────────────────────── */}
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            本地环境
          </Typography>

          <Paper sx={{ p: 3, mb: 3 }}>
            {checkingSetup ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <CircularProgress size={18} />
                <Typography color="text.secondary">检查环境...</Typography>
              </Box>
            ) : setupStatus ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <StatusRow
                  ok={setupStatus.pythonOk}
                  label="Python"
                  detail={setupStatus.pythonOk ? setupStatus.pythonVersion : '未检测到 Python，请安装 Python 3.9+'}
                />
                <StatusRow
                  ok={setupStatus.fasterWhisperOk}
                  label="faster-whisper"
                  detail={setupStatus.fasterWhisperOk ? '已安装' : '未安装（推荐）'}
                />
                {!setupStatus.fasterWhisperOk && setupStatus.openaiWhisperOk && (
                  <StatusRow
                    ok={true}
                    label="openai-whisper"
                    detail="已安装（备用方案）"
                  />
                )}

                {/* Install button */}
                {setupStatus.pythonOk && !setupStatus.anyWhisperOk && !installing && (
                  <Box sx={{ mt: 1 }}>
                    <Alert severity="warning" sx={{ borderRadius: 2, mb: 1.5 }}>
                      未检测到 Whisper，需要安装 faster-whisper 才能转录音频。
                    </Alert>
                    <Button
                      variant="contained"
                      startIcon={<DownloadIcon />}
                      onClick={handleInstall}
                    >
                      一键安装 faster-whisper
                    </Button>
                  </Box>
                )}

                {setupStatus.pythonOk && !setupStatus.fasterWhisperOk && setupStatus.anyWhisperOk && (
                  <Box sx={{ mt: 1 }}>
                    <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleInstall}>
                      升级安装 faster-whisper（推荐）
                    </Button>
                  </Box>
                )}

                {!setupStatus.pythonOk && (
                  <Alert severity="error" sx={{ borderRadius: 2 }}>
                    未找到 Python。请从 <a href="https://python.org" target="_blank" rel="noreferrer" style={{ color: '#D0BCFF' }}>python.org</a> 安装 Python 3.9+ 并勾选"Add to PATH"。
                  </Alert>
                )}

                {setupStatus.anyWhisperOk && (
                  <Alert severity="success" sx={{ borderRadius: 2 }}>
                    环境已就绪，无需任何 API Key，转录在本机运行。
                  </Alert>
                )}
              </Box>
            ) : null}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Button size="small" onClick={refreshSetupCheck} disabled={checkingSetup}>
                刷新检测
              </Button>
            </Box>
          </Paper>

          {/* ── Install Log ───────────────────────────────────────────────── */}
          {(installing || installLines.length > 0) && (
            <Paper sx={{ p: 0, mb: 3, overflow: 'hidden' }}>
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'rgba(208,188,255,0.06)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {installing && <CircularProgress size={14} />}
                    <Typography variant="body2">安装日志</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <List
                    dense
                    disablePadding
                    sx={{
                      maxHeight: 200,
                      overflow: 'auto',
                      bgcolor: '#0D0D0F',
                      fontFamily: 'monospace',
                      fontSize: 12
                    }}
                  >
                    {installLines.map((line, i) => (
                      <ListItem key={i} sx={{ py: 0.25, px: 2 }}>
                        <ListItemText
                          primary={line}
                          primaryTypographyProps={{ sx: { fontSize: 11, fontFamily: 'monospace', color: '#CAC4D0' } }}
                        />
                      </ListItem>
                    ))}
                    <div ref={logEndRef} />
                  </List>
                </AccordionDetails>
              </Accordion>
              {installError && (
                <Alert severity="error" sx={{ borderRadius: 0 }}>{installError}</Alert>
              )}
            </Paper>
          )}

          {/* ── Model Selection ───────────────────────────────────────────── */}
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            转录模型
          </Typography>
          <Paper sx={{ p: 3, mb: 3 }}>
            <FormControl fullWidth>
              <InputLabel>Whisper 模型</InputLabel>
              <Select
                value={settings.whisperModel}
                label="Whisper 模型"
                onChange={e => set('whisperModel', e.target.value as WhisperModelSize)}
              >
                {MODEL_OPTIONS.map(m => (
                  <MenuItem key={m.value} value={m.value}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, width: 80 }}>{m.label}</Typography>
                      <Chip label={m.size} size="small" sx={{ fontSize: 11 }} />
                      <Typography variant="caption" color="text.secondary">{m.note}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                首次使用所选模型时会自动从 HuggingFace 下载，之后缓存在本机
              </FormHelperText>
            </FormControl>
          </Paper>

          {/* ── Playback Preferences ─────────────────────────────────────── */}
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            播放偏好
          </Typography>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <FormControl fullWidth>
                <InputLabel>默认播放速度</InputLabel>
                <Select
                  value={settings.defaultSpeed}
                  label="默认播放速度"
                  onChange={e => set('defaultSpeed', Number(e.target.value))}
                >
                  {[0.5, 0.75, 1.0, 1.25, 1.5].map(v => (
                    <MenuItem key={v} value={v}>{v}x</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>默认循环次数</InputLabel>
                <Select
                  value={settings.defaultLoopCount}
                  label="默认循环次数"
                  onChange={e => set('defaultLoopCount', Number(e.target.value))}
                >
                  <MenuItem value={1}>不循环（播放一次）</MenuItem>
                  <MenuItem value={2}>循环 2 次</MenuItem>
                  <MenuItem value={3}>循环 3 次</MenuItem>
                  <MenuItem value={0}>无限循环</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Paper>
        </Box>
      </Box>

      <Snackbar
        open={saved}
        autoHideDuration={2000}
        onClose={() => setSaved(false)}
        message="设置已保存"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      {ok
        ? <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
        : <ErrorIcon sx={{ color: 'warning.main', fontSize: 18 }} />}
      <Typography variant="body2" sx={{ fontWeight: 500, width: 140, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" color="text.secondary">{detail}</Typography>
    </Box>
  )
}
