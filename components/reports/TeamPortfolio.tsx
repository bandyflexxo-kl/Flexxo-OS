'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { TeamPortfolioResponse, SalespersonPortfolio, ClientRow } from '@/app/api/reports/team/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMyr(n: number): string {
  if (n >= 1_000_000) return `RM ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `RM ${(n / 1_000).toFixed(1)}k`
  return `RM ${n.toFixed(2)}`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function balanceColor(bal: number | null): string {
  if (bal === null)    return 'text-gray-400'
  if (bal > 10_000)   return 'text-red-600 font-semibold'
  if (bal > 2_000)    return 'text-orange-500 font-medium'
  if (bal > 0)        return 'text-yellow-600'
  return 'text-green-600'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ClientList({ clients }: { clients: ClientRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (clients.length === 0) {
    return <p className="text-xs text-gray-400 px-4 py-3">No clients assigned.</p>
  }

  return (
    <div className="divide-y divide-gray-50">
      {clients.map(c => (
        <div key={c.companyId}>
          {/* Client row */}
          <div
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors"
            onClick={() => setExpanded(prev => prev === c.companyId ? null : c.companyId)}
          >
            {/* Expand arrow */}
            <span className={`text-gray-300 text-xs transition-transform ${expanded === c.companyId ? 'rotate-90' : ''}`}>
              ▶
            </span>

            {/* Company name */}
            <Link
              href={`/companies?q=${encodeURIComponent(c.companyName)}`}
              className="flex-1 text-sm text-gray-800 hover:text-blue-600 hover:underline truncate"
              onClick={e => e.stopPropagation()}
            >
              {c.companyName}
            </Link>

            {/* Outstanding balance */}
            <span className={`text-sm tabular-nums ${balanceColor(c.outstandingBalance)}`}>
              {c.outstandingBalance === null ? '—' : fmtMyr(c.outstandingBalance)}
            </span>

            {/* Top item pill (first item as preview) */}
            {c.topItems[0] && (
              <span className="hidden sm:block text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full truncate max-w-[140px]">
                {c.topItems[0].itemName.length > 22
                  ? c.topItems[0].itemName.slice(0, 22) + '…'
                  : c.topItems[0].itemName}
              </span>
            )}

            {/* Item count badge */}
            <span className="text-xs text-gray-400 w-14 text-right shrink-0">
              {c.topItems.length > 0
                ? `${c.topItems.length} item${c.topItems.length !== 1 ? 's' : ''}`
                : 'no items'}
            </span>
          </div>

          {/* Expanded: top items */}
          {expanded === c.companyId && (
            <div className="bg-blue-50/40 px-8 py-3 border-t border-blue-100">
              {c.topItems.length === 0 ? (
                <p className="text-xs text-gray-400 italic">
                  No invoice history synced yet. Run "Sync from QNE" to load items.
                </p>
              ) : (
                <>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Recurring Items
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {c.topItems.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px] font-bold">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 font-medium truncate" title={item.itemName}>
                            {item.itemName}
                          </p>
                          <p className="text-gray-400">
                            {item.orderCount}× ordered · last {fmtRelative(item.lastOrderAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {c.qneCustomerCode && (
                <p className="text-xs text-gray-300 mt-2">QNE code: {c.qneCustomerCode}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SalespersonCard({ sp }: { sp: SalespersonPortfolio }) {
  const [open, setOpen] = useState(false)

  const outstandingLabel = sp.totalOutstanding > 0
    ? fmtMyr(sp.totalOutstanding)
    : 'RM 0'

  const outstandingCls = sp.totalOutstanding > 50_000
    ? 'text-red-600 font-bold'
    : sp.totalOutstanding > 10_000
    ? 'text-orange-500 font-semibold'
    : 'text-gray-700 font-medium'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center shrink-0">
          {sp.name.slice(0, 1).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{sp.name}</p>
          <p className="text-xs text-gray-400">{sp.clientCount} client{sp.clientCount !== 1 ? 's' : ''}</p>
        </div>

        {/* Total outstanding */}
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400 mb-0.5">Total Outstanding</p>
          <p className={`text-sm tabular-nums ${outstandingCls}`}>{outstandingLabel}</p>
        </div>

        {/* Chevron */}
        <span className={`text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {/* Client list */}
      {open && (
        <>
          {/* Sub-header */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-xs font-medium text-gray-400">
            <span className="w-4" />
            <span className="flex-1">Company</span>
            <span className="w-24 text-right">Outstanding</span>
            <span className="hidden sm:block w-36 text-right">Top Item</span>
            <span className="w-14 text-right">Items</span>
          </div>
          <ClientList clients={sp.clients} />
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TeamPortfolio() {
  const [data,    setData]    = useState<TeamPortfolioResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/reports/team', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as TeamPortfolioResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    setError(null)
    try {
      const res  = await fetch('/api/admin/qne/sync-portfolio', { method: 'POST' })
      const body = await res.json() as {
        ok?: boolean
        error?: string
        balancesUpdated?: number
        itemsUpdated?: number
        invoicesFetched?: number
        errors?: string[]
      }

      if (!res.ok) {
        if (res.status === 503) {
          setError('QNE unreachable — please activate Radmin VPN (Flexxokl network) and try again.')
        } else {
          setError(body.error ?? 'Sync failed')
        }
      } else {
        setSyncMsg(
          `✅ Synced — ${body.balancesUpdated ?? 0} balances, ` +
          `${body.invoicesFetched ?? 0} invoices fetched, ` +
          `${body.itemsUpdated ?? 0} item records updated`
        )
        await load()
      }
    } catch {
      setError('Network error — sync could not reach the server')
    } finally {
      setSyncing(false)
    }
  }

  const hasSyncData = data && data.lastSyncAt !== null
  const isStale     = hasSyncData
    ? (Date.now() - new Date(data.lastSyncAt!).getTime()) > 24 * 60 * 60 * 1000
    : false

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Team Portfolio Intelligence
          </h2>
          {data?.lastSyncAt ? (
            <p className={`text-xs mt-0.5 ${isStale ? 'text-orange-500' : 'text-gray-400'}`}>
              {isStale ? '⚠ ' : ''}Last synced from QNE: {fmtRelative(data.lastSyncAt)}
              {data.unassignedCount > 0 && (
                <span className="text-gray-400 ml-2">· {data.unassignedCount} unassigned companies</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">
              No QNE data yet — click "Sync from QNE" to load balances &amp; recurring items
            </p>
          )}
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {syncing ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Syncing…
            </>
          ) : (
            <>⟳ Sync from QNE</>
          )}
        </button>
      </div>

      {/* Feedback messages */}
      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {syncMsg && (
        <div className="mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          {syncMsg}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 h-16 animate-pulse" />
          ))}
        </div>
      )}

      {/* Data */}
      {!loading && data && (
        <>
          {data.salespersons.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 px-6 py-10 text-center">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm text-gray-400">No salesperson portfolios found. Ensure company assignments are set up.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.salespersons.map(sp => (
                <SalespersonCard key={sp.userId} sp={sp} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
