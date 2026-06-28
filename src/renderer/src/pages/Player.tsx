import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Box, Typography, IconButton, Slider, Chip, Tooltip,
  CircularProgress, Paper, List, ListItemButton, ListItemText, Divider
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import RepeatOneIcon from '@mui/icons-material/RepeatOne'
import RepeatIcon from '@mui/icons-material/Repeat'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import TuneIcon from '@mui/icons-material/Tune'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import ShuffleIcon from '@mui/icons-material/Shuffle'
import ShuffleOnIcon from '@mui/icons-material/ShuffleOn'
import type { Project, Sentence } from '../types'

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5]
const LOOP_OPTIONS = [1, 2, 3, 0] // 0 = infinite

// ── Playback modes ─────────────────────────────────────────────────────────
type PlayMode = 'sequential' | 'shuffle' | 'shuffle-repeat'
const PLAY_MODES: PlayMode[] = ['sequential', 'shuffle', 'shuffle-repeat']
const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  'sequential':     '顺序',
  'shuffle':        '随机',
  'shuffle-repeat': '随机∞',
}
const PLAY_MODE_TOOLTIPS: Record<PlayMode, string> = {
  'sequential':     '顺序播放（按列表顺序）',
  'shuffle':        '随机播放（打乱一次）',
  'shuffle-repeat': '随机循环（每轮重新打乱）',
}

/** Fisher-Yates shuffle, returns a new array. */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Build a playback queue (array of sentence indices in playback order).
 *
 * In shuffle modes, if `anchorIdx` is a valid sentence index, it is moved to
 * the head of the queue so that we play that sentence first.  This makes
 * mode-switching feel natural — the sentence the user is currently on stays
 * "current" and playback continues from there in the new (random) order.
 */
function buildPlayQueue(mode: PlayMode, count: number, anchorIdx: number): number[] {
  if (count <= 0) return []
  const seq = Array.from({ length: count }, (_, i) => i)
  if (mode === 'sequential') return seq

  const shuffled = shuffleArray(seq)
  if (anchorIdx >= 0 && anchorIdx < count) {
    const pos = shuffled.indexOf(anchorIdx)
    if (pos > 0) {
      ;[shuffled[0], shuffled[pos]] = [shuffled[pos], shuffled[0]]
    }
  }
  return shuffled
}

interface Props {
  projectId: string
  onBack: () => void
  onEditSentences?: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Player — simplified playback control.
//
// Design notes (after many failed attempts at version-tracking / pending-gates):
//
// • isPlaying is driven *only* by the audio element's 'play' / 'pause' events.
//   No code path calls setIsPlaying(true|false) directly.  This is the single
//   source of truth and eliminates every "UI shows playing but audio is silent"
//   class of bug.
//
// • Auto-advance (timeupdate handler) does NOT call audio.play().  The audio
//   element is already playing; we just move currentTime forward.  Issuing a
//   new play() while one is in flight is what created the cascade of
//   AbortError races we kept chasing.
//
// • The only place audio.play() is called is in seekAndPlay / togglePlay (user
//   actions).  AbortError there is silently ignored — it means a newer call
//   superseded us, and the newer call's own play/pause events will drive UI.
//
// • isProgrammaticSeekRef guards the 'seeked' handler so OUR seeks don't
//   trigger the "user moved the playhead" branch (which would clobber
//   currentIdx / loopsDone).  Setting currentTime in advance / loop / click
//   always sets this flag first, and 'seeked' clears it.
//
// • audio.seeking + audio.paused + isProgrammaticSeekRef together gate the
//   timeupdate handler, so it can't run mid-seek with a stale state.
// ─────────────────────────────────────────────────────────────────────────────

export default function Player({ projectId, onBack, onEditSentences }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [loading, setLoading] = useState(true)

  // Per-mount cache-buster on the audio URL.  Prevents Chromium from fusing
  // media-cache buffers across two <audio> elements that share the same
  // media:// URL (Player ↔ SentenceEditor toggling), which was poisoning
  // the demuxer and tripping MEDIA_ERR_SRC_NOT_SUPPORTED.  See the equivalent
  // block in SentenceEditor.tsx for the full rationale.
  const audioSrc = useMemo(
    () => `${window.electronAPI.getAudioUrl(projectId)}?cb=${Date.now()}`,
    [projectId]
  )

  // ── UI state ────────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loopsDone, setLoopsDone] = useState(0)
  const [maxLoops, setMaxLoops] = useState(1)
  const [speed, setSpeed] = useState(1.0)
  const [playMode, setPlayMode] = useState<PlayMode>('sequential')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sentenceListRef = useRef<HTMLDivElement>(null)

  // ── Refs mirroring state so event handlers see live values ─────────────────
  // (handlers are registered once with [] deps — they can't see fresh state
  // through closure, so we read these refs instead).
  const sentencesRef  = useRef<Sentence[]>([])
  const currentIdxRef = useRef(0)
  const loopsDoneRef  = useRef(0)
  const maxLoopsRef   = useRef(1)
  const speedRef      = useRef(1.0)
  const playModeRef   = useRef<PlayMode>('sequential')

  // ── Playback queue ─────────────────────────────────────────────────────────
  //
  // A playback queue is an ordered list of sentence indices.  It is the
  // single source of truth for "what is the next sentence?" — both for
  // automatic advance (timeupdate handler) and manual prev/next buttons.
  //
  // queuePosRef points at the current slot in this queue; the sentence
  // we are currently playing is always `playQueueRef.current[queuePosRef.current]`.
  // Whenever currentIdxRef is updated, queuePosRef is updated to match (and
  // vice-versa) so they never disagree.
  //
  // Sequential mode:    queue = [0, 1, 2, ..., N-1]
  // Shuffle mode:       queue = shuffled permutation; ends after one pass
  // Shuffle-repeat:     queue = shuffled; on exhaustion, reshuffle and continue
  const playQueueRef = useRef<number[]>([])
  const queuePosRef  = useRef(0)

  // Late-bound reference to seekAndPlay so that onTimeUpdate (registered
  // once on mount via useEffect[]) can dispatch into the *current* version
  // of seekAndPlay without re-registering listeners.
  const seekAndPlayRef = useRef<((idx: number) => void) | null>(null)

  /**
   * True while WE are programmatically moving audio.currentTime.
   * Cleared by the 'seeked' handler.  Tells onTimeUpdate to skip a tick (the
   * timeupdate event after a programmatic seek may fire with currentTime
   * already past the new sentence's end if we landed unluckily, e.g. on a
   * very short sentence).
   *
   * IMPORTANT: only set this flag via setProgrammaticTime() below.  Setting
   * audio.currentTime to a value already equal to the current position is a
   * no-op in Chromium — no 'seeked' event fires — which would leave this
   * flag stuck at true forever and disable onTimeUpdate permanently.
   */
  const isProgrammaticSeekRef = useRef(false)

  /**
   * Monotonically-increasing token for seekAndPlay invocations.
   * Lets retry/fallback callbacks bail out when a newer call has superseded
   * them (e.g. user clicked another sentence before our retry timer fired).
   */
  const playTokenRef = useRef(0)

  /**
   * True while seekAndPlay is in the middle of a hard reset (audio.load()).
   *
   * audio.load() resets currentTime to 0 and, in Chromium, can fire one or
   * more spurious 'seeked' events as the pipeline tears down and rebuilds.
   * Without this gate, onSeeked would mistake those for a user dragging the
   * progress slider to 0, call findSentenceAtTime(0) → idx 0, and reset
   * currentIdx to 0 — leaving playback wedged at the start of the very
   * first sentence ("playback starts from the beginning" symptom).
   */
  const isHardResettingRef = useRef(false)

  /**
   * Tracks the projectId whose data has *already* been applied to local
   * state (sentences/currentIdx).  This is the single most important guard
   * against the "from the beginning" symptom.
   *
   * The data-load effect runs `getProjectData(...).then(...)` and
   * unconditionally resets `currentIdxRef.current = 0`.  Under React Strict
   * Mode (dev) the effect runs twice — mount, unmount, mount — issuing two
   * in-flight fetches.  If the user clicks sents[10] BETWEEN the two
   * promise resolutions, the late resolution clobbers their selection
   * (currentIdx 10 → 0).  Then togglePlay reads idx=0 and plays sents[0]
   * — looking exactly like a "from the beginning" bug.
   *
   * By checking `loadedProjectIdRef.current === projectId` before resetting
   * the idx, we make second / repeated resolutions for the same project a
   * no-op, preserving the user's selection.
   */
  const loadedProjectIdRef = useRef<string | null>(null)

  /**
   * Move audio.currentTime to `target`, but only if it actually differs from
   * the current position.  Returns true iff a seek will occur.
   *
   * Setting currentTime to a value within ~50 ms of the existing position
   * is a no-op on Chromium (the seek algorithm short-circuits and no
   * 'seeked' event is queued), which previously left isProgrammaticSeekRef
   * stuck at true and silently disabled all auto-advance / loop logic.
   */
  const setProgrammaticTime = useCallback((audio: HTMLAudioElement, target: number): boolean => {
    if (Math.abs(audio.currentTime - target) <= 0.05) return false
    isProgrammaticSeekRef.current = true
    audio.currentTime = target
    return true
  }, [])

  const currentSentence = sentences[currentIdx]

  // ── Load project data ──────────────────────────────────────────────────────
  //
  // CRITICAL: every write here is gated against (a) the cancellation flag
  // (this effect's cleanup) AND (b) `loadedProjectIdRef`, which records the
  // projectId whose data has already been applied.  This protects us from
  // React Strict Mode's double-mount in dev (two in-flight fetches whose
  // .then() callbacks would otherwise both run and overwrite the user's
  // currentIdx selection back to 0 — that's the "always plays from the
  // beginning after clicking a list item" bug).
  useEffect(() => {
    setLoading(true)
    let cancelled = false

    window.electronAPI.getProjectData(projectId)
      .then((data: unknown) => {
        if (cancelled) return
        const { project: p, sentences: s } = data as { project: Project; sentences: Sentence[] }
        setProject(p)
        setSentences(s)
        sentencesRef.current = s

        // Only reset idx to 0 on the *first* successful load for this
        // projectId.  Repeated resolutions (Strict Mode, React fast refresh,
        // etc.) MUST NOT clobber an idx the user has since chosen.
        let anchor = currentIdxRef.current
        if (loadedProjectIdRef.current !== projectId) {
          loadedProjectIdRef.current = projectId
          currentIdxRef.current = 0
          setCurrentIdx(0)
          anchor = 0
        } else if (currentIdxRef.current >= s.length) {
          // Defensive: if the project's sentence list shrank between loads
          // (e.g. user edited sentences in another tab) and the current idx
          // is now out of bounds, snap back to 0.
          currentIdxRef.current = 0
          setCurrentIdx(0)
          anchor = 0
        }

        // (Re)build the playback queue.  Always rebuild after a successful
        // sentence load so the queue length matches sentences.length.
        const newQueue = buildPlayQueue(playModeRef.current, s.length, anchor)
        playQueueRef.current = newQueue
        queuePosRef.current  = Math.max(0, newQueue.indexOf(anchor))
      })
      .catch(err => { if (!cancelled) console.error(err) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [projectId])

  // ── Audio event listeners (registered ONCE) ────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // ── timeupdate: handle loop or advance to next sentence ──────────────────
    const onTimeUpdate = () => {
      // Gate the handler against three states where it would do the wrong thing:
      //
      //   audio.paused           — Chrome may fire timeupdate while paused.
      //   audio.seeking          — a seek is in flight; positions are unstable.
      //   isProgrammaticSeekRef  — we just set currentTime; wait until the
      //                            corresponding 'seeked' event lands before
      //                            considering further advances.
      if (audio.paused || audio.seeking || isProgrammaticSeekRef.current) return

      const sents = sentencesRef.current
      const idx = currentIdxRef.current
      const sentence = sents[idx]
      if (!sentence) return

      // Still inside the current sentence — nothing to do.
      if (audio.currentTime < sentence.end) return

      // Crossed the end of the current sentence.
      const loops = loopsDoneRef.current
      const maxL  = maxLoopsRef.current
      const shouldLoop = maxL === 0 || loops + 1 < maxL

      if (shouldLoop) {
        loopsDoneRef.current = loops + 1
        setLoopsDone(loops + 1)
        setProgrammaticTime(audio, sentence.start)
        // Audio is already playing — DO NOT call play().
        return
      }

      // No more loops on this sentence: reset and advance.
      loopsDoneRef.current = 0
      setLoopsDone(0)

      // ── Advance through the playback queue ─────────────────────────────
      const queue = playQueueRef.current
      let nextPos = queuePosRef.current + 1

      if (nextPos >= queue.length) {
        // Queue exhausted.
        if (playModeRef.current === 'shuffle-repeat') {
          // Reshuffle and continue.  Anchor = -1 so the first item is
          // random (anything is fine — we just played the queue end).
          playQueueRef.current = buildPlayQueue('shuffle', sents.length, -1)
          nextPos = 0
        } else {
          // Sequential or single-pass shuffle: stop at the end.
          // Bump the token so any in-flight retries don't "revive" playback.
          ++playTokenRef.current
          audio.pause()
          return
        }
      }

      queuePosRef.current = nextPos
      const nextIdx = playQueueRef.current[nextPos]
      currentIdxRef.current = nextIdx
      setCurrentIdx(nextIdx)
      const next = sents[nextIdx]

      if (playModeRef.current === 'sequential') {
        // Sequential mode: nextIdx is right after idx, the seek is short
        // (often contiguous).  Use a lightweight in-place seek so playback
        // stays smooth without going through the full pause+play pipeline.
        // Snap to the next sentence's start unless we're already inside its
        // window (which can happen if sentences are contiguous).
        if (audio.currentTime < next.start || audio.currentTime >= next.end) {
          setProgrammaticTime(audio, next.start)
        }
        // Audio keeps playing — DO NOT call play().
      } else {
        // Random mode: the next sentence is likely far from the current
        // playhead position.  Far seeks over media:// are prone to the
        // "wedged playing" failure mode, so route through seekAndPlay's
        // full pause+seek+play+retry pipeline rather than an inline seek.
        seekAndPlayRef.current?.(nextIdx)
      }
    }

    // ── seeked: distinguish OUR seeks from the user's slider drags ───────────
    const onSeeked = () => {
      // (1) Hard reset in progress (audio.load()) — every 'seeked' fired
      //     during this window is from the pipeline tearing down, never the
      //     user.  Ignoring them is essential; otherwise findSentenceAtTime(0)
      //     would yank currentIdx back to sentence 0 and the rest of
      //     seekAndPlay's retry chain would bail (isMine() fails).
      if (isHardResettingRef.current) return

      // (2) Our own programmatic seek — clear the flag and exit.
      if (isProgrammaticSeekRef.current) {
        isProgrammaticSeekRef.current = false
        return
      }

      // (3) Heuristic: a 'seeked' that lands at ~0 while currentIdx isn't
      //     already 0 is overwhelmingly a spurious Chromium event
      //     (audio.load, src reassignment, error recovery, etc.) — not a
      //     real user drag-to-zero.  Treat it as noise.
      if (audio.currentTime < 0.1 && currentIdxRef.current !== 0) return

      // (4) Audio is still in a transient loading state — ignore: the
      //     position isn't trustworthy yet.
      if (audio.readyState < 2 /* HAVE_CURRENT_DATA */) return

      // User moved the playhead (progress slider).
      const sents = sentencesRef.current
      const newIdx = findSentenceAtTime(sents, audio.currentTime)
      currentIdxRef.current = newIdx
      loopsDoneRef.current = 0
      setCurrentIdx(newIdx)
      setLoopsDone(0)
    }

    // ── play / pause / ended: single source of truth for isPlaying ───────────
    const onPlay  = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)

    const onError = () => {
      const err = audio.error
      if (err) console.error(`[audio] error code=${err.code} msg="${err.message}"`)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeked',     onSeeked)
    audio.addEventListener('play',       onPlay)
    audio.addEventListener('pause',      onPause)
    audio.addEventListener('ended',      onEnded)
    audio.addEventListener('error',      onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeked',     onSeeked)
      audio.removeEventListener('play',       onPlay)
      audio.removeEventListener('pause',      onPause)
      audio.removeEventListener('ended',      onEnded)
      audio.removeEventListener('error',      onError)
    }
  }, [])

  // ── Side effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const el = sentenceListRef.current
      ?.querySelector(`[data-idx="${currentIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIdx])

  // ── User actions ───────────────────────────────────────────────────────────
  /**
   * Jump to a sentence and start playing it from its start.
   *
   * The two failure modes we defend against
   * ───────────────────────────────────────
   *
   * (1) "Wedged playing": after seekAndPlay is called while audio is already
   *     playing, Chromium can leave the element in a state where
   *
   *       • audio.paused === false   (looks like it's playing)
   *       • audio.currentTime doesn't advance
   *       • no sound is produced
   *       • play() is a spec-compliant no-op (paused is already false)
   *
   *     Common after far seeks over custom protocols (media://) when the
   *     Range request stalls.
   *
   * (2) "N-th click does nothing": when the user rapidly clicks several
   *     different sentences, every click runs pause+seek+play synchronously.
   *     Chromium's internal pipeline accumulates unsettled state transitions
   *     across these tightly-coupled cycles, and the 3rd+ click can land in
   *     a corrupted state where play() never produces sound.
   *
   * Design
   * ──────
   *
   * STEP 1 (synchronous): audio.pause() — kicks any wedged playing state
   *   AND aborts any in-flight play() Promise from a previous invocation.
   *
   * STEP 2 (deferred to next event-loop task via setTimeout(0)):
   *   the actual seek + play + retry pipeline.  The task-tick yield lets
   *   the pause settle before we re-enter the play pipeline, breaking the
   *   tightly-coupled synchronous failure mode (2).  If the user clicks
   *   again within the ~4ms window, the new click bumps the token and
   *   the deferred work bails cleanly.
   *
   *   Sub-stages of STEP 2:
   *     a. setProgrammaticTime() — seek to the sentence's start
   *     b. tryPlay('initial') — start playback
   *     c. onReady (seeked/canplay event) — re-prime play() once ready
   *     d. @400ms timer — retry play if still paused, OR pause+play kick
   *        if wedged playing detected
   *     e. @1000ms timer — hard reset via audio.load() if either persistent
   *        paused or wedged
   *
   * Wedged detection: we sample audio.currentTime at the start of STEP 2
   * and check whether enough wall-clock has translated to enough playback
   * progress (≥30% of expected at the current playbackRate).  If not,
   * the element is wedged regardless of audio.paused.
   *
   * Stale-retry safety: playTokenRef + currentIdxRef check ensure every
   * timer/event callback bails the moment the user moves on (clicks
   * another sentence, presses pause, drags the slider).
   *
   * AbortError safety: tryPlay's catch silently swallows AbortError, so
   * the pause-aborts-pending-play() interactions never bubble.
   */
  const seekAndPlay = useCallback((idx: number) => {
    const audio = audioRef.current
    const sents = sentencesRef.current
    if (!audio || !sents[idx]) return

    const token = ++playTokenRef.current
    const target = sents[idx].start

    currentIdxRef.current = idx
    loopsDoneRef.current = 0
    setCurrentIdx(idx)
    setLoopsDone(0)

    // ── Sync the playback queue position to this sentence ────────────────
    //
    // Whatever the caller (list click, prev/next button, auto-advance), the
    // queue is the source of truth for "what plays next".  Find this idx in
    // the queue and update queuePosRef accordingly.
    //
    // If idx is not in the queue (defensive: should never happen because we
    // always rebuild queues with length === sentences.length), rebuild the
    // queue anchored at this idx.
    {
      const queue = playQueueRef.current
      const pos = queue.indexOf(idx)
      if (pos !== -1) {
        queuePosRef.current = pos
      } else {
        const rebuilt = buildPlayQueue(playModeRef.current, sents.length, idx)
        playQueueRef.current = rebuilt
        queuePosRef.current = Math.max(0, rebuilt.indexOf(idx))
      }
    }

    // STEP 1 (synchronous): force a clean paused state.
    //
    // This kicks any "wedged playing" state out of its rut, AND it aborts
    // any in-flight audio.play() Promise from a previous seekAndPlay
    // invocation (its rejection is caught silently as AbortError).
    audio.pause()

    // STEP 2 (deferred to next task tick): seek + play + retries.
    //
    // Why setTimeout(0)? Chromium's audio element internal pipeline needs
    // a moment to absorb the pause state transition before it can cleanly
    // accept a new currentTime + play() pair. Doing pause+seek+play in a
    // single synchronous block under rapid clicks lets Chromium pile up
    // unfinished state transitions, which is the proximal cause of the
    // "N-th click does nothing" symptom (the third+ click lands while the
    // first/second click's internal pipeline is still in flight).
    //
    // Yielding to the event loop lets:
    //   - the 'pause' event fire
    //   - the previous play() Promise settle (AbortError)
    //   - the pipeline reach a quiescent paused state
    // ... before we issue the new seek + play.
    //
    // If the user clicks again within those ~4ms, the new click bumps the
    // token and the deferred work below bails via the token check.
    setTimeout(() => {
      if (playTokenRef.current !== token) return

      // Recover from a previous fatal error.  Gate onSeeked across the
      // load window — load() resets currentTime to 0 and we don't want
      // a spurious 'seeked' to be misread as the user dragging to 0.
      if (audio.error) {
        isHardResettingRef.current = true
        audio.load()
        setTimeout(() => { isHardResettingRef.current = false }, 3000)
      }

      audio.playbackRate = speedRef.current

      setProgrammaticTime(audio, target)

      // A retry only "owns" the audio element if (a) no newer seekAndPlay
      // has been issued AND (b) the user hasn't moved currentIdx via the
      // progress slider in the meantime.
      const isMine = () => playTokenRef.current === token && currentIdxRef.current === idx

      const tryPlay = (label: string) => audio.play().catch(err => {
        const name = (err as DOMException).name
        if (name === 'AbortError') return
        console.error(`[seekAndPlay:${label}] play() rejected:`, name, (err as DOMException).message)
      })

      tryPlay('initial')

      // ── Wedged-playing detection ─────────────────────────────────────────
      //
      // After this point we can't rely on `audio.paused` alone to detect
      // failure: Chromium occasionally enters a state where paused=false
      // (so play() is a no-op forever) but audio.currentTime doesn't
      // advance and no sound is produced.  We sample currentTime now and
      // compare later — if too little wall-clock progress was made,
      // declare the element wedged.
      const initialCT = audio.currentTime
      const initialAt = performance.now()
      const isWedged = (): boolean => {
        if (audio.paused) return false   // legitimately paused, not wedged
        if (audio.seeking) return false  // seek in progress, give it time
        const elapsed = performance.now() - initialAt
        if (elapsed < 150) return false  // too early to tell
        const advanced = audio.currentTime - initialCT
        const expected = (elapsed / 1000) * speedRef.current
        return advanced < expected * 0.3  // < 30% of expected progress
      }
      const kickWedged = (label: string) => {
        console.warn(`[seekAndPlay:${label}] wedged playing detected — pause+play kick`)
        audio.pause()
        // Microtask to let the pause take effect before re-seeking.
        Promise.resolve().then(() => {
          if (!isMine()) return
          if (Math.abs(audio.currentTime - target) > 0.05) {
            setProgrammaticTime(audio, target)
          }
          tryPlay(`${label}-kick`)
        })
      }

      // Stage 2 (event-driven): 'seeked' / 'canplay' re-prime.
      const onReady = () => {
        audio.removeEventListener('seeked', onReady)
        audio.removeEventListener('canplay', onReady)
        if (!isMine()) return
        if (audio.paused) tryPlay('onReady')
      }
      audio.addEventListener('seeked', onReady)
      audio.addEventListener('canplay', onReady)

      // Stage 3 (400ms): detect BOTH paused-failure AND wedged playing.
      setTimeout(() => {
        if (!isMine()) return

        if (audio.paused) {
          console.warn('[seekAndPlay] still paused @400ms — retrying play()')
          if (Math.abs(audio.currentTime - target) > 0.05) {
            setProgrammaticTime(audio, target)
          }
          tryPlay('@400ms')
          return
        }

        // paused=false but not actually playing? Kick it.
        if (isWedged()) kickWedged('@400ms')
      }, 400)

      // Stage 4 (1000ms): hard reset on persistent paused OR wedged.
      setTimeout(() => {
        if (!isMine()) return
        if (!audio.paused && !isWedged()) return

        console.warn('[seekAndPlay] still stuck @1000ms — hard reset (audio.load)')
        isHardResettingRef.current = true
        audio.load()
        const onCanPlayAfterReset = () => {
          audio.removeEventListener('canplay', onCanPlayAfterReset)
          isHardResettingRef.current = false
          if (!isMine()) return
          setProgrammaticTime(audio, target)
          tryPlay('post-reset')
        }
        audio.addEventListener('canplay', onCanPlayAfterReset)
        setTimeout(() => { isHardResettingRef.current = false }, 3000)
      }, 1000)
    }, 0)
  }, [setProgrammaticTime])

  // Keep seekAndPlayRef pointing at the current seekAndPlay so that handlers
  // registered once at mount (e.g. onTimeUpdate) can call into it.
  useEffect(() => {
    seekAndPlayRef.current = seekAndPlay
  }, [seekAndPlay])

  /**
   * Previous sentence in the playback queue.
   *
   * Unlike "previous by sentence index", this respects the user's chosen
   * play mode: in shuffle mode, it goes back through the shuffled order.
   */
  const goPrev = useCallback(() => {
    const queue = playQueueRef.current
    const prevPos = queuePosRef.current - 1
    if (prevPos < 0 || prevPos >= queue.length) return
    queuePosRef.current = prevPos
    seekAndPlay(queue[prevPos])
  }, [seekAndPlay])

  /**
   * Next sentence in the playback queue.
   *
   * In shuffle-repeat mode, advancing past the end of the queue triggers a
   * reshuffle and continues from the new queue's head.  In sequential /
   * shuffle modes, advancing past the end is a no-op (already at the end).
   */
  const goNext = useCallback(() => {
    const queue = playQueueRef.current
    let nextPos = queuePosRef.current + 1

    if (nextPos >= queue.length) {
      if (playModeRef.current === 'shuffle-repeat') {
        playQueueRef.current = buildPlayQueue('shuffle', sentencesRef.current.length, -1)
        nextPos = 0
      } else {
        return
      }
    }

    queuePosRef.current = nextPos
    seekAndPlay(playQueueRef.current[nextPos])
  }, [seekAndPlay])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (!audio.paused) {
      // Bump the token so that any in-flight seekAndPlay retries (which
      // re-issue play() if they see audio.paused === true) bail out instead
      // of "reviving" playback against the user's pause intent.
      ++playTokenRef.current
      audio.pause()
      return
    }

    const sents = sentencesRef.current
    const idx = currentIdxRef.current
    const sentence = sents[idx]
    if (!sentence) return

    // Decide between in-place resume vs full seekAndPlay.
    //
    // The full seekAndPlay pipeline is the right choice whenever we can't
    // be 100% sure that calling audio.play() right now will resume the
    // *currently selected sentence* (and not some stale position):
    //
    //   - playhead outside the current sentence's range
    //   - audio element still loading (readyState < HAVE_CURRENT_DATA)
    //   - audio element in an error state
    //   - audio element mid-hard-reset (load() in flight)
    //
    // Crucially, this also rescues us if `audio.currentTime` was inadvertently
    // reset to 0 (e.g. by an audio.load() that wasn't fully observed) — the
    // readyState/range checks will force the seekAndPlay path, so we never
    // silently "in-place play from 0" when the user actually wants sentence N.
    const playheadInRange = audio.currentTime >= sentence.start
                         && audio.currentTime < sentence.end
    const audioHealthy = audio.readyState >= 2 /* HAVE_CURRENT_DATA */
                      && !audio.error
                      && !isHardResettingRef.current
    if (!playheadInRange || !audioHealthy) {
      seekAndPlay(idx)
      return
    }

    audio.playbackRate = speedRef.current

    const token = ++playTokenRef.current
    const isMine = () => playTokenRef.current === token

    const tryPlay = (label: string) => audio.play().catch(err => {
      const name = (err as DOMException).name
      if (name === 'AbortError') return
      console.error(`[togglePlay:${label}] play() rejected:`, name, (err as DOMException).message)
    })

    tryPlay('initial')

    setTimeout(() => {
      if (!isMine() || !audio.paused) return
      console.warn('[togglePlay] still paused @400ms — retrying play()')
      tryPlay('@400ms')
    }, 400)

    setTimeout(() => {
      if (!isMine() || !audio.paused) return
      console.warn('[togglePlay] still paused @1000ms — falling back to seekAndPlay')
      // Escalate: if a plain resume keeps failing, do a full seek+reset
      // pipeline at the current sentence's start.
      seekAndPlay(currentIdxRef.current)
    }, 1000)
  }, [seekAndPlay])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      switch (e.key) {
        case ' ':          e.preventDefault(); togglePlay(); break
        case 'ArrowLeft':  e.preventDefault(); goPrev();     break
        case 'ArrowRight': e.preventDefault(); goNext();     break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, goPrev, goNext])

  const cycleLoops = () => {
    const next = LOOP_OPTIONS[(LOOP_OPTIONS.indexOf(maxLoops) + 1) % LOOP_OPTIONS.length]
    setMaxLoops(next)
    maxLoopsRef.current = next
    loopsDoneRef.current = 0
    setLoopsDone(0)
  }

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    speedRef.current = next
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  /**
   * Cycle through play modes (sequential → shuffle → shuffle-repeat → …).
   *
   * The current sentence is preserved across the switch: we rebuild the
   * queue with the current sentence as the anchor (it stays as the next
   * thing to play in shuffle modes).
   */
  const cyclePlayMode = () => {
    const next = PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length]
    setPlayMode(next)
    playModeRef.current = next

    const sents = sentencesRef.current
    const anchor = currentIdxRef.current
    const rebuilt = buildPlayQueue(next, sents.length, anchor)
    playQueueRef.current = rebuilt
    queuePosRef.current = Math.max(0, rebuilt.indexOf(anchor))
  }

  // ── Derived render values ──────────────────────────────────────────────────
  //
  // queuePos / canGoPrev / canGoNext are recomputed on every render rather
  // than tracked as React state.  This is fine because queuePosRef is always
  // kept in sync with currentIdxRef, and currentIdx state changes trigger
  // re-renders that flow through here.
  const queuePos = playQueueRef.current.indexOf(currentIdx)
  const canGoPrev = queuePos > 0
  const canGoNext =
    playMode === 'shuffle-repeat' ||
    (queuePos >= 0 && queuePos < playQueueRef.current.length - 1)

  const playModeIcon =
    playMode === 'sequential'    ? <PlaylistPlayIcon sx={{ fontSize: '16px !important' }} /> :
    playMode === 'shuffle'       ? <ShuffleIcon      sx={{ fontSize: '16px !important' }} /> :
    /* shuffle-repeat */           <ShuffleOnIcon    sx={{ fontSize: '16px !important' }} />

  // ── Render ─────────────────────────────────────────────────────────────────
  // <audio> is ALWAYS rendered at the top level so audioRef.current is set
  // when the useEffect([], []) listener-registration runs on first mount.
  return (
    <Box sx={{ height: '100%', display: 'flex', overflow: 'hidden', position: 'relative' }}>

      {/* preload="auto": Chrome eagerly buffers the entire file via sequential
          Range chunks (see ipc.ts).  Each chunk completes in milliseconds for
          local files, so the full audio is cached before the user touches the
          seek list.  With preload="metadata" Chrome only fetches the header and
          cannot calculate byte offsets for seeking into the middle of the file,
          causing sentences beyond the first few to fail. */}
      <audio ref={audioRef} src={audioSrc} preload="auto" />

      {/* Loading overlay */}
      {loading && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, bgcolor: 'background.default' }}>
          <CircularProgress />
        </Box>
      )}

      {/* Empty state */}
      {!loading && (!project || sentences.length === 0) && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
          <Typography color="text.secondary">暂无句子数据</Typography>
          <IconButton onClick={onBack}><ArrowBackIcon /></IconButton>
        </Box>
      )}

      {/* Player UI */}
      {!loading && project && sentences.length > 0 && (
        <>
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 3, py: 1.5, gap: 1 }}>
              <Tooltip title="返回媒体库">
                <IconButton size="small" onClick={onBack}><ArrowBackIcon /></IconButton>
              </Tooltip>
              <Typography variant="h6" sx={{ flex: 1 }} noWrap>{project.title}</Typography>
              {onEditSentences && (
                <Tooltip title="编辑断句">
                  <IconButton size="small" onClick={onEditSentences}><TuneIcon /></IconButton>
                </Tooltip>
              )}
              <Tooltip title={sidebarOpen ? '隐藏句子列表' : '显示句子列表'}>
                <IconButton size="small" onClick={() => setSidebarOpen(v => !v)}>
                  <MenuOpenIcon />
                </IconButton>
              </Tooltip>
            </Box>

            <Divider />

            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 4, py: 2 }}>
              <Paper
                elevation={0}
                sx={{
                  maxWidth: 680, width: '100%', p: 5, textAlign: 'center',
                  bgcolor: 'rgba(208,188,255,0.06)',
                  border: '1px solid rgba(208,188,255,0.12)',
                  borderRadius: 4
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  {currentIdx + 1} / {sentences.length}
                </Typography>
                <Typography
                  variant="h5"
                  sx={{ lineHeight: 1.8, color: 'text.primary', fontWeight: 400, letterSpacing: '0.01em', minHeight: 80 }}
                >
                  {currentSentence?.text ?? ''}
                </Typography>
                {maxLoops !== 1 && (
                  <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 2 }}>
                    {maxLoops === 0
                      ? `∞ 循环 · 已播 ${loopsDone + 1} 次`
                      : `${loopsDone + 1} / ${maxLoops} 次`}
                  </Typography>
                )}
              </Paper>
            </Box>

            <Box sx={{ px: 3, pb: 3 }}>
              <AudioProgressSlider audioRef={audioRef} />

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1 }}>
                <Tooltip title="播放速度">
                  <Chip label={`${speed}x`} size="small" onClick={cycleSpeed} sx={{ cursor: 'pointer', minWidth: 52 }} />
                </Tooltip>

                <Tooltip title={PLAY_MODE_TOOLTIPS[playMode]}>
                  <Chip
                    icon={playModeIcon}
                    label={PLAY_MODE_LABELS[playMode]}
                    size="small"
                    onClick={cyclePlayMode}
                    color={playMode !== 'sequential' ? 'primary' : 'default'}
                    sx={{ cursor: 'pointer', minWidth: 72 }}
                  />
                </Tooltip>

                <Tooltip title="上一句 ←">
                  <span>
                    <IconButton onClick={goPrev} disabled={!canGoPrev}>
                      <SkipPreviousIcon />
                    </IconButton>
                  </span>
                </Tooltip>

                <IconButton
                  onClick={togglePlay}
                  sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', width: 56, height: 56, '&:hover': { bgcolor: 'primary.light' } }}
                >
                  {isPlaying ? <PauseIcon sx={{ fontSize: 28 }} /> : <PlayArrowIcon sx={{ fontSize: 28 }} />}
                </IconButton>

                <Tooltip title="下一句 →">
                  <span>
                    <IconButton onClick={goNext} disabled={!canGoNext}>
                      <SkipNextIcon />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title={maxLoops === 0 ? '无限循环' : maxLoops === 1 ? '不循环' : `循环 ${maxLoops} 次`}>
                  <Chip
                    icon={maxLoops === 1
                      ? <RepeatIcon sx={{ fontSize: '16px !important' }} />
                      : <RepeatOneIcon sx={{ fontSize: '16px !important' }} />}
                    label={maxLoops === 0 ? '∞' : maxLoops === 1 ? '1×' : `${maxLoops}×`}
                    size="small"
                    onClick={cycleLoops}
                    color={maxLoops !== 1 ? 'primary' : 'default'}
                    sx={{ cursor: 'pointer', minWidth: 60 }}
                  />
                </Tooltip>
              </Box>

              <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', textAlign: 'center', mt: 1.5, opacity: 0.6 }}>
                Space 播放/暂停 · ← 上一句 · → 下一句
              </Typography>
            </Box>
          </Box>

          {sidebarOpen && (
            <Box sx={{ width: 280, borderLeft: '1px solid rgba(202,196,208,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#211F26' }}>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  句子列表 ({sentences.length})
                </Typography>
              </Box>
              <Divider />
              <List ref={sentenceListRef} dense disablePadding sx={{ flex: 1, overflow: 'auto' }}>
                {sentences.map((s, i) => (
                  <ListItemButton
                    key={s.id}
                    data-idx={i}
                    selected={i === currentIdx}
                    onClick={() => seekAndPlay(i)}
                    sx={{
                      borderLeft: i === currentIdx ? '3px solid' : '3px solid transparent',
                      borderColor: i === currentIdx ? 'primary.main' : 'transparent',
                      py: 1.5,
                      '&.Mui-selected': { bgcolor: 'rgba(208,188,255,0.1)' }
                    }}
                  >
                    <ListItemText
                      disableTypography
                      primary={
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                            {formatTime(s.start)}
                          </Typography>
                          <Typography variant="body2" sx={{ color: i === currentIdx ? 'primary.main' : 'text.primary', lineHeight: 1.5 }}>
                            {s.text}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AudioProgressSlider({ audioRef }: { audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const [value, setValue] = useState(0)
  const [duration, setDuration] = useState(0)
  const isDragging = useRef(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onLoaded = () => setDuration(audio.duration || 0)
    const onTime = () => {
      if (!isDragging.current && audio.duration) {
        setValue((audio.currentTime / audio.duration) * 100)
      }
    }
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
    }
  }, [audioRef])

  const handleChange = (_: Event, v: number | number[]) => {
    isDragging.current = true
    setValue(v as number)
  }

  const handleCommit = (_: React.SyntheticEvent | Event, v: number | number[]) => {
    const audio = audioRef.current
    if (audio && duration) audio.currentTime = ((v as number) / 100) * duration
    isDragging.current = false
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 40, textAlign: 'right' }}>
        {formatTime((value / 100) * duration)}
      </Typography>
      <Slider
        size="small"
        value={value}
        onChange={handleChange}
        onChangeCommitted={handleCommit}
        sx={{ flex: 1, color: 'primary.main', '& .MuiSlider-thumb': { width: 12, height: 12 } }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ width: 40 }}>
        {formatTime(duration)}
      </Typography>
    </Box>
  )
}

/**
 * Find the sentence index that contains the given time.
 * Falls back to the last sentence whose start ≤ time (for gaps between sentences).
 */
function findSentenceAtTime(sentences: Sentence[], time: number): number {
  const exact = sentences.findIndex(s => time >= s.start && time < s.end)
  if (exact !== -1) return exact
  let best = 0
  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i].start <= time) best = i
  }
  return best
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
