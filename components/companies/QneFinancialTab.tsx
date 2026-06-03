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

      {/* Error states */}
      {error === 'qne_unavailable' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 space-y-2">
          <p className="text-sm font-semibold text-amber-800">⚠ QNE is unreachable</p>
          <p className="text-sm text-amber-700">
            Ensure <strong>Radmin VPN</strong> is connected to the <em>Flexxokl</em> network, then try again.
          </p>
          <button onClick={refresh} disabled={loading} className="text-sm text-amber-800 underline hover:no-underline">
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
          {/* Outstanding Balance + Account Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Outstanding Balance</h3>
              <p className={`text-3xl font-bold ${data.customer.currentBalance > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {MYR(data.customer.currentBalance)}
              </p>
              {data.customer.currentBalance === 0 && (
                <span className="inline-flex items-center mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  ✓ No outstanding balance
                </span>
              )}
              {data.customer.currentBalance > 0 && (
                <p className="text-xs text-red-500 mt-1.5">Amount owed to Flexxo</p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Account Information</h3>
              <div className="space-y-2.5">
                <div>
                  <p className="text-xs text-gray-400">Payment Term</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">
                    {data.customer.paymentTerm ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Currency</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{data.customer.currency}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Invoices */}
          {data.recentInvoices.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Invoices</h3>
                <span className="text-xs text-gray-400">{data.recentInvoices.length} invoices</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2.5 font-medium">Invoice No</th>
                    <th className="px-4 py-2.5 font-medium">Invoice Date</th>
                    <th className="px-4 py-2.5 font-medium">Due Date</th>
                    <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInvoices.map((inv, i) => {
                    const isOverdue = inv.dueDate
                      ? new Date(inv.dueDate) < new Date()
                      : false
                    return (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-gray-800">{inv.invoiceNo}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {inv.invoiceDate
                            ? new Date(inv.invoiceDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {inv.dueDate ? (
                            <span className={isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
                              {new Date(inv.dueDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {isOverdue && ' ⚠'}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {MYR(inv.amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No recent invoices found for this customer.</p>
            </div>
          )}

          <p className="text-xs text-gray-400 text-right">
            ⓘ Outstanding balance from QNE customer record · Invoices from last 200 transactions
          </p>
        </>
      )}
    </div>
  )
}
