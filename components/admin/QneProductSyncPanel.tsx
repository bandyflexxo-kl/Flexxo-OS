'use client'

import { useEffect, useState } from 'react'

type SyncJob = {
  id:       string
  type:     string
  status:   'running' | 'done' | 'error'
  progress: string
  summary:  string | null
  error:    string | null
}

type JobsResponse  = { jobs: SyncJob[] }
type StartResponse = { ok?: boolean; jobId?: string; error?: string }

export default function QneProductSyncPanel() {
  const [loading, setLoading] = useState(false)
  const [jobId,   setJobId]   = useState<string | null>(null)
  const [job,     setJob]     = useState<SyncJob | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  // On mount: reconnect to any in-progress products sync (user navigated back)
  useEffect(() => {
    fetch('/api/admin/sync-jobs', { cache: 'no-store' })
      .then(r => r.json() as Promise<JobsResponse>)
      .then(d => {
        const running = d.jobs.find(j => j.type === 'products' && j.status === 'running')
        if (running) { setJobId(running.id); setJob(running) }
      })
      .catch(() => undefined)
  }, [])

  // Poll while a job is in flight
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    async function poll() {
      try {
        const res  = await fetch('/api/admin/sync-jobs', { cache: 'no-store' })
        const data = await res.json() as JobsResponse
        const found = data.jobs.find(j => j.id === jobId)
        if (cancelled) return
        if (found) {
          setJob(found)
          if (found.status !== 'running') cancelled = true
        }
      } catch { /* ignore */ }
    }
    poll()
    const iv = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [jobId])

  async function run() {
    setLoading(true)
    setJob(null)
    setError(null)
    try {
      const res  = await fetch('/api/admin/qne/sync-products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const data = await res.json() as StartResponse
      if (!res.ok) { setError(data.error ?? 'Failed to start sync'); return }
      const jId = data.jobId ?? null
      setJobId(jId)
      // Set a synthetic running state immediately so the button disables at once
      // (polling will overwrite this with live server state within 2s)
      if (jId) setJob({ id: jId, type: 'products', status: 'running', progress: 'Starting…', summary: null, error: null })
    } catch {
      setError('Network error — is the server running?')
    } finally {
      setLoading(false)
    }
  }

  const isRunning = job?.status === 'running'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">QNE Products &amp; Stock Sync</h3>
          <p className="text-sm text-gray-500 mt-1">
            Syncs full product catalogue from QNE, then updates live stock quantities.
            <br />
            <span className="text-amber-600 font-medium">Deactivates CRM products not returned by QNE.</span>
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading || isRunning}
          className="shrink-0 flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
        >
          {loading   ? <><span className="animate-spin">↻</span> Starting…</>   :
           isRunning ? <><span className="animate-spin">↻</span> Running…</>    :
                       <>↻ Sync Products &amp; Stock</>}
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
        ⚠ Radmin VPN (Flexxokl) must be active. Runs in the background — you can navigate away freely.
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {job?.status === 'running' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
          <span className="animate-spin shrink-0">↻</span>
          <span>{job.progress}</span>
        </div>
      )}

      {job?.status === 'done' && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">✓ Sync complete</p>
          <p className="mt-1 text-xs text-green-700">{job.summary}</p>
        </div>
      )}

      {job?.status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">✗ Sync failed</p>
          <p className="mt-1 text-xs">{job.error}</p>
        </div>
      )}
    </div>
  )
}
