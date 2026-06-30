'use client'

/**
 * QneBranchSyncPanel — pulls QNE branch addresses into each portal customer's
 * delivery addresses (so they pick from real branches at checkout). Customer
 * edits are preserved; QNE has no lat/lng (captured later at booking).
 */

import { useState } from 'react'

type SyncResult = { ok: boolean; companies: number; created: number; updated: number; skippedManual: number; hqSeeded: number; note?: string }

export default function QneBranchSyncPanel() {
  const [syncing, setSyncing] = useState(false)
  const [result,  setResult]  = useState<SyncResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true); setResult(null); setError(null)
    try {
      const res  = await fetch('/api/admin/qne/sync-branches', { method: 'POST' })
      const data = await res.json() as SyncResult & { error?: string }
      if (!res.ok) { setError(data.error ?? `Server error (HTTP ${res.status})`); return }
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">QNE Branch Addresses Sync</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pre-fills each portal customer&apos;s <span className="font-medium text-green-700">delivery branches</span> from QNE
            (branch name, contact, phone, address). Customer edits are kept.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0 ml-4 px-4 py-2 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Syncing…' : '↻ Sync Branches'}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
        <span>⚠</span>
        <span>Radmin VPN (Flexxokl) must be active before syncing.</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">{error}</div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-xs text-green-800 space-y-1">
          <p className="font-semibold">✓ Sync complete</p>
          <p>
            Customers: <span className="font-medium">{result.companies}</span> · Created: <span className="font-medium">{result.created}</span> ·
            Updated: <span className="font-medium">{result.updated}</span> · Kept (edited): <span className="font-medium">{result.skippedManual}</span> ·
            HQ seeded: <span className="font-medium">{result.hqSeeded}</span>
          </p>
          {result.note && <p>{result.note}</p>}
        </div>
      )}
    </div>
  )
}
