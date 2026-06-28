'use client'

import { useState, useEffect, useCallback } from 'react'

type DocType = 'quotation' | 'sales_order' | 'delivery_order' | 'invoice'
type Link = { docType: DocType; qneCode: string | null; status: string; error: string | null }

const ORDER_STAGES: { stage: 'sales_order' | 'delivery_order' | 'invoice'; label: string }[] = [
  { stage: 'sales_order',    label: 'Sales Order' },
  { stage: 'delivery_order', label: 'Delivery Order' },
  { stage: 'invoice',        label: 'Invoice' },
]

export default function QnePushPanel({ mode, id }: { mode: 'quotation' | 'order'; id: string }) {
  const base = mode === 'quotation' ? `/api/quotations/${id}/push-qne` : `/api/orders/${id}/push-qne`

  const [links,  setLinks]  = useState<Link[]>([])
  const [busy,   setBusy]   = useState<string | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(base)
      const b = await r.json()
      if (r.ok) setLinks(b.links ?? [])
    } catch { /* leave as-is */ }
    finally { setLoaded(true) }
  }, [base])

  useEffect(() => { load() }, [load])

  const linkFor = (d: DocType) => links.find(l => l.docType === d)

  async function push(body: object, key: string) {
    setBusy(key); setError(null)
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const b = await r.json()
      if (!r.ok) setError(typeof b.error === 'string' ? b.error : 'Push failed')
      await load()
    } catch { setError('Network error — please retry.') }
    finally { setBusy(null) }
  }

  function Badge({ link }: { link: Link | undefined }) {
    if (!link || link.status === 'pending')
      return <span className="text-xs text-gray-400">Not pushed</span>
    if (link.status === 'synced')
      return <span className="text-xs font-medium text-green-700">✓ {link.qneCode ?? 'synced'}</span>
    return <span className="text-xs font-medium text-red-600" title={link.error ?? ''}>Failed</span>
  }

  const Btn = ({ onClick, disabled, busyKey, children }: {
    onClick: () => void; disabled: boolean; busyKey: string; children: React.ReactNode
  }) => (
    <button onClick={onClick} disabled={disabled || busy !== null}
      className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">
      {busy === busyKey ? 'Pushing…' : children}
    </button>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">QNE Documents</h3>
        <span className="text-xs text-gray-400">single approval · writes to QNE</span>
      </div>

      {!loaded ? (
        <p className="text-xs text-gray-400">Loading QNE status…</p>
      ) : mode === 'quotation' ? (
        <>
          <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
            <span className="text-sm text-gray-700">Quotation</span>
            <div className="flex items-center gap-3">
              <Badge link={linkFor('quotation')} />
              {linkFor('quotation')?.status !== 'synced' && (
                <Btn onClick={() => push({}, 'quotation')} disabled={false} busyKey="quotation">Push to QNE</Btn>
              )}
            </div>
          </div>
          {linkFor('quotation')?.status === 'synced' && (
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-700">Invoice (QT→Invoice shortcut)</span>
              <div className="flex items-center gap-3">
                <Badge link={linkFor('invoice')} />
                {linkFor('invoice')?.status !== 'synced' && (
                  <Btn onClick={() => push({ shortcut: true }, 'shortcut')} disabled={false} busyKey="shortcut">Issue Invoice</Btn>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {ORDER_STAGES.map(({ stage, label }, i) => {
            const link = linkFor(stage)
            const prevSynced = i === 0 || linkFor(ORDER_STAGES[i - 1].stage)?.status === 'synced'
            const done = link?.status === 'synced'
            return (
              <div key={stage} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-700">{i + 1}. {label}</span>
                <div className="flex items-center gap-3">
                  <Badge link={link} />
                  {!done && (
                    <Btn onClick={() => push({ stage }, stage)} disabled={!prevSynced} busyKey={stage}>
                      {link?.status === 'failed' ? 'Retry' : 'Push'}
                    </Btn>
                  )}
                </div>
              </div>
            )
          })}
          <p className="text-xs text-gray-400">Each stage transfers from the one above (QNE prevents double-invoicing).</p>
        </>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>}
    </div>
  )
}
