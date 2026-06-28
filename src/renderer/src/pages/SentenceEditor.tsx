import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Box, Typography, IconButton, Button, TextField, Tooltip,
  Divider, CircularProgress, Snackbar, Paper, Chip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import MergeIcon from '@mui/icons-material/MergeType'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import EditIcon from '@mui/icons-material/Edit'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { Sentence, Project } from '../types'

interface Props {
  projectId: string
  onBack: () => void
}

type EditMode =
  | { type: 'none' }
  | { type: 'split'; idx: number; splitAfterWord: number | null }
  | { type: 'text'; idx: number }   // input value lives in SentenceCard local state
  | { type: 'time'; idx: number }   // input values live in SentenceCard local state

// ─────────────────────────────────────────────────────────────────────────────

export default function SentenceEditor({ projectId, onBack }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>({ type: 'none' })
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null)

  // ── Preview audio (DOM-attached, single element for the whole page) ──────
  //
  // The <audio> element is rendered directly in this component's JSX below
  // (look for `<audio ref={previewAudioRef} … />`).  This is the same
  // pattern Player.tsx uses successfully; we do NOT wrap it in any memoized
  // sub-component — earlier attempts to "protect" it that way introduced
  // their own bugs (the ref binding got out of sync with the DOM element
  // under some re-render orderings).
  //
  // Why DOM-attached + a stable src works:
  //   - React mounts the element once and reuses it for the entire editor
  //     lifetime;
  //   - preload="auto" makes Chromium load metadata immediately;
  //   - because the src string doesn't change across renders, React never
  //     re-reconciles it, so loaded metadata is never flushed;
  //   - because the IPC save path is async (see store.setSentencesAsync),
  //     the main process never blocks long enough to wedge the media://
  //     pipeline.
  //
  // previewStopRef holds the current boundary `timeupdate` listener so we
  // can detach it precisely before starting a new preview.
  // previewSessionRef is bumped on every preview; any pending listener that
  // sees a session change bails out, so rapid clicks never race.
  const previewAudioRef   = useRef<HTMLAudioElement | null>(null)
  const previewStopRef    = useRef<(() => void) | null>(null)
  const previewSessionRef = useRef(0)

  // ── Audio src with cache-buster ────────────────────────────────────────────
  //
  // Chromium's internal media cache (ResourceMultiBuffer) fuses partial
  // buffers across different <audio> elements that point at the same URL.
  // Empirically, when this editor mounts AFTER the Player page has loaded
  // the same media:// URL, Chromium starts the new request at the cache-
  // aligned offset 589824 (= 9 * 65536) instead of 0, then hands FFmpeg-
  // Demuxer the stitched cached+fresh buffer.  Whatever's wrong with the
  // cached half makes the demuxer fail with MEDIA_ERR_SRC_NOT_SUPPORTED
  // (error.code === 4, "PIPELINE_ERROR_READ: FFmpegDemuxer: data source
  // error"), latching the audio element into an unrecoverable state.
  //
  // Appending a per-mount cache-buster guarantees the URL is unique, so
  // Chromium has no cache to fuse from and fetches the file fresh.  The
  // main-process media handler strips the query string before resolving
  // the project id, so this only affects the cache key — not the response.
  const audioSrc = useMemo(
    () => `${window.electronAPI.getAudioUrl(projectId)}?cb=${Date.now()}`,
    [projectId]
  )

  useEffect(() => {
    return () => {
      // Cleanup on unmount: invalidate any pending listeners and detach the
      // boundary timeupdate listener.  React itself removes the <audio>
      // element from the DOM, which closes its underlying media resource.
      ++previewSessionRef.current
      const audio = previewAudioRef.current
      if (audio && previewStopRef.current) {
        audio.removeEventListener('timeupdate', previewStopRef.current)
      }
      previewStopRef.current = null
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    window.electronAPI.getProjectData(projectId)
      .then((data: unknown) => {
        const { project: p, sentences: s } = data as { project: Project; sentences: Sentence[] }
        setProject(p)
        setSentences(s)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId])

  // ── Diagnostic: log every meaningful audio element event ──────────────────
  //
  // This is purely for debugging the "preview doesn't work" reports.  When
  // the user opens DevTools and runs through a repro, the console becomes a
  // complete narrative of what Chromium did to the <audio> element: did
  // metadata load?  did play() start playback?  did an error fire?  did
  // Chromium emit 'stalled' or 'suspend' partway through?
  //
  // We attach the listeners only AFTER loading completes (otherwise the
  // <audio> element doesn't exist yet — see the conditional render below).
  useEffect(() => {
    if (loading) return
    const audio = previewAudioRef.current
    if (!audio) {
      console.warn('[audio] ref not set after loading=false; <audio> not mounted?')
      return
    }
    console.log('[audio] mount', {
      src: audio.src,
      readyState: audio.readyState,
      networkState: audio.networkState,
      preload: audio.preload,
    })
    const events = [
      'loadstart', 'progress', 'suspend', 'abort', 'error', 'emptied',
      'stalled', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough',
      'playing', 'waiting', 'seeking', 'seeked', 'ended', 'pause', 'play',
    ] as const
    const handlers: Array<[string, EventListener]> = []
    for (const name of events) {
      const h: EventListener = () => {
        console.log(`[audio:${name}]`, {
          readyState: audio.readyState,
          networkState: audio.networkState,
          paused: audio.paused,
          currentTime: audio.currentTime,
          error: audio.error?.code,
        })
      }
      audio.addEventListener(name, h)
      handlers.push([name, h])
    }
    return () => {
      for (const [name, h] of handlers) audio.removeEventListener(name, h)
    }
  }, [loading])

  const markDirty = () => setDirty(true)

  // ── Preview playback ─────────────────────────────────────────────────────
  //
  // Plays the [s.start, s.end] window of the project audio using the
  // DOM-attached <audio> element below.
  //
  // This implementation mirrors Player.tsx's seekAndPlay (which has proven
  // reliable across thousands of clicks).  The key insight — learned the
  // hard way over many failed iterations — is that Chromium's <audio>
  // element pipeline does NOT cleanly accept pause → currentTime → play in
  // a single synchronous block during rapid interactions: the new currentTime
  // and play() pile up while the previous pause is still mid-transition,
  // and the result is a play() Promise that never settles ("clicked but
  // nothing happens").  Yielding to the event loop for one tick between
  // pause and play lets the pipeline reach a quiescent state, after which
  // the new seek+play is accepted reliably.
  //
  // We also deliberately do NOT wait for a 'seeked' event.  Chromium can
  // skip 'seeked' under several edge-cases (no-op seek within its internal
  // tolerance, seek issued while readyState < HAVE_METADATA, seek issued
  // while another seek is still in flight).  Setting currentTime + calling
  // play() right after is enough — Chromium queues both and play() resolves
  // when playback actually starts at the new position.
  //
  // The session token (previewSessionRef) cancels any deferred work from a
  // previous preview, so rapid clicks across different sentences never race.
  const previewSentence = useCallback((s: Sentence) => {
    const audio = previewAudioRef.current
    console.log('[preview] click', {
      sentence: { idx: s.index, start: s.start, end: s.end },
      audioPresent: !!audio,
      readyState: audio?.readyState,
      networkState: audio?.networkState,
      paused: audio?.paused,
      currentTime: audio?.currentTime,
      error: audio?.error?.code,
      src: audio?.src,
    })
    if (!audio) {
      console.warn('[preview] audio ref is null — nothing to play')
      return
    }

    // Detach the previous boundary listener (if any) before we kick off a
    // new preview — otherwise the old listener could pause the audio at the
    // PREVIOUS sentence's end while the new preview is mid-playback.
    if (previewStopRef.current) {
      audio.removeEventListener('timeupdate', previewStopRef.current)
      previewStopRef.current = null
    }

    // STEP 1 (synchronous): force a clean paused state.  This also aborts
    // any in-flight audio.play() Promise from the previous preview (it
    // rejects with AbortError, caught silently below).
    audio.pause()

    const session = ++previewSessionRef.current
    const isMine = () => session === previewSessionRef.current

    // STEP 2 (next event-loop tick): seek + play.
    //
    // The setTimeout(0) yield is load-bearing.  Without it Chromium's audio
    // pipeline accumulates unfinished pause/play state transitions under
    // rapid clicks and the N-th preview becomes a silent no-op.  Yielding
    // lets:
    //   - the 'pause' event fire on the audio element
    //   - the previous play() Promise settle (AbortError)
    //   - Chromium's media pipeline reach a quiescent paused state
    // before we issue the new currentTime + play() pair.
    //
    // We deliberately do NOT wait for 'seeked'.  Chromium can skip the
    // event under several edge-cases (no-op seek within its internal
    // tolerance, seek issued while readyState < HAVE_METADATA, seek
    // issued while another seek is in flight).  Setting currentTime +
    // calling play() right after is enough — Chromium queues both and
    // play() resolves when playback actually starts at the new position.
    setTimeout(() => {
      if (!isMine()) {
        console.log('[preview] session superseded before seek, skipping', { session })
        return
      }

      audio.currentTime = s.start
      console.log('[preview] seek + play()', {
        target: s.start,
        readyState: audio.readyState,
        networkState: audio.networkState,
      })

      audio.play()
        .then(() => {
          if (!isMine()) { audio.pause(); return }
          console.log('[preview] play() resolved, playing', {
            currentTime: audio.currentTime,
            end: s.end,
          })
          const end = s.end
          const stop = () => {
            if (audio.currentTime >= end) {
              audio.pause()
              audio.removeEventListener('timeupdate', stop)
              if (previewStopRef.current === stop) previewStopRef.current = null
              console.log('[preview] reached end, paused', { currentTime: audio.currentTime })
            }
          }
          previewStopRef.current = stop
          audio.addEventListener('timeupdate', stop)
        })
        .catch(err => {
          const name = (err as DOMException).name
          if (name === 'AbortError') return  // expected: superseded by next preview
          console.error('[preview] play() rejected:', name, (err as DOMException).message, {
            readyState: audio.readyState,
            networkState: audio.networkState,
            error: audio.error?.code,
            errorMsg: audio.error?.message,
          })
        })
    }, 0)
  }, [])

  // ── Save ─────────────────────────────────────────────────────────────────
  //
  // The IPC handler in the main process uses fs.promises.writeFile (NOT
  // writeFileSync) — see store.setSentencesAsync.  This is important: a
  // synchronous write would stall the main-process event loop, which in
  // turn stalls the media:// protocol handler.  Empirically, a stalled
  // protocol handler in the middle of an in-flight Range fetch leaves the
  // renderer's <audio> element in a "soft-wedged" state where:
  //
  //     • audio.error is null (looks healthy)
  //     • audio.readyState is >= HAVE_METADATA (looks loaded)
  //     • audio.play() returns a Promise that *never settles*
  //
  // By keeping the write async, the protocol handler is never stalled and
  // the audio element stays in a clean state — so the next preview click
  // is instant (no reload, no metadata wait).
  const handleSave = async () => {
    console.log('[save] start', { count: sentences.length })
    setSaving(true)
    try {
      await window.electronAPI.saveSentences(projectId, sentences)
      setDirty(false)
      setSaved(true)
      console.log('[save] done', {
        audioReadyState: previewAudioRef.current?.readyState,
        audioPaused: previewAudioRef.current?.paused,
        audioError: previewAudioRef.current?.error?.code,
      })
    } catch (err) {
      console.error('[save] failed:', err)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const confirmDelete = () => {
    if (deleteIdx === null) return
    setSentences(prev => reindex(prev.filter((_, i) => i !== deleteIdx)))
    setDeleteIdx(null)
    setEditMode({ type: 'none' })
    markDirty()
  }

  // ── Merge ─────────────────────────────────────────────────────────────────
  const mergeSentences = (idx: number) => {
    setSentences(prev => {
      const next = [...prev]
      const a = next[idx]
      const b = next[idx + 1]
      if (!a || !b) return prev
      next.splice(idx, 2, { ...a, end: b.end, text: `${a.text} ${b.text}`.trim() })
      return reindex(next)
    })
    setEditMode({ type: 'none' })
    markDirty()
  }

  // ── Split ─────────────────────────────────────────────────────────────────
  const confirmSplit = (idx: number, splitAfterWord: number) => {
    setSentences(prev => {
      const next = [...prev]
      const s = next[idx]
      if (!s) return prev
      const words = tokenize(s.text)
      const beforeText = words.slice(0, splitAfterWord + 1).join(' ')
      const afterText = words.slice(splitAfterWord + 1).join(' ')
      if (!beforeText.trim() || !afterText.trim()) return prev
      const ratio = beforeText.length / s.text.length
      const splitTime = +(s.start + (s.end - s.start) * ratio).toFixed(3)
      next.splice(idx, 1,
        { ...s, end: splitTime, text: beforeText.trim() },
        { ...s, id: `${s.projectId}-split-${Date.now()}`, start: splitTime, text: afterText.trim() }
      )
      return reindex(next)
    })
    setEditMode({ type: 'none' })
    markDirty()
  }

  // ── Text edit ─────────────────────────────────────────────────────────────
  const commitTextEdit = (idx: number, value: string) => {
    if (!value.trim()) return
    setSentences(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], text: value.trim() }
      return next
    })
    setEditMode({ type: 'none' })
    markDirty()
  }

  // ── Time edit ─────────────────────────────────────────────────────────────
  const startTimeEdit = (idx: number) => {
    setEditMode({ type: 'time', idx })
  }

  const commitTimeEdit = (idx: number, startStr: string, endStr: string) => {
    const start = strToSecs(startStr)
    const end = strToSecs(endStr)
    if (start === null || end === null || start < 0 || end <= start) return
    setSentences(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], start: +start.toFixed(3), end: +end.toFixed(3) }
      return next
    })
    setEditMode({ type: 'none' })
    markDirty()
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* DOM-attached preview audio.  Uses audioSrc (cache-buster URL,
          see useMemo above) so Chromium can't reuse poisoned media-cache
          chunks from a previous <audio> element on the same project. */}
      <audio
        ref={previewAudioRef}
        src={audioSrc}
        preload="auto"
      />

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 3, py: 1.5, gap: 1, flexShrink: 0 }}>
        <IconButton size="small" onClick={onBack}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6">编辑断句</Typography>
          <Typography variant="caption" color="text.secondary">
            {project?.title} · {sentences.length} 句
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <CheckIcon />}
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          保存
        </Button>
      </Box>

      {/* Tip bar */}
      <Box sx={{ px: 3, pb: 1.5, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary">
          · 点击 <b>时间标签</b> 可手动调整句子起止时间
          &nbsp;·&nbsp;点击 <b>✂ 拆分</b> 后点击词间 <b>｜</b> 设置断点
          &nbsp;·&nbsp;点击 <b>合并</b> 合并相邻句
          &nbsp;·&nbsp;点击 <b>🗑 删除</b> 删除该句
        </Typography>
      </Box>

      <Divider />

      {/* Sentence list
          data-has-active drives CSS-based dimming of inactive cards so they
          don't need to re-render just to change their opacity. */}
      <Box
        data-has-active={editMode.type !== 'none' ? '' : undefined}
        sx={{
          flex: 1, overflow: 'auto', px: 3, py: 2,
          // Dim every sentence card that is NOT the active one.
          // Specificity: [attr](0,1,0) + .class(0,1,0) + :not(.class)(0,1,0) = 0,3,0
          // This beats the Paper's generated class (0,1,0), so CSS wins.
          '&[data-has-active] .sc-paper:not(.sc-paper-active)': {
            opacity: 0.4,
          },
          '.sc-paper': { transition: 'opacity 0.15s' },
        }}
      >
        {sentences.length === 0 && (
          <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>暂无句子数据</Typography>
        )}

        {sentences.map((s, idx) => (
          <Box key={s.id}>
            <SentenceCard
              sentence={s}
              idx={idx}
              // Active card gets the real editMode; every other card gets the
              // stable NONE_MODE constant so React.memo skips them on every
              // editMode change that doesn't affect them.
              editMode={
                editMode.type !== 'none' && editMode.idx === idx
                  ? editMode
                  : NONE_MODE
              }
              onPreview={() => previewSentence(s)}
              onStartSplit={() => setEditMode({ type: 'split', idx, splitAfterWord: null })}
              onCancelEdit={() => setEditMode({ type: 'none' })}
              onConfirmSplit={(wordIdx) => confirmSplit(idx, wordIdx)}
              onStartTextEdit={() => setEditMode({ type: 'text', idx })}
              onConfirmTextEdit={(v) => commitTextEdit(idx, v)}
              onStartTimeEdit={() => startTimeEdit(idx)}
              onConfirmTimeEdit={(startStr, endStr) => commitTimeEdit(idx, startStr, endStr)}
              onDelete={() => setDeleteIdx(idx)}
            />

            {idx < sentences.length - 1 && (
              <MergeDivider
                onMerge={() => mergeSentences(idx)}
                disabled={editMode.type !== 'none'}
              />
            )}
          </Box>
        ))}

        <Box sx={{ height: 48 }} />
      </Box>

      <Snackbar
        open={saved}
        autoHideDuration={2000}
        onClose={() => setSaved(false)}
        message="断句已保存"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      {/* Delete confirm dialog */}
      <Dialog open={deleteIdx !== null} onClose={() => setDeleteIdx(null)}>
        <DialogTitle>删除句子</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将删除第 {deleteIdx !== null ? deleteIdx + 1 : ''} 句，删除后需重新保存。
          </DialogContentText>
          {deleteIdx !== null && sentences[deleteIdx] && (
            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'rgba(242,184,181,0.08)', borderRadius: 1.5, border: '1px solid rgba(242,184,181,0.2)' }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                "{sentences[deleteIdx].text}"
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteIdx(null)}>取消</Button>
          <Button color="error" onClick={confirmDelete}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SentenceCard
// ─────────────────────────────────────────────────────────────────────────────

// Stable sentinel for non-active cards. All inactive cards share the same
// object reference, so React.memo's reference-equality check skips them
// entirely whenever only the active card's editMode changes.
const NONE_MODE: EditMode = { type: 'none' }

// Custom equality: uses reference equality on editMode (safe because non-active
// cards always receive the NONE_MODE constant, and the active card receives the
// real editMode object which changes when its editing state changes).
// Callbacks are intentionally ignored — they always get new references from
// inline .map() lambdas, but are safe because they use stable React setters or
// functional updaters that don't close over the sentences array.
function sentenceCardEqual(prev: CardProps, next: CardProps): boolean {
  if (prev.sentence !== next.sentence) return false
  if (prev.idx !== next.idx) return false
  if (prev.editMode !== next.editMode) return false  // reference equality
  return true
}

interface CardProps {
  sentence: Sentence
  idx: number
  editMode: EditMode
  onPreview: () => void
  onStartSplit: () => void
  onCancelEdit: () => void
  onConfirmSplit: (wordIdx: number) => void
  onStartTextEdit: () => void
  onConfirmTextEdit: (v: string) => void
  onStartTimeEdit: () => void
  onConfirmTimeEdit: (startStr: string, endStr: string) => void
  onDelete: () => void
}

function SentenceCardInner({
  sentence, idx, editMode,
  onPreview, onStartSplit, onCancelEdit,
  onConfirmSplit, onStartTextEdit, onConfirmTextEdit,
  onStartTimeEdit, onConfirmTimeEdit, onDelete
}: CardProps) {
  const isSplitting = editMode.type === 'split' && editMode.idx === idx
  const isEditingText = editMode.type === 'text' && editMode.idx === idx
  const isEditingTime = editMode.type === 'time' && editMode.idx === idx
  const isActive = isSplitting || isEditingText || isEditingTime
  const words = tokenize(sentence.text)

  // ── Local input state (never propagated to parent during typing) ───────────
  // Only the final confirmed value bubbles up, so keystrokes don't re-render
  // the entire sentence list.
  const [localText, setLocalText] = useState(sentence.text)
  const [localStartStr, setLocalStartStr] = useState('')
  const [localEndStr, setLocalEndStr] = useState('')

  // Sync local text/time values when this card enters edit mode.
  useEffect(() => {
    if (isEditingText) setLocalText(sentence.text)
  }, [isEditingText])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditingTime) {
      setLocalStartStr(secsToStr(sentence.start))
      setLocalEndStr(secsToStr(sentence.end))
    }
  }, [isEditingTime])   // eslint-disable-line react-hooks/exhaustive-deps

  const borderColor = isEditingTime
    ? 'warning.main'
    : isSplitting
    ? 'primary.main'
    : isEditingText
    ? 'secondary.main'
    : 'rgba(202,196,208,0.12)'

  return (
    <Paper
      elevation={0}
      // sc-paper-active tells the parent's CSS rule NOT to dim this card.
      // Opacity is handled entirely via CSS ([data-has-active] .sc-paper:not(.sc-paper-active))
      // so non-active cards never need to re-render just for the dim/undim transition.
      className={isActive ? 'sc-paper sc-paper-active' : 'sc-paper'}
      sx={{
        p: 2, mb: 0,
        border: '1px solid',
        borderColor,
        borderRadius: 2,
        transition: 'border-color 0.15s'
      }}
    >
      {/* ── Time row ──────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>

        {/* ── Time editing mode ─────────────────────────────────────────── */}
        {isEditingTime ? (
          <>
            <AccessTimeIcon sx={{ color: 'warning.main', fontSize: 16 }} />
            <TextField
              size="small"
              label="开始"
              value={localStartStr}
              onChange={e => setLocalStartStr(e.target.value)}
              sx={{ width: 110, '& input': { fontFamily: 'monospace', fontSize: 13 } }}
              error={strToSecs(localStartStr) === null}
              helperText='格式 m:ss.ss'
            />
            <Typography color="text.secondary">–</Typography>
            <TextField
              size="small"
              label="结束"
              value={localEndStr}
              onChange={e => setLocalEndStr(e.target.value)}
              sx={{ width: 110, '& input': { fontFamily: 'monospace', fontSize: 13 } }}
              error={strToSecs(localEndStr) === null}
              helperText='格式 m:ss.ss'
            />
            <Tooltip title="确认时间">
              <span>
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => onConfirmTimeEdit(localStartStr, localEndStr)}
                  disabled={
                    strToSecs(localStartStr) === null ||
                    strToSecs(localEndStr) === null ||
                    (strToSecs(localStartStr) ?? 0) >= (strToSecs(localEndStr) ?? 0)
                  }
                >
                  <CheckIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="取消">
              <IconButton size="small" onClick={onCancelEdit}>
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          /* ── Normal time chip (clickable) ──────────────────────────────── */
          <Tooltip title="点击手动调整时间范围">
            <Chip
              icon={<AccessTimeIcon sx={{ fontSize: '13px !important' }} />}
              label={`${formatTime(sentence.start)} – ${formatTime(sentence.end)}`}
              size="small"
              onClick={onStartTimeEdit}
              sx={{
                fontFamily: 'monospace',
                fontSize: 11,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'rgba(255,200,80,0.15)', borderColor: 'warning.main' },
                border: '1px solid rgba(202,196,208,0.2)'
              }}
            />
          </Tooltip>
        )}

        {!isEditingTime && (
          <>
            <Typography variant="caption" color="text.secondary">
              {(sentence.end - sentence.start).toFixed(1)}s
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">#{idx + 1}</Typography>
          </>
        )}

        {/* ── Action buttons (when idle) ─────────────────────────────────── */}
        {!isActive && (
          <>
            <Tooltip title="预听此句">
              <IconButton size="small" onClick={onPreview}>
                <PlayArrowIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="编辑文本">
              <IconButton size="small" onClick={onStartTextEdit}>
                <EditIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="在词间拆分">
              <IconButton size="small" color="primary" onClick={onStartSplit} disabled={words.length < 2}>
                <ContentCutIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="删除此句">
              <IconButton size="small" color="error" onClick={onDelete}>
                <DeleteIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </>
        )}

        {/* Cancel when splitting or editing text */}
        {(isSplitting || isEditingText) && (
          <Tooltip title="取消">
            <IconButton size="small" onClick={onCancelEdit}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* ── Split mode ────────────────────────────────────────────────────── */}
      {isSplitting && (
        <Box>
          <Typography variant="caption" color="primary.main" sx={{ display: 'block', mb: 1 }}>
            点击词后的 ｜ 设置断句位置
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', lineHeight: 2 }}>
            {words.map((word, wi) => (
              <Box key={wi} sx={{ display: 'inline-flex', alignItems: 'center' }}>
                <Typography component="span" sx={{ px: 0.5, py: 0.25, borderRadius: 1 }}>
                  {word}
                </Typography>
                {wi < words.length - 1 && (
                  <Tooltip title={`在"${word}"后断句`} placement="top">
                    <Box
                      component="span"
                      onClick={() => onConfirmSplit(wi)}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 20,
                        height: 24,
                        cursor: 'pointer',
                        color: 'primary.main',
                        opacity: 0.3,
                        fontSize: 16,
                        fontWeight: 700,
                        transition: 'opacity 0.15s, transform 0.15s',
                        '&:hover': { opacity: 1, transform: 'scaleY(1.3)' }
                      }}
                    >
                      ｜
                    </Box>
                  </Tooltip>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Text edit mode ────────────────────────────────────────────────── */}
      {isEditingText && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            size="small"
            value={localText}
            onChange={e => setLocalText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onConfirmTextEdit((e.target as HTMLTextAreaElement).value)
              }
            }}
            autoFocus
            inputProps={{ style: { fontSize: 14, lineHeight: 1.6 } }}
          />
          <Tooltip title="确认 (Enter)">
            <IconButton color="primary" onClick={() => onConfirmTextEdit(localText)} disabled={!localText.trim()}>
              <CheckIcon />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* ── Normal text display ───────────────────────────────────────────── */}
      {!isSplitting && !isEditingText && !isEditingTime && (
        <Typography
          variant="body2"
          sx={{ lineHeight: 1.7, cursor: 'text', userSelect: 'text' }}
          onDoubleClick={onStartTextEdit}
        >
          {sentence.text}
        </Typography>
      )}
    </Paper>
  )
}

const SentenceCard = React.memo(SentenceCardInner, sentenceCardEqual)

// ─────────────────────────────────────────────────────────────────────────────
// MergeDivider
// ─────────────────────────────────────────────────────────────────────────────

function MergeDividerInner({ onMerge, disabled }: { onMerge: () => void; disabled: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center', my: 0.25 }}
    >
      <Divider sx={{ flex: 1, borderColor: hover ? 'primary.main' : 'rgba(202,196,208,0.08)', transition: 'border-color 0.2s' }} />
      <Box
        sx={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          bgcolor: 'background.paper', px: 0.5
        }}
      >
        <Button
          size="small"
          startIcon={<MergeIcon sx={{ fontSize: '14px !important' }} />}
          onClick={onMerge}
          disabled={disabled}
          sx={{
            fontSize: 11, height: 22, px: 1, minWidth: 0,
            color: 'text.secondary',
            opacity: hover ? 1 : 0,
            transition: 'opacity 0.2s',
            '&:hover': { color: 'primary.main', bgcolor: 'rgba(208,188,255,0.1)' }
          }}
        >
          合并
        </Button>
      </Box>
    </Box>
  )
}

// Callback (onMerge) is ignored in equality; safe because mergeSentences uses
// setSentences with a functional updater and doesn't capture sentences state.
const MergeDivider = React.memo(MergeDividerInner, (prev, next) => prev.disabled === next.disabled)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function reindex(sentences: Sentence[]): Sentence[] {
  return sentences.map((s, i) => ({ ...s, index: i }))
}

/** Format seconds as m:ss.ss */
function formatTime(secs: number): string {
  if (!secs && secs !== 0) return '--'
  const m = Math.floor(secs / 60)
  const s = (secs - m * 60).toFixed(2)
  return `${m}:${s.padStart(5, '0')}`
}

/** "m:ss.ss" → seconds.  Returns null if unparseable. */
function strToSecs(str: string): number | null {
  const withColon = /^(\d+):(\d+(?:\.\d+)?)$/.exec(str.trim())
  if (withColon) return parseInt(withColon[1], 10) * 60 + parseFloat(withColon[2])
  const plain = /^(\d+(?:\.\d+)?)$/.exec(str.trim())
  if (plain) return parseFloat(plain[1])
  return null
}

/** seconds → "m:ss.ss" */
function secsToStr(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = (secs - m * 60).toFixed(2)
  return `${m}:${s.padStart(5, '0')}`
}
