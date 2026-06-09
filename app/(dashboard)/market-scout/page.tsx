'use client'

import { useState, useRef }   from 'react'
import Topbar                  from '@/components/layout/Topbar'
import type { ScoutResult, ScoutSourceResult } from '@/lib/marketScout'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMyr(n: number) {
  return `RM ${n.toFixed(2)}`
}

function sourceBadgeClass(source: string): string {
  const map: Record<string, string> = {
    'Shopee':    'bg-orange-100 text-orange-700 border-orange-200',
    'Lazada':    'bg-purple-100 text-purple-700 border-purple-200',
    "Lotus's":   'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Mr. DIY':   'bg-red-100 text-red-700 border-red-200',
    'Popular':   'bg-blue-100 text-blue-700 border-blue-200',
    'AEON':      'bg-teal-100 text-teal-700 border-teal-200',
    'Watsons':   'bg-green-100 text-green-700 border-green-200',
    'Amazon.my': 'bg-amber-100 text-amber-700 border-amber-200',
  }
  return map[source] ?? 'bg-gray-100 text-gray-700 border-gray-200'
}

// ── Result row ────────────────────────────────────────────────────────────────

function SourceRow({ r, isCheapest }: { r: ScoutSourceResult; isCheapest: boolean }) {
  return (
    <tr className={`border-b border-gray-50 text-sm ${isCheapest ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
      <td className="px-3 py-2.5">
        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium border ${sourceBadgeClass(r.source)}`}>
          {r.source}
        </span>
      </td>
      <td className="px-3 py-2.5 text-gray-700 max-w-[180px]">
        <p className="truncate text-xs" title={r.storeName}>{r.storeName}</p>
        {r.isOfficial && (
          <span className="text-[10px] text-green-600 font-medium">✓ Official</span>
        )}
      </td>
      <td className={`px-3 py-2.5 font-semibold tabular-nums ${isCheapest ? 'text-green-700' : 'text-gray-900'}`}>
        {fmtMyr(r.price)}
        {isCheapest && <span className="ml-1 text-[10px] bg-green-100 text-green-700 px-1 rounded">Cheapest</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[120px]">
        <p className="truncate" title={r.unit}>{r.unit || '—'}</p>
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-xs ${r.inStock ? 'text-green-600' : 'text-red-400'}`}>
          {r.inStock ? '● In stock' : '○ Out of stock'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-400 max-w-[140px]">
        <p className="truncate" title={r.notes}>{r.notes || '—'}</p>
      </td>
      <td className="px-3 py-2.5">
        {r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
          >
            View →
          </a>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

function ProductResultCard({ result }: { result: ScoutResult }) {
  const [expanded, setExpanded] = useState(true)

  if (result.error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <span className="text-red-400">✕</span>
          <p className="font-medium text-gray-800 text-sm">{result.productName}</p>
          <span className="ml-auto text-xs text-red-500">{result.error}</span>
        </div>
      </div>
    )
  }

  if (result.notFound || result.results.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2">
          <span className="text-amber-400">○</span>
          <p className="font-medium text-gray-700 text-sm">{result.productName}</p>
          <span className="ml-auto text-xs text-amber-600">Not found in official stores</span>
        </div>
      </div>
    )
  }

  const cheapest = result.cheapest
  const othersCount = result.results.length - 1

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-green-500">✓</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{result.productName}</p>
          <p className="text-xs text-gray-400">
            {result.results.length} source{result.results.length !== 1 ? 's' : ''} found
            {cheapest && (
              <span className="ml-2 text-green-600 font-medium">
                · Cheapest: {fmtMyr(cheapest.price)} at {cheapest.source}
              </span>
            )}
          </p>
        </div>
        {othersCount > 0 && (
          <span className="text-xs text-gray-400 shrink-0">
            {expanded ? '▲' : '▼'} {othersCount + 1} prices
          </span>
        )}
      </button>

      {/* Results table */}
      {expanded && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 font-medium">Platform</th>
                <th className="px-3 py-2 font-medium">Store</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r, i) => (
                <SourceRow
                  key={i}
                  r={r}
                  isCheapest={r === cheapest}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tips panel ────────────────────────────────────────────────────────────────

function SourcingTips() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-blue-100 transition-colors"
      >
        <span className="text-blue-500">💡</span>
        <span className="text-sm font-medium text-blue-800">Other ways to find cheapest sources</span>
        <span className="ml-auto text-blue-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-blue-900 space-y-2 border-t border-blue-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {[
              { title: '1688.com (Alibaba wholesale)', desc: 'Mainland China manufacturer direct. Best for bulk orders. Requires freight forwarder. 30–70% cheaper than retail for 50+ units.', url: 'https://1688.com', tag: 'Wholesale' },
              { title: 'Alibaba.com', desc: 'English-language version of 1688. MOQ negotiable. Many Malaysian suppliers source from here. Request samples before committing.', url: 'https://alibaba.com', tag: 'Wholesale' },
              { title: 'MyHD (Malaysian Hardware & Distribution)', desc: 'Local Malaysian distributor aggregator. Good for office consumables at distributor pricing.', url: 'https://myhd.my', tag: 'Local' },
              { title: 'Carousell Business Malaysia', desc: 'Clearance and overstocked goods from verified sellers. Useful for one-off client requests at low cost.', url: 'https://www.carousell.com.my', tag: 'Clearance' },
              { title: 'PriceArea.com.my', desc: 'Price comparison engine for Malaysian online stores. Aggregates prices from multiple platforms automatically.', url: 'https://www.pricearea.com.my', tag: 'Comparison' },
              { title: 'Shopee Wholesale / ShopeeMall', desc: 'Filter by "ShopeeMall" and sort by unit price. Many FMCG brands have bulk-buy tier discounts.', url: 'https://shopee.com.my', tag: 'Platform' },
              { title: 'Direct brand website', desc: 'Brands like Faber-Castell, Artline, 3M often have Malaysian B2B portals or distributor locators with better pricing than retail.', url: '', tag: 'Brand Direct' },
              { title: 'Hatten Trade (Hatten Group)', desc: 'Local B2B procurement marketplace focused on Malaysia. Some office supply categories.', url: 'https://hattentrade.com', tag: 'B2B' },
            ].map(tip => (
              <div key={tip.title} className="bg-white rounded-lg border border-blue-100 p-3">
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium shrink-0">{tip.tag}</span>
                  <p className="text-xs font-semibold text-gray-800">{tip.title}</p>
                </div>
                <p className="text-xs text-gray-500 mb-2">{tip.desc}</p>
                {tip.url && (
                  <a href={tip.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >{tip.url.replace('https://', '')}</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketScoutPage() {
  const [input,    setInput]    = useState('')
  const [results,  setResults]  = useState<ScoutResult[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function parseProductList(raw: string): string[] {
    return raw
      .split(/\r?\n/)
      .map(l => l.replace(/^[\d]+[.)]\s*/, '').replace(/^[•\-*]\s*/, '').trim())
      .filter(l => l.length > 1)
      .slice(0, 20)
  }

  async function handleScan() {
    const products = parseProductList(input)
    if (products.length === 0) return

    setScanning(true)
    setResults([])
    setError(null)
    setProgress({ done: 0, total: products.length })

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/market-scout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ products }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      // Read SSE stream
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (!json) continue

          const evt = JSON.parse(json) as
            | { type: 'result'; data: ScoutResult }
            | { type: 'done';   total: number }
            | { type: 'error';  message: string }

          if (evt.type === 'result') {
            setResults(prev => [...prev, evt.data])
            setProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
          } else if (evt.type === 'error') {
            setError(evt.message)
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Search failed')
      }
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setScanning(false)
    setProgress(null)
  }

  const productCount = parseProductList(input).length

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title="Market Price Scout" />

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-5">

        {/* Intro */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="text-2xl">🔍</div>
            <div>
              <h2 className="font-semibold text-gray-900">Find cheapest sources for non-stock items</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Paste items NOT in your QNE catalogue. The scout searches Shopee official stores,
                Lazada LazMall, Lotus&apos;s, Mr. DIY, Popular, Watsons, and more — returning the
                cheapest price per source.
              </p>
            </div>
          </div>

          {/* Input */}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={"Paste product list here, one per line:\nFaber Castel Mechanical Pencil Lead 0.5mm\nLight Duty Scissors\nStaples No.10\nPuncher DP480\n..."}
            rows={7}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
          />

          {/* Action row */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {!scanning ? (
              <button
                onClick={handleScan}
                disabled={productCount === 0}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                🔍 Scout {productCount > 0 ? `${productCount} item${productCount !== 1 ? 's' : ''}` : 'items'}
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="px-5 py-2.5 bg-red-500 text-white text-sm font-semibold rounded-xl hover:bg-red-600 transition-colors"
              >
                ✕ Stop
              </button>
            )}

            {progress && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Searching {progress.done + 1} of {progress.total}…
              </div>
            )}

            {productCount > 20 && (
              <p className="text-xs text-orange-500">Max 20 items per search. First 20 will be used.</p>
            )}

            {productCount > 0 && !scanning && (
              <p className="text-xs text-gray-400 ml-auto">
                ~{productCount * 10}–{productCount * 20}s estimated
              </p>
            )}
          </div>

          {error && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Results ({results.length})
              </h3>
              {!scanning && (
                <p className="text-xs text-gray-400">
                  {results.filter(r => !r.notFound && !r.error).length} found ·{' '}
                  {results.filter(r => r.notFound).length} not found
                </p>
              )}
            </div>
            {results.map((r, i) => (
              <ProductResultCard key={i} result={r} />
            ))}
          </div>
        )}

        {/* Sourcing tips */}
        <SourcingTips />

      </main>
    </div>
  )
}
