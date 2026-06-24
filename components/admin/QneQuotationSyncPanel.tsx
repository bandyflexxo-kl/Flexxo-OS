'use client'

import { useState } from 'react'

type SyncResult = {
  ok:                 boolean
  quotationsFetched:  number
  quotationsUpserted: number
  itemsUpserted:      number
  companiesLinked:    number
  errors:             string[]
}

export default function QneQuotationSyncPanel() {
  const [syncing, setSyncing] = useState(false)
  const [result,  setResult]  = useState<SyncResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setResult(null)
    setError(null)

    try {
      const res  = await fetch('/api/admin/qne/sync-quotations', { method: 'POST' })
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
          <h3 className="text-sm font-semibold text-gray-900">QNE Quotation Sync</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Pulls all quotations created directly in QNE (last 2 years) into the CRM.
            Visible under each company's <span className="font-medium">Quotations</span> tab.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="shrink-0 ml-4 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Syncing…' : '↻ Sync QNE Quotations'}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
        <span>⚠</span>
        <span>Radmin VPN (Flexxokl) must be active. Run this after staff have been creating quotations in QNE.</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800 space-y-1">
          <p className="font-semibold">✓ Sync complete</p>
          <p>Quotations fetched from QNE: <span className="font-medium">{result.quotationsFetched}</span></p>
          <p>Quotations stored/updated:   <span className="font-medium">{result.quotationsUpserted}</span></p>
          <p>Line items stored:           <span className="font-medium">{result.itemsUpserted}</span></p>
          <p>Linked to CRM companies:     <span className="font-medium">{result.companiesLinked}</span></p>
          {result.errors.length > 0 && (
            <p className="text-red-600">Errors: {result.errors.length} (check server logs)</p>
          )}
        </div>
      )}
    </div>
  )
}
