'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  useBackgroundTasks,
  type BackgroundTask,
  type FlaggedCandidate,
} from '@/context/BackgroundTasksContext'

// ── Sync jobs (server-polled) ───────────────────────────────────────────────
type SyncJob = {
  id:         string
  type:       string
  label:      string
  status:     'running' | 'done' | 'error'
  progress:   string
  startedAt:  number
  finishedAt: number | null
  summary:    string | null
  error:      string | null
}

function elapsed(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  )
}

function IndeterminateBar({ color = 'bg-blue-400' }: { color?: string }) {
  return (
    <div className="mt-1.5 h-1 rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full w-2/3 ${color} rounded-full animate-pulse`} />
    </div>
  )
}

// ── Flag reasons ────────────────────────────────────────────────────────────
const FLAG_REASONS = [
  'Competitor logo',
  'Wrong product',
  'Wrong variant',
  'Has watermark / text',
  'Low quality',
] as const

// ── Candidate picker row ────────────────────────────────────────────────────
function CandidatesRow({
  task,
  onApply,
  onRefine,
  onDismiss,
  onEnlarge,
  onForceClean,
  isApprover,
  expanded,
}: {
  task:          BackgroundTask
  onApply:       (imageUrl: string) => void
  onRefine:      (flagged: FlaggedCandidate[]) => void
  onDismiss:     () => void
  onEnlarge:     (url: string) => void
  onForceClean:  () => void
  isApprover:    boolean
  expanded?:     boolean
}) {
  const candidates        = task.candidates ?? []
  const [selected,        setSelected]    = useState<string | null>(null)
  const [flagged,         setFlagged]     = useState<Map<string, string>>(new Map())
  const [flaggingUrl,     setFlaggingUrl] = useState<string | null>(null)

  const thumbCls = expanded ? 'w-20 h-20' : 'w-14 h-14'

  function toggleFlag(imageUrl: string, reason: string) {
    setFlagged(prev => {
      const next = new Map(prev)
      if (next.get(imageUrl) === reason) {
        next.delete(imageUrl)
      } else {
        next.set(imageUrl, reason)
        if (selected === imageUrl) setSelected(null)
      }
      return next
    })
    setFlaggingUrl(null)
  }

  function handleRefine() {
    const list: FlaggedCandidate[] = []
    flagged.forEach((reason, imageUrl) => {
      const c = candidates.find(c => c.imageUrl === imageUrl)
      list.push({ title: c?.title ?? imageUrl, reason })
    })
    onRefine(list)
  }

  const anyFlagged = flagged.size > 0
  const canSubmit  = selected !== null && !flagged.has(selected)

  return (
    <div className="px-3 py-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-800">Pick a replacement photo:</p>
          <p className={`text-[11px] text-gray-500 mt-0.5 ${expanded ? 'break-words' : 'truncate max-w-[200px]'}`}>
            {task.label.replace(/^[^:]+:\s*/, '')}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-gray-300 hover:text-gray-500 text-lg leading-none"
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Thumbnails */}
      {candidates.length === 0 ? (
        <p className="text-xs text-amber-600">No candidates found — try Method A or C</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {candidates.map((c, i) => {
            const isSelected = selected === c.imageUrl
            const isFlagged  = flagged.has(c.imageUrl)
            const isPickable = !isFlagged

            return (
              <div key={i} className="relative group shrink-0">
                {/* Thumbnail */}
                <button
                  type="button"
                  title={isPickable ? (isSelected ? 'Selected — click to deselect' : 'Click to select') : 'Flagged — cannot select'}
                  disabled={!isPickable}
                  onClick={() => {
                    if (!isPickable) return
                    setSelected(prev => prev === c.imageUrl ? null : c.imageUrl)
                    setFlaggingUrl(null)
                  }}
                  className={[
                    `relative ${thumbCls} rounded-lg overflow-hidden border-2 transition-all block`,
                    isFlagged  ? 'border-red-300 opacity-40 cursor-not-allowed' :
                    isSelected ? 'border-blue-500 ring-2 ring-blue-300 ring-offset-1' :
                                 'border-gray-200 hover:border-gray-400',
                  ].join(' ')}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.imageUrl}
                    alt={c.title}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  {isSelected && (
                    <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                    </div>
                  )}
                  {isFlagged && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-red-500 text-xs font-bold">✕</span>
                    </div>
                  )}
                </button>

                {/* Hover actions: zoom + thumbs-down */}
                {!isFlagged && (
                  <div className="absolute top-0.5 left-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Zoom */}
                    <button
                      type="button"
                      title="Enlarge"
                      onClick={e => { e.stopPropagation(); onEnlarge(c.imageUrl) }}
                      className="w-5 h-5 rounded bg-black/60 hover:bg-black/90 flex items-center justify-center"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
                      </svg>
                    </button>
                    {/* Flag */}
                    <button
                      type="button"
                      title="Flag this result"
                      onClick={e => {
                        e.stopPropagation()
                        setFlaggingUrl(prev => prev === c.imageUrl ? null : c.imageUrl)
                        setSelected(null)
                      }}
                      className="w-5 h-5 rounded bg-black/60 hover:bg-red-600 flex items-center justify-center"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.5 10.5A3 3 0 1 0 6 6"/>
                      </svg>
                    </button>
                  </div>
                )}

                {/* Reason picker dropdown */}
                {flaggingUrl === c.imageUrl && (
                  <div className="absolute top-full mt-1 left-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                    <p className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wide">Why is this bad?</p>
                    {FLAG_REASONS.map(reason => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => toggleFlag(c.imageUrl, reason)}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-red-50 hover:text-red-700 transition-colors"
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Flagged list */}
      {anyFlagged && (
        <div className="space-y-1">
          {Array.from(flagged.entries()).map(([url, reason]) => {
            const c = candidates.find(c => c.imageUrl === url)
            return (
              <div key={url} className="flex items-center gap-2 text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">
                <span className="font-medium shrink-0">✕</span>
                <span className={`${expanded ? 'break-words' : 'truncate'} flex-1`}>{c?.title || 'Result'}</span>
                <span className="text-red-400 shrink-0">{reason}</span>
                <button
                  type="button"
                  onClick={() => setFlagged(prev => { const n = new Map(prev); n.delete(url); return n })}
                  className="shrink-0 text-red-300 hover:text-red-600"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 items-center pt-0.5">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => selected && onApply(selected)}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
        >
          {selected ? 'Apply selected →' : 'Select a photo first'}
        </button>
        {anyFlagged && (
          <button
            type="button"
            onClick={handleRefine}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1"
            title="Re-search using your feedback"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Retry
          </button>
        )}
      </div>

      {/* Divider + Force Clean */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
        <button
          type="button"
          onClick={onForceClean}
          title={isApprover
            ? 'Keep current photo and permanently mark as approved — AI will never re-flag'
            : 'Request Director to permanently approve the current photo'}
          className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
          </svg>
          {isApprover ? 'Force clean (keep current photo)' : 'Request Director approval'}
        </button>
      </div>
      <p className="text-[10px] text-gray-400">
        {selected ? 'Click "Apply selected" to upload and AI-scan.' : 'Click a photo to select it. Flag bad ones to refine search.'}
      </p>
    </div>
  )
}

// ── Photo task row (running / applying / done / error) ──────────────────────
function PhotoTaskRow({
  task,
  onDismiss,
  expanded,
}: {
  task:      BackgroundTask
  onDismiss: () => void
  expanded?: boolean
}) {
  const isRunning = task.status === 'running' || task.status === 'applying'
  return (
    <div className="px-3 py-2.5 flex items-start gap-2.5">
      <span className="shrink-0 mt-px text-sm leading-none w-4 text-center">
        {isRunning                                 && <span className="text-blue-500 inline-block animate-spin">↻</span>}
        {task.status === 'done' && !task.flagged   && <span className="text-green-500">✓</span>}
        {task.status === 'done' &&  task.flagged   && <span className="text-amber-500">⚠</span>}
        {task.status === 'error'                   && <span className="text-red-500">✗</span>}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold text-gray-800 ${expanded ? 'break-words' : 'truncate'}`}>{task.label}</p>
        {task.subLabel && (
          <p className={`text-[11px] text-gray-400 mt-0.5 ${expanded ? 'break-words' : 'truncate'}`}>{task.subLabel}</p>
        )}
        {isRunning && <IndeterminateBar />}
        {task.message && !isRunning && (
          <p className={`text-[11px] mt-0.5 ${expanded ? 'break-words' : 'truncate'} ${
            task.status === 'error' ? 'text-red-600' : task.flagged ? 'text-amber-600' : 'text-green-700'
          }`}>
            {task.message}
          </p>
        )}
      </div>
      {!isRunning && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-gray-300 hover:text-gray-500 text-lg leading-none mt-0.5 px-0.5"
          title="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ── Sync job row ────────────────────────────────────────────────────────────
function SyncJobRow({
  job, tick, onDismiss, expanded,
}: {
  job: SyncJob; tick: number; onDismiss: () => void; expanded?: boolean
}) {
  void tick
  return (
    <div className="px-3 py-2.5 flex items-start gap-2.5">
      <span className="shrink-0 mt-px text-sm leading-none w-4 text-center">
        {job.status === 'running' && <span className="text-green-500 inline-block animate-spin">↻</span>}
        {job.status === 'done'    && <span className="text-green-500">✓</span>}
        {job.status === 'error'   && <span className="text-red-500">✗</span>}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <p className={`text-xs font-semibold text-gray-800 ${expanded ? 'break-words' : 'truncate'}`}>{job.label}</p>
          <p className="text-[10px] text-gray-400 shrink-0">
            {job.status === 'running'
              ? elapsed(job.startedAt)
              : job.finishedAt ? `${elapsed(job.startedAt)} total` : ''}
          </p>
        </div>
        {job.status === 'running' && (
          <>
            <p className={`text-[11px] text-gray-500 mt-0.5 ${expanded ? 'break-words' : 'truncate'}`}>{job.progress}</p>
            <IndeterminateBar color="bg-green-400" />
          </>
        )}
        {job.status === 'done'  && job.summary && (
          <p className={`text-[11px] text-green-700 mt-0.5 ${expanded ? 'break-words' : 'truncate'}`}>{job.summary}</p>
        )}
        {job.status === 'error' && job.error && (
          <p className={`text-[11px] text-red-600 mt-0.5 ${expanded ? 'break-words' : 'truncate'}`}>{job.error}</p>
        )}
      </div>
      {job.status !== 'running' && (
        <button onClick={onDismiss} className="shrink-0 text-gray-300 hover:text-gray-500 text-lg leading-none mt-0.5 px-0.5" title="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

// ── Main panel ──────────────────────────────────────────────────────────────
export default function BottomTasksPanel() {
  const { tasks: photoTasks, applyCandidate, refineSearch, dismissTask, role } = useBackgroundTasks()
  const isApprover = role === 'Director' || role === 'Manager'
  const pathname = usePathname()
  const isOnPhotoReview = pathname === '/admin/products'

  const [dismissedPhoto, setDismissedPhoto] = useState<Set<string>>(new Set())
  const [syncJobs,       setSyncJobs]       = useState<SyncJob[]>([])
  const [dismissedSync,  setDismissedSync]  = useState<Set<string>>(new Set())
  const [tick,           setTick]           = useState(0)
  const [minimized,      setMinimized]      = useState(false)
  const [expanded,       setExpanded]       = useState(false)
  const [lightboxUrl,    setLightboxUrl]    = useState<string | null>(null)

  const hasRunningSyncs = syncJobs.some(j => j.status === 'running' && !dismissedSync.has(j.id))

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/admin/sync-jobs', { cache: 'no-store' })
        if (!cancelled && res.ok) {
          const data = await res.json() as { jobs: SyncJob[] }
          setSyncJobs(data.jobs)
        }
      } catch { /* network blip */ }
    }
    poll()
    const iv = setInterval(poll, hasRunningSyncs ? 2000 : 8000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [hasRunningSyncs])

  useEffect(() => {
    if (!hasRunningSyncs) return
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [hasRunningSyncs])

  const syncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    for (const job of syncJobs) {
      if (job.status !== 'running' && job.finishedAt && !dismissedSync.has(job.id) && !syncTimers.current.has(job.id)) {
        const delay = Math.max(0, 20_000 - (Date.now() - job.finishedAt))
        const t = setTimeout(() => {
          setDismissedSync(prev => new Set([...prev, job.id]))
          syncTimers.current.delete(job.id)
        }, delay)
        syncTimers.current.set(job.id, t)
      }
    }
  }, [syncJobs, dismissedSync])

  // When on the photo review page, running/applying tasks are shown inline on the product row.
  // Only show them here once they reach candidates/done/error (or when on a different page).
  const visiblePhoto = photoTasks.filter(t => {
    if (dismissedPhoto.has(t.id)) return false
    if (isOnPhotoReview && (t.status === 'running' || t.status === 'applying')) return false
    return true
  })
  const visibleSync  = syncJobs.filter(j => !dismissedSync.has(j.id))
  const totalVisible = visiblePhoto.length + visibleSync.length

  if (totalVisible === 0 && !lightboxUrl) return null

  const runningCount = visiblePhoto.filter(t => t.status === 'running' || t.status === 'applying').length
                     + visibleSync.filter(j => j.status === 'running').length
  const awaitingPick = visiblePhoto.filter(t => t.status === 'candidates').length

  const panelWidth   = expanded ? 'w-[520px]' : 'w-72'
  const maxHeight    = expanded ? 'max-h-[640px]' : 'max-h-[480px]'

  return (
    <>
      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Preview"
            className="max-w-[85vw] max-h-[85vh] object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/30 hover:bg-black/60 rounded-full p-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Panel */}
      {totalVisible > 0 && (
        <div className={`fixed bottom-4 right-4 z-50 ${panelWidth} max-w-[calc(100vw-2rem)] transition-all duration-200`}>
          {minimized ? (
            <button
              onClick={() => setMinimized(false)}
              className="flex items-center gap-2 bg-gray-900 text-white text-xs font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-gray-800 transition-colors ml-auto"
            >
              {runningCount > 0
                ? <span className="inline-block animate-spin leading-none">↻</span>
                : awaitingPick > 0
                  ? <span className="text-amber-400">◉</span>
                  : <span className="text-green-400">✓</span>}
              <span>
                {runningCount > 0
                  ? `${runningCount} running`
                  : awaitingPick > 0
                    ? `${awaitingPick} awaiting pick`
                    : `${totalVisible} done`}
              </span>
            </button>
          ) : (
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-1.5 min-w-0">
                  {runningCount > 0 && <Spinner className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                  {awaitingPick > 0 && runningCount === 0 && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-gray-700 truncate">
                    {runningCount > 0
                      ? `${runningCount} task${runningCount !== 1 ? 's' : ''} running`
                      : awaitingPick > 0
                        ? `${awaitingPick} awaiting your pick`
                        : 'Background Tasks'}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0 ml-2">
                  {/* Expand / Collapse */}
                  <button
                    onClick={() => setExpanded(e => !e)}
                    title={expanded ? 'Collapse panel' : 'Expand panel'}
                    className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 transition-colors"
                  >
                    {expanded ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0l5 0m-5 0l0 5M15 9l5-5m0 0l-5 0m5 0l0 5M9 15l-5 5m0 0l5 0m-5 0l0-5M15 15l5 5m0 0l-5 0m5 0l0-5"/>
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
                      </svg>
                    )}
                  </button>
                  {/* Minimise */}
                  <button
                    onClick={() => setMinimized(true)}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
                    title="Minimise"
                  >
                    −
                  </button>
                </div>
              </div>

              {/* Task list */}
              <div className={`divide-y divide-gray-100 ${maxHeight} overflow-y-auto transition-all duration-200`}>
                {visiblePhoto.map(task => (
                  task.status === 'candidates'
                    ? (
                      <CandidatesRow
                        key={task.id}
                        task={task}
                        expanded={expanded}
                        isApprover={isApprover}
                        onApply={url => applyCandidate(task.id, url)}
                        onRefine={flagged => refineSearch(task.id, flagged)}
                        onDismiss={() => { dismissTask(task.id); setDismissedPhoto(p => new Set([...p, task.id])) }}
                        onEnlarge={setLightboxUrl}
                        onForceClean={() => {
                          const endpoint = isApprover
                            ? `/api/admin/products/${task.productId}/approve-photo`
                            : `/api/admin/products/${task.productId}/request-photo-approval`
                          void fetch(endpoint, { method: 'POST' })
                            .then(() => {
                              dismissTask(task.id)
                              setDismissedPhoto(p => new Set([...p, task.id]))
                              window.dispatchEvent(new CustomEvent('photo-review-refresh'))
                            })
                        }}
                      />
                    ) : (
                      <PhotoTaskRow
                        key={task.id}
                        task={task}
                        expanded={expanded}
                        onDismiss={() => { dismissTask(task.id); setDismissedPhoto(p => new Set([...p, task.id])) }}
                      />
                    )
                ))}

                {visibleSync.map(job => (
                  <SyncJobRow
                    key={job.id}
                    job={job}
                    tick={tick}
                    expanded={expanded}
                    onDismiss={() => {
                      const t = syncTimers.current.get(job.id)
                      if (t) { clearTimeout(t); syncTimers.current.delete(job.id) }
                      setDismissedSync(prev => new Set([...prev, job.id]))
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
