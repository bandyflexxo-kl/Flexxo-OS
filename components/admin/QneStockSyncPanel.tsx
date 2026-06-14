'use client'

/**
 * QneStockSyncPanel — Admin panel to sync QNE available stock into the DB.
 *
 * Once synced, the shop hides any product with 0 available stock
 * (products.qneAvailableQty). VPN must be active when clicking Sync.
 */

import { useState } from 'react'

type SyncResult = {
  ok:              boolean
  stocksFetched:   number
  productsUpdated:  number
  zeroed:          number
  skipped:         number
  errors:          string[]
}

export default function QneStockSyncPanel() {
  const [syncing, setSyncing] = useState(false)
  const [result,  setResult]  = useState<SyncResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setResult(null)
    setError(null)

    try {
      const res  = await fetch('/api/admin/qne/sync-stock', { method: 'POST' })
      const data = await res.json() as SyncResult & { error?: string; code?: string }

      if (!res.ok) {
        if (data.code === 'QNE_UNAVAILABLE') {
          setError('QNE is unreachable. Please ensure Radmin VPN (Flexxokl) is active, then try again.')
        } else {
          setError(data.error ?? `Server error (HTTP ${res.status})`)
        }
        return
      }

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
          <h3 className="text-sm font-semibold text-gray-900">QNE Stock Availability Sync</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pulls live available quantity per product from QNE.
            Shop <span className="font-medium text-green-700">hides items with 0 stock</span>.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0 ml-4 px-4 py-2 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Syncing…' : '↻ Sync Stock'}
        </button>
      </div>

      {/* VPN reminder */}
      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
        <span>⚠</span>
        <span>Radmin VPN (Flexxokl) must be active before syncing.</span>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-xs text-green-800 space-y-1">
          <p className="font-semibold">✓ Sync complete</p>
          <p>Stock balances fetched: <span className="font-medium">{result.stocksFetched}</span></p>
          <p>Products updated: <span className="font-medium">{result.productsUpdated}</span></p>
          <p>Now out of stock (hidden): <span className="font-medium">{result.zeroed}</span></p>
          <p>Products without QNE match: <span className="font-medium">{result.skipped}</span></p>
          {result.errors.length > 0 && (
            <p className="text-red-600">Errors: {result.errors.length} (see server logs)</p>
          )}
        </div>
      )}
    </div>
  )
}
