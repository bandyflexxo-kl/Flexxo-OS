'use client'

import { useState } from 'react'
import type { QneFinancialData } from '@/lib/qneFinancial'

const MYR = (n: number) =>
  new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)

export default function QneFinancialTab({ companyId }: { companyId: string }) {
  const [data,      setData]      = useState<QneFinancialData | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<'qne_unavailable' | 'not_found' | 'error' | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/companies/${companyId}/qne`)
      const body = await res.json() as QneFinancialData & { error?: string }

      if (!res.ok) {
        if (body.error === 'qne_unavailable') { setError('qne_unavailable'); return }
        if (res.status === 404)               { setError('not_found'); return }
        setError('error')
        return
      }

      setData(body)
      setFetchedAt(new Date(body.fetchedAt).toLocaleString('en-MY', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }))
    } catch {
      setError('qne_unavailable')
    } finally {
      setLoading(false)
    }
  }

  const hasOverdue = (data?.aging.overdueAmount ?? 0) > 0

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">QNE Financial Data</h2>
          {fetchedAt && (
            <p className="text-xs text-gray-400 mt-0.5">Last fetched: {fetchedAt} — live from QNE</p>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Fetching…
            </>
          ) : (
            <>🔄 Refresh from QNE</>
          )}
        </button>
      </div>

      {/* VPN error */}
      {error === 'qne_unavailable' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 space-y-2">
          <p className="text-sm font-semibold text-amber-800">⚠ QNE is unreachable</p>
          <p className="text-sm text-amber-700">
            Ensure <strong>Radmin VPN</strong> is connected to the <em>Flexxokl</em> network, then try again.
          </p>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm text-amber-800 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      {error === 'not_found' && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-5 py-4">
          <p className="text-sm text-gray-500">This company is not linked to a QNE customer code.</p>
        </div>
      )}
      {error === 'error' && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4">
          <p className="text-sm text-red-600">Failed to fetch data from QNE. Please try again.</p>
        </div>
      )}

      {/* Empty state */}
      {!data && !error && !loading && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-6 py-12 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-sm text-gray-500 mb-4">
            Click <strong>Refresh from QNE</strong> to load live financial data.
          </p>
          <p className="text-xs text-gray-400">Radmin VPN must be connected to the Flexxokl network.</p>
        </div>
      )}

      {/* Data panels */}
      {data && (
        <>
          {/* Outstanding Balance */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Outstanding Balance</h3>
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <p className="text-3xl font-bold text-gray-900">{MYR(data.aging.totalOutstanding)}</p>
                <p className="text-xs text-gray-400 mt-1">Total outstanding</p>
              </div>
              {hasOverdue && (
                <div>
                  <p className="text-xl font-bold text-red-600">{MYR(data.aging.overdueAmount)}</p>
                  <p className="text-xs text-red-500 mt-1">Overdue</p>
                </div>
              )}
              {!hasOverdue && data.aging.totalOutstanding > 0 && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  ✓ No overdue amount
                </span>
              )}
            </div>

            {/* Aging breakdown */}
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Current',  value: data.aging.aging.current },
                { label: '1–30 days', value: data.aging.aging.days30, warn: true },
                { label: '31–60 days', value: data.aging.aging.days60, warn: true },
                { label: '61–90 days', value: data.aging.aging.days90, warn: true },
                { label: '90+ days',  value: data.aging.aging.over90,  danger: true },
              ].map(bucket => (
                <div
                  key={bucket.label}
                  className={`rounded-lg px-3 py-2.5 text-center ${
                    bucket.value > 0 && bucket.danger
                      ? 'bg-red-50 border border-red-200'
                      : bucket.value > 0 && bucket.warn
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-gray-50 border border-gray-200'
                  }`}
                >
                  <p className={`text-sm font-semibold ${
                    bucket.value > 0 && bucket.danger
                      ? 'text-red-700'
                      : bucket.value > 0 && bucket.warn
                      ? 'text-amber-700'
                      : 'text-gray-700'
                  }`}>{MYR(bucket.value)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{bucket.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Account Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Account Information</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-400">Credit Limit</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">
                  {data.customer.creditLimit != null ? MYR(data.customer.creditLimit) : '—'}
                </p>
                {data.customer.creditLimit != null && data.aging.totalOutstanding > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {MYR(Math.max(0, data.customer.creditLimit - data.aging.totalOutstanding))} remaining
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400">Payment Term</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">{data.customer.paymentTerm ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Currency</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">{data.customer.currency}</p>
              </div>
            </div>
          </div>

          {/* Recent Invoices */}
          {data.recentInvoices.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Invoices</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2.5 font-medium">Invoice No</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Due</th>
                    <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                    <th className="px-4 py-2.5 font-medium text-right">Balance</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInvoices.map((inv, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-gray-800">{inv.invoiceNo}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {inv.invoiceDate
                          ? new Date(inv.invoiceDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {inv.dueDate ? (
                          <span className={new Date(inv.dueDate) < new Date() && inv.balance > 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                            {new Date(inv.dueDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{MYR(inv.amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold">
                        <span className={inv.balance > 0 ? 'text-red-600' : 'text-green-600'}>
                          {MYR(inv.balance)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          inv.status.toLowerCase().includes('paid') || inv.balance === 0
                            ? 'bg-green-100 text-green-700'
                            : inv.balance > 0
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No invoice history found in QNE.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
