'use client'

import { useEffect, useRef, useState } from 'react'

type JobStatus = 'running' | 'done' | 'error'

type SyncJob = {
  id:         string
  type:       string
  label:      string
  status:     JobStatus
  progress:   string
  startedAt:  number
  finishedAt: number | null
  summary:    string | null
  error:      string | null
}

function elapsed(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  if (s < 60)  return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function SyncJobsIndicator() {
  const [jobs,      setJobs]      = useState<SyncJob[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [minimized, setMinimized] = useState(false)
  const [tick,      setTick]      = useState(0) // forces elapsed re-render

  const hasRunning = jobs.some(j => j.status === 'running' && !dismissed.has(j.id))

  // Poll: 2 s while a job is running, 10 s otherwise
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/admin/sync-jobs', { cache: 'no-store' })
        if (!cancelled && res.ok) {
          const data = await res.json() as { jobs: SyncJob[] }
          setJobs(data.jobs)
        }
      } catch { /* network blip — ignore */ }
    }
    poll()
    const iv = setInterval(poll, hasRunning ? 2000 : 3000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [hasRunning])

  // Tick every second to keep elapsed time fresh while something is running
  useEffect(() => {
    if (!hasRunning) return
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [hasRunning])

  // Auto-dismiss done jobs 20 s after they finish
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'done' && job.finishedAt && !dismissed.has(job.id) && !dismissTimers.current.has(job.id)) {
        const delay = Math.max(0, 20_000 - (Date.now() - job.finishedAt))
        const t = setTimeout(() => {
          setDismissed(prev => new Set([...prev, job.id]))
          dismissTimers.current.delete(job.id)
        }, delay)
        dismissTimers.current.set(job.id, t)
      }
    }
  }, [jobs, dismissed])

  const visible = jobs.filter(j => !dismissed.has(j.id))
  if (visible.length === 0) return null

  const dismiss = (id: string) => {
    const t = dismissTimers.current.get(id)
    if (t) { clearTimeout(t); dismissTimers.current.delete(id) }
    setDismissed(prev => new Set([...prev, id]))
  }

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 bg-gray-900 text-white text-xs font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-gray-800 transition-colors"
        >
          {hasRunning
            ? <span className="inline-block animate-spin leading-none">↻</span>
            : <span>✓</span>}
          <span>{visible.length} sync{visible.length !== 1 ? 's' : ''}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {hasRunning && (
              <span className="text-green-600 inline-block animate-spin text-sm leading-none">↻</span>
            )}
            <span className="text-xs font-semibold text-gray-700">Background Syncs</span>
          </div>
          <button
            onClick={() => setMinimized(true)}
            className="text-gray-400 hover:text-gray-600 text-base leading-none px-1 py-0.5"
            title="Minimise"
          >
            −
          </button>
        </div>

        {/* Job list */}
        <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {visible.map(job => (
            <div key={job.id} className="px-4 py-3 flex items-start gap-2.5">
              {/* Status icon */}
              <span className="shrink-0 mt-0.5 text-base leading-none">
                {job.status === 'running' && (
                  <span className="text-blue-500 inline-block animate-spin">↻</span>
                )}
                {job.status === 'done'    && <span className="text-green-500">✓</span>}
                {job.status === 'error'   && <span className="text-red-500">✗</span>}
              </span>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <p className="text-xs font-semibold text-gray-800">{job.label}</p>
                  <p className="text-[10px] text-gray-400 shrink-0">
                    {/* elapsed time while running; age when done */}
                    {void tick /* reference tick to re-render */}
                    {job.status === 'running'
                      ? elapsed(job.startedAt)
                      : job.finishedAt
                        ? elapsed(job.startedAt) + ' total'
                        : ''}
                  </p>
                </div>

                {job.status === 'running' && (
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">{job.progress}</p>
                )}
                {job.status === 'done' && job.summary && (
                  <p className="text-[11px] text-green-700 truncate mt-0.5">{job.summary}</p>
                )}
                {job.status === 'error' && job.error && (
                  <p className="text-[11px] text-red-600 truncate mt-0.5">{job.error}</p>
                )}
              </div>

              {/* Dismiss (not for running jobs) */}
              {job.status !== 'running' && (
                <button
                  onClick={() => dismiss(job.id)}
                  className="shrink-0 text-gray-300 hover:text-gray-500 text-sm leading-none mt-0.5"
                  title="Dismiss"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
