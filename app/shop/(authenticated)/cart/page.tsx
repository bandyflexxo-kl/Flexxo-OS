'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
  const [cart,     setCart]     = useState<CartData | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
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
      const res  = await fetch('/api/portal/cart/checkout', { method: 'POST' })
      const data = await res.json() as { quotationId?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Checkout failed'); return }
      router.push(`/shop/quotations/${data.quotationId}`)
    } finally {
      setChecking(false)
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400 animate-pulse">Loading cart…</div>

  const items = cart?.items ?? []

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Your Cart</h1>
        <Link href="/shop/products" className="text-sm text-blue-600 hover:underline">
          ← Continue shopping
        </Link>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center space-y-3">
          <div className="text-5xl">🛒</div>
          <p className="text-gray-500 text-sm">Your cart is empty.</p>
          <Link href="/shop/products" className="inline-block text-sm text-blue-600 hover:underline">
            Browse our products
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {items.map(item => {
              const isBusy = busy.has(item.id)
              const qty    = parseInt(item.qty, 10)
              return (
                <div key={item.id} className={`flex items-center gap-4 p-4 transition-opacity ${isBusy ? 'opacity-50' : ''}`}>
                  {/* Photo thumbnail */}
                  <div className="w-16 h-16 bg-gray-50 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-gray-100">
                    {item.product?.googleDrivePhotoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/portal/photo/${item.product.id}`} alt={item.description} className="w-full h-full object-contain p-1" />
                    ) : (
                      <span className="text-2xl">📦</span>
                    )}
                  </div>

                  {/* Name + price */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm leading-snug truncate">{item.description}</p>
                    {item.product?.brand && <p className="text-xs text-gray-400">{item.product.brand}</p>}
                    <p className="text-sm text-blue-700 font-semibold mt-0.5">
                      MYR {Number(item.unitPrice).toFixed(2)}
                      {item.product?.unit && <span className="text-gray-400 font-normal"> / {item.product.unit}</span>}
                    </p>
                  </div>

                  {/* Qty controls */}
                  <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden shrink-0">
                    <button onClick={() => updateQty(item.id, Math.max(1, qty - 1))} disabled={isBusy || qty <= 1}
                      className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors">−</button>
                    <span className="w-10 text-center text-sm font-medium">{qty}</span>
                    <button onClick={() => updateQty(item.id, qty + 1)} disabled={isBusy}
                      className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors">+</button>
                  </div>

                  {/* Line total */}
                  <div className="text-right w-24 shrink-0">
                    <p className="font-semibold text-sm text-gray-900">MYR {Number(item.lineTotal).toFixed(2)}</p>
                  </div>

                  {/* Remove */}
                  <button onClick={() => removeItem(item.id)} disabled={isBusy}
                    className="text-gray-300 hover:text-red-400 disabled:opacity-30 transition-colors text-xl ml-1 shrink-0" title="Remove">×</button>
                </div>
              )
            })}
          </div>

          {/* Summary + checkout */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              <span className="font-bold text-gray-900 text-xl">MYR {Number(cart?.totalAmount ?? 0).toFixed(2)}</span>
            </div>
            <p className="text-xs text-gray-400">
              Final pricing will be confirmed by your Flexxo sales representative before the order is processed.
            </p>
            <button
              onClick={checkout}
              disabled={checking}
              className="w-full py-3.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {checking ? 'Submitting…' : 'Submit Quote Request →'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
