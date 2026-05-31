'use client'

import { useState } from 'react'
import Link from 'next/link'

type SyncLog = {
  id:              string
  status:          string
  recordsReceived: number | null
  recordsStaged:   number | null
  recordsFailed:   number | null
  recordsSkipped:  number | null
  errorSummary:    string | null
  startedAt:       string
  completedAt:     string | null
}

type SyncResult = {
  syncLogId: string
  received:  number
  staged:    number
  skipped:   number
  failed:    number
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  failed:    'bg-red-500',
  started:   'bg-yellow-400',
}

export default function QneSyncPanel({
  recentSyncs: initial,
  pendingCount: initialPending = 0,
}: {
  recentSyncs:  SyncLog[]
  pendingCount?: number
}) {
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<SyncResult | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [syncs,    setSyncs]    = useState<SyncLog[]>(initial)
  const [pending,  setPending]  = useState(initialPending)

  async function handleSync() {
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res  = await fetch('/api/qne/sync', { method: 'POST' })
      const data = await res.json() as SyncResult & { error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Sync failed')
      } else {
        setResult(data)
        setPending(p => p + data.staged)
        // Prepend a synthetic log entry so the table updates without a page refresh.
        setSyncs(prev => [{
          id:              data.syncLogId,
          status:          'completed',
          recordsReceived: data.received,
          recordsStaged:   data.staged,
          recordsFailed:   data.failed,
          recordsSkipped:  data.skipped,
          errorSummary:    null,
          startedAt:       new Date().toISOString(),
          completedAt:     new Date().toISOString(),
        }, ...prev].slice(0, 5))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">QNE Customer Sync</h2>
          <p className="text-xs text-gray-400 mt-0.5">Pull all customers from QNE into the review queue</p>
        </div>
        <button
          onClick={handleSync}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      {result && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">Sync complete</p>
          <p className="mt-0.5 text-green-700">
            Received {result.received} · Staged {result.staged} · Skipped {result.skipped} (already pending) · Failed {result.failed}
          </p>
          {result.staged > 0 && (
            <Link href="/admin/qne-review" className="mt-2 inline-block text-blue-700 underline font-medium">
              Review {pending} records →
            </Link>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {syncs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Recent syncs</p>
          <div className="divide-y divide-gray-100">
            {syncs.map(log => (
              <div key={log.id} className="py-2.5 flex items-center gap-3 text-xs text-gray-600">
                <span className={`shrink-0 inline-block w-2 h-2 rounded-full ${STATUS_DOT[log.status] ?? 'bg-gray-300'}`} />
                <span className="w-20 font-medium text-gray-900 capitalize">{log.status}</span>
                <span className="flex-1 text-gray-500">
                  {log.recordsStaged ?? 0} staged · {log.recordsSkipped ?? 0} skipped
                  {log.recordsFailed ? ` · ${log.recordsFailed} failed` : ''}
                </span>
                <span className="text-gray-400 shrink-0">
                  {new Date(log.startedAt).toLocaleString('en-MY', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {syncs.length === 0 && !result && (
        <p className="text-xs text-gray-400">No syncs run yet.</p>
      )}
    </div>
  )
}
