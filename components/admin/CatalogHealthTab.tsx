'use client'

/**
 * Catalog Health tab (/admin/products?tab=health) — decision dashboard for
 * cleaning up the online shop:
 *   1. Dead stock  — never ordered (no QNE invoice lines in the 2-yr synced
 *      window, no portal orders) → bulk-hide from shop.
 *   2. Flagged photos — photo review found no acceptable photo → bulk-disable.
 *   3. Frequent-buy guard — the shop MUST include every frequent-buy product;
 *      bulk hides skip them, and any currently hidden are listed for re-show.
 */

import { useCallback, useEffect, useState } from 'react'

type Row = {
  id: string; name: string; brand: string | null; qneItemCode: string | null
  qty: number | null; invoiceFreq: number; portalOrders: number
  visible: boolean; hasPhoto: boolean; flagged: boolean; categoryName: string
}

type ApiData = {
  freqMin: number
  rowCap:  number
  deadStock:      { total: number; visible: number; rows: Row[] }
  flagged:        { total: number; visible: number; rows: Row[] }
  frequentHidden: { total: number; rows: Row[] }
}

type BulkAction = 'hide-dead-stock' | 'hide-flagged' | 'show-frequent'

const SHOW_STEP = 50

export default function CatalogHealthTab() {
  const [data, setData]       = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState<BulkAction | 'row' | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set())
  const [showDead, setShowDead]     = useState(SHOW_STEP)
  const [showFlagged, setShowFlagged] = useState(SHOW_STEP)
  const [showFreq, setShowFreq]     = useState(SHOW_STEP)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/admin/products/catalog-health')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json() as ApiData)
    } catch {
      setError('Could not load catalog health data.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function runBulk(action: BulkAction, confirmMsg: string) {
    if (!confirm(confirmMsg)) return
    setBusy(action); setNotice(null)
    try {
      const r = await fetch('/api/admin/products/catalog-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const d = await r.json() as { updated?: number; protected?: number; error?: string }
      if (!r.ok) { setNotice(typeof d.error === 'string' ? d.error : 'Action failed.'); return }
      setNotice(
        action === 'show-frequent'
          ? `✓ ${d.updated} frequent-buy product${d.updated === 1 ? '' : 's'} made visible in the shop.`
          : `✓ ${d.updated} product${d.updated === 1 ? '' : 's'} hidden from the shop.${(d.protected ?? 0) > 0 ? ` ${d.protected} frequent-buy item${d.protected === 1 ? '' : 's'} were protected and stay visible.` : ''}`,
      )
      await load()
    } catch { setNotice('Action failed.') }
    finally { setBusy(null) }
  }

  async function toggleOne(id: string, visible: boolean) {
    setRowBusy(prev => new Set(prev).add(id))
    try {
      await fetch('/api/admin/products/catalog-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: visible ? 'show-one' : 'hide-one', productId: id }),
      })
      await load()
    } finally {
      setRowBusy(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  if (loading && !data) return <p className="text-sm text-gray-400 py-10 text-center">Analysing catalogue…</p>
  if (error)  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
      {error} <button onClick={() => void load()} className="underline font-medium ml-1">Retry</button>
    </div>
  )
  if (!data) return null

  const capNote = (total: number) => total > data.rowCap ? ` (showing first ${data.rowCap})` : ''

  return (
    <div className="space-y-6">
      {notice && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-800 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-green-400 hover:text-green-600 ml-3">×</button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-2xl font-bold text-gray-900">{data.deadStock.total.toLocaleString()}</p>
          <p className="text-sm text-gray-500 mt-0.5">Dead stock — never ordered</p>
          <p className="text-xs text-gray-400 mt-1">{data.deadStock.visible.toLocaleString()} still visible in shop</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-2xl font-bold text-red-600">{data.flagged.visible.toLocaleString()}</p>
          <p className="text-sm text-gray-500 mt-0.5">Flagged photos, still visible</p>
          <p className="text-xs text-gray-400 mt-1">{data.flagged.total.toLocaleString()} flagged in total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-2xl font-bold text-amber-600">{data.frequentHidden.total.toLocaleString()}</p>
          <p className="text-sm text-gray-500 mt-0.5">Frequent-buy items hidden</p>
          <p className="text-xs text-gray-400 mt-1">must be visible — re-show below</p>
        </div>
      </div>

      {/* ── Section 3 first when non-empty: it's the MUST-fix ── */}
      {data.frequentHidden.total > 0 && (
        <section className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 bg-amber-50/50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">⚠ Frequent-buy products hidden from the shop</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Ordered in ≥{data.freqMin} QNE invoices (last 2 yrs) or via the portal, but currently invisible. The shop must include these.
              </p>
            </div>
            <button
              onClick={() => void runBulk('show-frequent', `Make all ${data.frequentHidden.total} frequent-buy products visible in the shop?`)}
              disabled={busy !== null}
              className="px-4 py-2 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              {busy === 'show-frequent' ? 'Working…' : `✓ Make all ${data.frequentHidden.total} visible`}
            </button>
          </div>
          <HealthTable
            rows={data.frequentHidden.rows.slice(0, showFreq)}
            emptyText=""
            rowBusy={rowBusy}
            action={{ label: 'Show', onClick: id => void toggleOne(id, true) }}
          />
          {data.frequentHidden.rows.length > showFreq && (
            <ShowMore onClick={() => setShowFreq(n => n + SHOW_STEP)} />
          )}
        </section>
      )}

      {/* ── Section 1: dead stock ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Dead stock — deactivation candidates{capNote(data.deadStock.visible)}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Zero QNE invoice lines (2-year synced window) and zero portal orders. Sorted by QNE stock qty —
              items with stock are sitting capital; restock (purchase) history isn&apos;t synced from QNE yet, so use the qty column as the restock signal.
            </p>
          </div>
          <button
            onClick={() => void runBulk('hide-dead-stock', `Hide all ${data.deadStock.visible} never-ordered products from the online shop?\n\nFrequent-buy items are automatically protected. You can re-show any product later from the Products tab.`)}
            disabled={busy !== null || data.deadStock.visible === 0}
            className="px-4 py-2 bg-gray-800 text-white text-xs font-semibold rounded-lg hover:bg-gray-900 disabled:opacity-50"
          >
            {busy === 'hide-dead-stock' ? 'Working…' : `Hide all ${data.deadStock.visible} from shop`}
          </button>
        </div>
        <HealthTable
          rows={data.deadStock.rows.slice(0, showDead)}
          emptyText="No visible dead-stock products — the shop is clean. 🎉"
          rowBusy={rowBusy}
          action={{ label: 'Hide', onClick: id => void toggleOne(id, false) }}
        />
        {data.deadStock.rows.length > showDead && (
          <ShowMore onClick={() => setShowDead(n => n + SHOW_STEP)} />
        )}
      </section>

      {/* ── Section 2: flagged photos ── */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Flagged photos still visible{capNote(data.flagged.visible)}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Photo review flagged these (no acceptable photo found). Disable them from the shop until a good photo exists —
              fix photos in the <a href="/admin/products?tab=photos" className="underline">Photo Review</a> tab.
            </p>
          </div>
          <button
            onClick={() => void runBulk('hide-flagged', `Disable all ${data.flagged.visible} flagged products from the online shop?\n\nFrequent-buy items are automatically protected — fix their photos instead.`)}
            disabled={busy !== null || data.flagged.visible === 0}
            className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {busy === 'hide-flagged' ? 'Working…' : `Disable all ${data.flagged.visible} flagged`}
          </button>
        </div>
        <HealthTable
          rows={data.flagged.rows.slice(0, showFlagged)}
          emptyText="No flagged products are visible in the shop. 🎉"
          rowBusy={rowBusy}
          action={{ label: 'Hide', onClick: id => void toggleOne(id, false) }}
        />
        {data.flagged.rows.length > showFlagged && (
          <ShowMore onClick={() => setShowFlagged(n => n + SHOW_STEP)} />
        )}
      </section>
    </div>
  )
}

function ShowMore({ onClick }: { onClick: () => void }) {
  return (
    <div className="px-5 py-3 border-t border-gray-50">
      <button onClick={onClick} className="text-xs font-medium text-green-600 hover:text-green-700">＋ Show more</button>
    </div>
  )
}

function HealthTable({
  rows, emptyText, action, rowBusy,
}: {
  rows: Row[]
  emptyText: string
  action: { label: string; onClick: (id: string) => void }
  rowBusy: Set<string>
}) {
  if (rows.length === 0) {
    return emptyText ? <p className="px-5 py-8 text-sm text-gray-400 text-center">{emptyText}</p> : null
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="px-5 py-2.5 font-medium">Product</th>
            <th className="px-3 py-2.5 font-medium">QNE code</th>
            <th className="px-3 py-2.5 font-medium">Category</th>
            <th className="px-3 py-2.5 font-medium text-right">Stock qty</th>
            <th className="px-3 py-2.5 font-medium text-right">Invoices</th>
            <th className="px-3 py-2.5 font-medium text-right">Portal orders</th>
            <th className="px-3 py-2.5 font-medium">Photo</th>
            <th className="px-5 py-2.5 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(r => (
            <tr key={r.id} className="hover:bg-gray-50/50">
              <td className="px-5 py-2.5">
                <p className="font-medium text-gray-900 leading-snug">{r.name}</p>
                {r.brand && <p className="text-xs text-gray-400">{r.brand}</p>}
              </td>
              <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{r.qneItemCode ?? '—'}</td>
              <td className="px-3 py-2.5 text-xs text-gray-500">{r.categoryName}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{r.qty ?? '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{r.invoiceFreq}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{r.portalOrders}</td>
              <td className="px-3 py-2.5 text-xs">
                {r.flagged ? <span className="text-red-500">🚩 flagged</span> : r.hasPhoto ? <span className="text-green-600">✓</span> : <span className="text-gray-300">none</span>}
              </td>
              <td className="px-5 py-2.5 text-right">
                <button
                  onClick={() => action.onClick(r.id)}
                  disabled={rowBusy.has(r.id)}
                  className="px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {rowBusy.has(r.id) ? '…' : action.label}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
