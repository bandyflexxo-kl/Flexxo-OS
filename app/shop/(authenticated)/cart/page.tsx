'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FlexxoSpinner from '@/components/shop/FlexxoSpinner'
import TrustBadge from '@/components/shop/TrustBadge'

type CartItem = {
  id:          string
  productId:   string | null
  product:     { id: string; name: string; brand: string | null; unit: string | null; googleDrivePhotoId: string | null } | null
  description: string
  qty:         string
  unitPrice:   string
  lineTotal:   string
}

type CartData = {
  quotationId?: string
  items:        CartItem[]
  subtotal:     string
  totalAmount:  string
}

export default function CartPage() {
  const [cart,       setCart]       = useState<CartData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [busy,       setBusy]       = useState<Set<string>>(new Set())
  const [checking,   setChecking]   = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [poNumber,   setPoNumber]   = useState('')
  const [costCentre, setCostCentre] = useState('')
  const router = useRouter()

  const loadCart = useCallback(async () => {
    const res  = await fetch('/api/portal/cart')
    const data = await res.json() as CartData
    setCart(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadCart() }, [loadCart])

  async function updateQty(itemId: string, qty: number) {
    setBusy(prev => new Set([...prev, itemId]))
    try {
      await fetch(`/api/portal/cart/items/${itemId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ qty }),
      })
      await loadCart()
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(itemId); return n })
    }
  }

  async function removeItem(itemId: string) {
    setBusy(prev => new Set([...prev, itemId]))
    try {
      await fetch(`/api/portal/cart/items/${itemId}`, { method: 'DELETE' })
      await loadCart()
      router.refresh()
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(itemId); return n })
    }
  }

  async function checkout() {
    setChecking(true)
    setError(null)
    try {
      const res  = await fetch('/api/portal/cart/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          poNumber:   poNumber.trim()   || null,
          costCentre: costCentre.trim() || null,
        }),
      })
      const data = await res.json() as { quotationId?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Checkout failed'); return }
      router.push(`/shop/quotations/${data.quotationId}`)
    } finally {
      setChecking(false)
    }
  }

  if (loading) {
    return (
      <div className="flex gap-6 max-w-5xl">
        {/* Skeleton items */}
        <div className="flex-1 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex gap-4 animate-pulse">
              <div className="w-20 h-20 bg-gray-100 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/4" />
                <div className="h-4 bg-gray-100 rounded w-1/3 mt-2" />
              </div>
            </div>
          ))}
        </div>
        {/* Skeleton summary */}
        <div className="w-72 shrink-0 hidden md:block">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse space-y-4">
            <div className="h-4 bg-gray-100 rounded w-1/2" />
            <div className="h-8 bg-gray-100 rounded w-3/4" />
            <div className="h-12 bg-gray-100 rounded" />
          </div>
        </div>
      </div>
    )
  }

  const items = cart?.items ?? []
  const total = Number(cart?.totalAmount ?? 0)
  const itemCount = items.reduce((s, i) => s + parseInt(i.qty, 10), 0)

  if (items.length === 0) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-gray-200 px-8 py-20 text-center space-y-4">
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center text-4xl mx-auto">
            🛒
          </div>
          <div>
            <p className="text-gray-800 font-semibold">Your cart is empty</p>
            <p className="text-sm text-gray-400 mt-1">Browse our catalogue and add items to get started.</p>
          </div>
          <Link
            href="/shop/products"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors"
          >
            Browse Products →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Your Cart</h1>
          <p className="text-sm text-gray-500 mt-0.5">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/shop/products" className="text-sm text-green-600 hover:text-green-700 transition-colors flex items-center gap-1">
          ← Continue shopping
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Two-column layout on md+ */}
      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* ── Cart items ─────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {items.map(item => {
            const isBusy = busy.has(item.id)
            const qty    = parseInt(item.qty, 10)
            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border border-gray-200 flex gap-4 p-4 transition-opacity ${isBusy ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {/* Thumbnail */}
                <Link href={item.product ? `/shop/products/${item.product.id}` : '#'} className="shrink-0">
                  <div className="w-20 h-20 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden border border-gray-100 hover:border-green-200 transition-colors">
                    {item.product?.googleDrivePhotoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/portal/photo/${item.product.id}`} alt={item.description} loading="lazy" className="w-full h-full object-contain p-1.5" />
                    ) : (
                      <span className="text-2xl text-gray-200">📦</span>
                    )}
                  </div>
                </Link>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <p className="font-semibold text-gray-900 text-sm leading-snug truncate">{item.description}</p>
                  {item.product?.brand && <p className="text-xs text-gray-400">{item.product.brand}</p>}
                  <p className="text-sm font-bold text-green-700 mt-0.5">
                    MYR {Number(item.unitPrice).toFixed(2)}
                    {item.product?.unit && <span className="text-gray-400 font-normal text-xs"> / {item.product.unit}</span>}
                  </p>
                </div>

                {/* Right side: qty + line total + remove */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {/* Line total */}
                  <p className="font-bold text-sm text-gray-900">MYR {Number(item.lineTotal).toFixed(2)}</p>

                  {/* Qty stepper */}
                  <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => updateQty(item.id, Math.max(1, qty - 1))}
                      disabled={qty <= 1}
                      className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors text-base"
                    >
                      −
                    </button>
                    <span className="w-9 text-center text-sm font-semibold tabular-nums">{qty}</span>
                    <button
                      onClick={() => updateQty(item.id, qty + 1)}
                      className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors text-base"
                    >
                      +
                    </button>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Order summary — sticky on desktop ──────────── */}
        <div className="w-full md:w-72 shrink-0 md:sticky md:top-20">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 text-base">Order Summary</h2>

            {/* Line items summary */}
            <div className="space-y-2 text-sm">
              {items.map(item => (
                <div key={item.id} className="flex justify-between gap-2">
                  <span className="text-gray-500 truncate">{item.description} × {item.qty}</span>
                  <span className="text-gray-700 font-medium shrink-0">MYR {Number(item.lineTotal).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-4 flex justify-between items-baseline">
              <span className="text-gray-700 font-semibold">Total</span>
              <span className="text-2xl font-extrabold text-gray-900 tracking-tight">
                MYR {total.toFixed(2)}
              </span>
            </div>

            <p className="text-xs text-gray-400 -mt-2 leading-relaxed">
              Final pricing will be confirmed by your Flexxo sales representative before the order is processed.
            </p>

            {/* PO Number + Cost Centre — optional procurement fields */}
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  PO Number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={e => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-2026-001"
                  maxLength={100}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-green-500 focus:ring-2 focus:ring-green-100 outline-none transition placeholder-gray-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Cost Centre / Department <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={costCentre}
                  onChange={e => setCostCentre(e.target.value)}
                  placeholder="e.g. Marketing, IT, Finance"
                  maxLength={100}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-green-500 focus:ring-2 focus:ring-green-100 outline-none transition placeholder-gray-400"
                />
              </div>
            </div>

            <button
              onClick={checkout}
              disabled={checking}
              className="w-full py-3.5 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors active:scale-[0.98] shadow-sm"
            >
              {checking ? (
                <span className="flex items-center justify-center gap-2">
                  <FlexxoSpinner size="md" color="white" />
                  Submitting…
                </span>
              ) : (
                'Submit Quote Request →'
              )}
            </button>

            <div className="flex items-center gap-2 text-xs text-gray-400 justify-center">
              <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              Your request is reviewed by Flexxo sales
            </div>

            {/* Condition 13: TrustBadge on cart/checkout */}
            <div className="pt-2 border-t border-gray-100">
              <TrustBadge compact />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
