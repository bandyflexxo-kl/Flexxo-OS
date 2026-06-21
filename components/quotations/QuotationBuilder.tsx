'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SmartOrderModal from '@/components/SmartOrderModal'

// ── Types ──────────────────────────────────────────────────────────────────

type QuotationItem = {
  id:          string
  description: string
  brand:       string | null
  unit:        string | null
  qty:         string
  unitCost:    string | null
  unitPrice:   string
  marginPct:   string | null
  lineTotal:   string
  sortOrder:   number
  product:     { id: string; name: string; brand: string | null; unit: string | null; qneItemCode?: string | null } | null
}

type StatusHistory = {
  fromStatus: string | null
  toStatus:   string
  notes:      string | null
  changedAt:  string
  changedBy:  { name: string } | null
}

export type QuotationBuilderProps = {
  id:              string
  referenceNo:     string
  status:          string
  currency:        string
  subtotal:        string | null
  discountAmount:  string | null
  totalAmount:     string | null
  termsConditions: string | null
  internalNotes:   string | null
  expiresAt:       string | null
  createdAt:       string
  sentAt:          string | null
  company:         { id: string; name: string }
  contact:         { id: string; name: string } | null
  createdBy:       { name: string }
  approvedBy:      { name: string } | null
  items:           QuotationItem[]
  statusHistory:   StatusHistory[]
  userRole:        string
}

type ProductSuggestion = {
  id:                     string
  name:                   string
  brand:                  string | null
  unit:                   string | null
  qneItemCode:            string | null
  categoryName:           string
  costPrice:              string | null
  sellingPrice:           string | null
  currency:               string
  supplierPriceVersionId: string | null
}

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:          'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-blue-100 text-blue-700',
  sent:           'bg-purple-100 text-purple-700',
  accepted:       'bg-green-100 text-green-700',
  declined:       'bg-red-100 text-red-700',
  expired:        'bg-gray-100 text-gray-500',
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Component ──────────────────────────────────────────────────────────────

export default function QuotationBuilder({ initial }: { initial: QuotationBuilderProps }) {
  const router = useRouter()

  const [items,           setItems]           = useState<QuotationItem[]>(initial.items)
  const [totalAmount,     setTotalAmount]      = useState<string | null>(initial.totalAmount)
  const [discountAmount,  setDiscountAmount]   = useState<string | null>(initial.discountAmount)
  const [discountPct,     setDiscountPct]      = useState('')
  const [status,          setStatus]           = useState(initial.status)
  const [terms,           setTerms]            = useState(initial.termsConditions ?? '')
  const [notes,           setNotes]            = useState(initial.internalNotes   ?? '')
  const [expiresAt,       setExpiresAt]        = useState(
    initial.expiresAt ? initial.expiresAt.substring(0, 10) : '',
  )

  // Add item form state
  const [addMode,         setAddMode]          = useState<'product' | 'freetext' | 'smartpaste'>('product')
  const [searchQ,         setSearchQ]          = useState('')
  const [suggestions,     setSuggestions]      = useState<ProductSuggestion[]>([])
  const [searchLoading,   setSearchLoading]    = useState(false)
  const [selectedProduct, setSelectedProduct]  = useState<ProductSuggestion | null>(null)
  const [addQty,          setAddQty]           = useState('1')
  const [addPrice,        setAddPrice]         = useState('')
  const [addDesc,         setAddDesc]          = useState('')
  const [addBrand,        setAddBrand]         = useState('')
  const [addUnit,         setAddUnit]          = useState('')
  const [addError,        setAddError]         = useState<string | null>(null)
  const [addLoading,      setAddLoading]       = useState(false)

  // Inline edit state
  const [editingQty,      setEditingQty]       = useState<Record<string, string>>({})
  const [editingPrice,    setEditingPrice]     = useState<Record<string, string>>({})

  // Action state
  const [sending,         setSending]          = useState(false)
  const [sendError,       setSendError]        = useState<string | null>(null)
  const [savingMeta,      setSavingMeta]       = useState(false)
  const [submitting,      setSubmitting]       = useState(false)
  const [approving,       setApproving]        = useState(false)
  const [rejecting,       setRejecting]        = useState(false)
  const [rejectNotes,     setRejectNotes]      = useState('')
  const [showRejectForm,  setShowRejectForm]   = useState(false)
  const [actionError,     setActionError]      = useState<string | null>(null)

  const isPrivileged = initial.userRole === 'Admin' || initial.userRole === 'Manager'

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Product search ───────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (searchQ.length < 2) { setSuggestions([]); return }

    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res  = await fetch(`/api/products?q=${encodeURIComponent(searchQ)}`)
        const data = await res.json() as ProductSuggestion[]
        setSuggestions(data)
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }, [searchQ])

  function selectProduct(p: ProductSuggestion) {
    setSelectedProduct(p)
    setSearchQ(p.name)
    setSuggestions([])
    setAddDesc(p.name)
    setAddBrand(p.brand ?? '')
    setAddUnit(p.unit ?? '')
    setAddPrice(p.sellingPrice ?? '')
  }

  // ── Add item ─────────────────────────────────────────────────────────────

  async function addItem() {
    setAddError(null)
    setAddLoading(true)
    try {
      const body: Record<string, unknown> = {
        description: addMode === 'product' ? (selectedProduct?.name ?? addDesc) : addDesc,
        brand:       addBrand  || null,
        unit:        addUnit   || null,
        qty:         parseFloat(addQty),
      }
      if (addMode === 'product' && selectedProduct) {
        body.productId              = selectedProduct.id
        body.supplierPriceVersionId = selectedProduct.supplierPriceVersionId ?? undefined
        if (addPrice && addPrice !== selectedProduct.sellingPrice) {
          body.unitPrice = parseFloat(addPrice)
        }
      } else {
        body.unitPrice = parseFloat(addPrice)
      }

      const res  = await fetch(`/api/quotations/${initial.id}/items`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json() as QuotationItem & { error?: string }
      if (!res.ok) { setAddError(String(data.error ?? 'Failed to add item')); return }

      setItems(prev => [...prev, data])
      // Recalc total
      const newTotal = [...items, data].reduce((sum, i) => sum + Number(i.lineTotal), 0)
      setTotalAmount(newTotal.toFixed(4))

      // Reset form
      setSelectedProduct(null)
      setSearchQ('')
      setAddQty('1')
      setAddPrice('')
      setAddDesc('')
      setAddBrand('')
      setAddUnit('')
    } finally {
      setAddLoading(false)
    }
  }

  // ── Inline item edit ─────────────────────────────────────────────────────

  async function saveItemField(itemId: string, field: 'qty' | 'unitPrice', rawValue: string) {
    const val = parseFloat(rawValue)
    if (isNaN(val) || val <= 0) return

    const res = await fetch(`/api/quotations/${initial.id}/items/${itemId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ [field]: val }),
    })
    if (!res.ok) return

    // Refresh items from server
    const qt = await fetch(`/api/quotations/${initial.id}`)
    const data = await qt.json() as QuotationBuilderProps
    setItems(data.items)
    setTotalAmount(data.totalAmount)
  }

  async function deleteItem(itemId: string) {
    const res = await fetch(`/api/quotations/${initial.id}/items/${itemId}`, { method: 'DELETE' })
    if (!res.ok) return
    const newItems = items.filter(i => i.id !== itemId)
    setItems(newItems)
    const newTotal = newItems.reduce((sum, i) => sum + Number(i.lineTotal), 0)
    setTotalAmount(newTotal.toFixed(4))
  }

  // ── Save meta (terms / notes / expiry) ───────────────────────────────────

  const saveMeta = useCallback(async () => {
    setSavingMeta(true)
    try {
      await fetch(`/api/quotations/${initial.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          termsConditions: terms   || null,
          internalNotes:   notes   || null,
          expiresAt:       expiresAt || null,
        }),
      })
    } finally {
      setSavingMeta(false)
    }
  }, [initial.id, terms, notes, expiresAt])

  // ── Send quotation ────────────────────────────────────────────────────────

  async function sendQuotation() {
    setSendError(null)
    setSending(true)
    try {
      const res  = await fetch(`/api/quotations/${initial.id}/send`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; status?: string; error?: string }
      if (!res.ok) { setSendError(data.error ?? 'Failed'); return }
      setStatus('sent')
      router.refresh()
    } finally {
      setSending(false)
    }
  }

  // ── Submit for approval ───────────────────────────────────────────────────

  async function submitForApproval() {
    setActionError(null)
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/quotations/${initial.id}/submit`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; status?: string; error?: string }
      if (!res.ok) { setActionError(data.error ?? 'Failed'); return }
      setStatus('pending_review')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  // ── Approve / Reject ─────────────────────────────────────────────────────

  async function approveQuotation() {
    setActionError(null)
    setApproving(true)
    try {
      const res  = await fetch(`/api/quotations/${initial.id}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const data = await res.json() as { ok?: boolean; status?: string; error?: string }
      if (!res.ok) { setActionError(data.error ?? 'Failed'); return }
      setStatus('approved')
      router.refresh()
    } finally {
      setApproving(false)
    }
  }

  async function rejectQuotation() {
    if (!rejectNotes.trim()) { setActionError('Please provide a reason for rejection.'); return }
    setActionError(null)
    setRejecting(true)
    try {
      const res  = await fetch(`/api/quotations/${initial.id}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notes: rejectNotes }),
      })
      const data = await res.json() as { ok?: boolean; status?: string; error?: string }
      if (!res.ok) { setActionError(data.error ?? 'Failed'); return }
      setStatus('draft')
      setShowRejectForm(false)
      setRejectNotes('')
      router.refresh()
    } finally {
      setRejecting(false)
    }
  }

  // ── Save discount ─────────────────────────────────────────────────────────

  async function saveDiscount() {
    const pct = parseFloat(discountPct)
    if (isNaN(pct) || pct < 0 || pct > 100) return
    const res  = await fetch(`/api/quotations/${initial.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ discountPct: pct }),
    })
    if (!res.ok) return
    // Refresh to get updated totals
    const qt   = await fetch(`/api/quotations/${initial.id}`)
    const data = await qt.json() as QuotationBuilderProps
    setTotalAmount(data.totalAmount)
    setDiscountAmount(data.discountAmount)
  }

  const canEdit = ['draft', 'pending_review'].includes(status)
  const canSend = status === 'approved'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-16">

      {/* ── Header ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Quotation</p>
            <h1 className="text-2xl font-bold text-gray-900 font-mono mt-0.5">{initial.referenceNo}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {initial.company.name}
              {initial.contact && <span> · {initial.contact.name}</span>}
              <span className="mx-1">·</span>
              Created by {initial.createdBy.name}
              <span className="mx-1">·</span>
              {new Date(initial.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>

      {/* ── Items table ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Items</h2>
          <span className="text-xs text-gray-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        </div>
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400 text-sm">No items yet. Add products below.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium text-right w-20">Qty</th>
                <th className="px-4 py-2.5 font-medium text-right w-28">Unit Price</th>
                {canEdit && <th className="px-4 py-2.5 font-medium text-right w-20 text-gray-300">Cost</th>}
                <th className="px-4 py-2.5 font-medium text-right w-28">Total</th>
                {canEdit && <th className="px-2 py-2.5 w-10" />}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 leading-snug">{item.description}</p>
                    {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                    {item.product?.qneItemCode && <p className="text-xs text-gray-300 font-mono">{item.product.qneItemCode}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="w-16 text-right border border-gray-200 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        value={editingQty[item.id] ?? item.qty}
                        onChange={e => setEditingQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => {
                          const v = editingQty[item.id]
                          if (v !== undefined && v !== item.qty) saveItemField(item.id, 'qty', v)
                          setEditingQty(prev => { const n = { ...prev }; delete n[item.id]; return n })
                        }}
                      />
                    ) : (
                      <span className="text-gray-700">{Number(item.qty).toFixed(0)}</span>
                    )}
                    {item.unit && <span className="text-xs text-gray-400 ml-1">{item.unit}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="w-24 text-right border border-gray-200 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        value={editingPrice[item.id] ?? Number(item.unitPrice).toFixed(2)}
                        onChange={e => setEditingPrice(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => {
                          const v = editingPrice[item.id]
                          if (v !== undefined && v !== Number(item.unitPrice).toFixed(2)) saveItemField(item.id, 'unitPrice', v)
                          setEditingPrice(prev => { const n = { ...prev }; delete n[item.id]; return n })
                        }}
                      />
                    ) : (
                      <span className="text-gray-700">{initial.currency} {Number(item.unitPrice).toFixed(2)}</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right text-xs text-gray-300">
                      {item.unitCost ? `${initial.currency} ${Number(item.unitCost).toFixed(2)}` : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {initial.currency} {Number(item.lineTotal).toFixed(2)}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-3 text-center">
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                        title="Remove item"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              {discountAmount && Number(discountAmount) > 0 && (
                <tr className="border-t border-gray-100">
                  <td colSpan={canEdit ? 4 : 3} className="px-4 py-2 text-right text-sm text-gray-500">Subtotal</td>
                  <td className="px-4 py-2 text-right text-sm text-gray-700">
                    {initial.currency} {initial.subtotal ? Number(initial.subtotal).toFixed(2) : '0.00'}
                  </td>
                  {canEdit && <td />}
                </tr>
              )}
              {discountAmount && Number(discountAmount) > 0 && (
                <tr>
                  <td colSpan={canEdit ? 4 : 3} className="px-4 py-1 text-right text-sm text-green-700">
                    Discount {discountPct ? `(${discountPct}%)` : ''}
                  </td>
                  <td className="px-4 py-1 text-right text-sm text-green-700">
                    − {initial.currency} {Number(discountAmount).toFixed(2)}
                  </td>
                  {canEdit && <td />}
                </tr>
              )}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={canEdit ? 4 : 3} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Total</td>
                <td className="px-4 py-3 text-right text-lg font-bold text-gray-900">
                  {initial.currency} {totalAmount ? Number(totalAmount).toFixed(2) : '0.00'}
                </td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Add item panel ── */}
      {canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700">Add Item</h2>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => { setAddMode('product'); setSelectedProduct(null); setSearchQ(''); setAddDesc(''); setAddBrand(''); setAddUnit(''); setAddPrice('') }}
                className={`px-3 py-1.5 font-medium transition-colors ${addMode === 'product' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                From Product
              </button>
              <button
                onClick={() => { setAddMode('freetext'); setSelectedProduct(null); setSearchQ('') }}
                className={`px-3 py-1.5 font-medium transition-colors ${addMode === 'freetext' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                Free Text
              </button>
              <button
                onClick={() => { setAddMode('smartpaste'); setSelectedProduct(null); setSearchQ('') }}
                className={`px-3 py-1.5 font-medium transition-colors ${addMode === 'smartpaste' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                ✨ Smart Add
              </button>
            </div>
          </div>

          {addMode === 'product' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Product search */}
              <div className="lg:col-span-2 relative">
                <label className="block text-xs text-gray-500 mb-1">Product search</label>
                <input
                  type="text"
                  placeholder="Type product name, code…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSelectedProduct(null) }}
                />
                {(suggestions.length > 0 || searchLoading) && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                    {searchLoading && <div className="px-4 py-3 text-xs text-gray-400">Searching…</div>}
                    {suggestions.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectProduct(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-400">
                          {p.categoryName}{p.brand ? ` · ${p.brand}` : ''}{p.qneItemCode ? ` · ${p.qneItemCode}` : ''}
                          {p.sellingPrice ? <span className="ml-2 text-blue-600 font-medium">{p.currency} {Number(p.sellingPrice).toFixed(2)}</span> : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Qty */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Qty</label>
                <input
                  type="number" min="0.01" step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={addQty}
                  onChange={e => setAddQty(e.target.value)}
                />
              </div>
              {/* Unit price (optional override) */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Unit Price {selectedProduct?.sellingPrice && <span className="text-blue-500">(auto)</span>}
                </label>
                <input
                  type="number" min="0.01" step="0.01"
                  placeholder={selectedProduct?.sellingPrice ? Number(selectedProduct.sellingPrice).toFixed(2) : '0.00'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={addPrice}
                  onChange={e => setAddPrice(e.target.value)}
                />
              </div>
            </div>
          ) : addMode === 'freetext' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Description *</label>
                <input
                  type="text"
                  placeholder="e.g. A4 Paper 80gsm"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={addDesc}
                  onChange={e => setAddDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Brand</label>
                <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={addBrand} onChange={e => setAddBrand(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Unit</label>
                <input type="text" placeholder="e.g. pcs, ream" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={addUnit} onChange={e => setAddUnit(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Qty *</label>
                <input type="number" min="0.01" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={addQty} onChange={e => setAddQty(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Unit Price (MYR) *</label>
                <input type="number" min="0.01" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={addPrice} onChange={e => setAddPrice(e.target.value)} />
              </div>
            </div>
          ) : null}

          {addError && addMode !== 'smartpaste' && <p className="text-sm text-red-600">{addError}</p>}

          {addMode !== 'smartpaste' && (
            <button
              onClick={addItem}
              disabled={addLoading}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {addLoading ? 'Adding…' : '+ Add Item'}
            </button>
          )}

          {addMode === 'smartpaste' && (
            <SmartOrderModal
              quotationId={initial.id}
              companyId={initial.company.id}
              currency={initial.currency}
              onSuccess={(count) => {
                // Reload items from server after bulk add
                fetch(`/api/quotations/${initial.id}`)
                  .then(r => r.json() as Promise<QuotationBuilderProps>)
                  .then(data => {
                    setItems(data.items)
                    setTotalAmount(data.totalAmount)
                  })
                  .catch(() => undefined)
                setAddMode('product')
                router.refresh()
                // brief confirmation via the addError slot (reuse as success msg)
                setAddError(null)
              }}
              onCancel={() => setAddMode('product')}
            />
          )}
        </div>
      )}

      {/* ── Meta fields (terms / notes / expiry) ── */}
      {canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Details</h2>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Discount %</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" max="100" step="0.5"
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={discountPct}
                  onChange={e => setDiscountPct(e.target.value)}
                  onBlur={saveDiscount}
                />
                <span className="text-sm text-gray-400 flex-shrink-0">%</span>
              </div>
              {discountAmount && Number(discountAmount) > 0 && (
                <p className="text-xs text-green-600 mt-1">−{initial.currency} {Number(discountAmount).toFixed(2)}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expires At</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                onBlur={saveMeta}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Terms &amp; Conditions</label>
              <textarea
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                value={terms}
                onChange={e => setTerms(e.target.value)}
                onBlur={saveMeta}
                placeholder="Payment terms, delivery conditions…"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Internal Notes</label>
              <textarea
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={saveMeta}
                placeholder="Notes not visible to customer…"
              />
            </div>
          </div>
          {savingMeta && <p className="text-xs text-gray-400">Saving…</p>}
        </div>
      )}

      {/* ── Terms / notes (read-only) ── */}
      {!canEdit && (initial.termsConditions || initial.internalNotes) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {initial.termsConditions && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Terms &amp; Conditions</p>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{initial.termsConditions}</p>
            </div>
          )}
          {initial.internalNotes && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">Internal Notes</p>
              <p className="text-sm text-amber-800 whitespace-pre-wrap">{initial.internalNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Actions bar ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        {actionError && (
          <p className="text-sm text-red-600 font-medium">{actionError}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {/* Draft → Submit for Approval */}
          {status === 'draft' && (
            <button
              onClick={submitForApproval}
              disabled={submitting || items.length === 0}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting…' : '→ Submit for Approval'}
            </button>
          )}

          {/* Pending Review → Approve / Reject (Manager/Admin only) */}
          {status === 'pending_review' && isPrivileged && !showRejectForm && (
            <>
              <button
                onClick={approveQuotation}
                disabled={approving}
                className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {approving ? 'Approving…' : '✓ Approve'}
              </button>
              <button
                onClick={() => setShowRejectForm(true)}
                className="px-5 py-2.5 bg-white border border-red-300 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-50 transition-colors"
              >
                ✕ Reject
              </button>
            </>
          )}

          {/* Pending Review (salesperson view) */}
          {status === 'pending_review' && !isPrivileged && (
            <p className="text-sm text-yellow-700 font-medium">
              ⏳ Awaiting manager approval…
            </p>
          )}

          {/* Approved → Send to Customer */}
          {canSend && (
            <>
              <button
                onClick={sendQuotation}
                disabled={sending || items.length === 0}
                className="px-5 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {sending ? 'Sending…' : '✉ Send to Customer'}
              </button>
              {items.length === 0 && (
                <p className="text-xs text-gray-400">Add at least one item to send.</p>
              )}
            </>
          )}

          {sendError && <p className="text-sm text-red-600">{sendError}</p>}

          {status === 'approved' && initial.approvedBy && (
            <p className="text-sm text-green-700">
              ✓ Approved by {initial.approvedBy.name}
            </p>
          )}
          {status === 'sent' && (
            <p className="text-sm text-purple-700 font-medium">
              ✓ Sent {initial.sentAt ? `on ${new Date(initial.sentAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
            </p>
          )}
          {status === 'accepted' && (
            <p className="text-sm text-green-700 font-medium">✓ Customer accepted this quotation.</p>
          )}
          {status === 'declined' && (
            <p className="text-sm text-red-700 font-medium">✕ Customer declined this quotation.</p>
          )}
        </div>

        {/* Reject form (inline) */}
        {showRejectForm && (
          <div className="border border-red-200 rounded-xl p-4 bg-red-50 space-y-3">
            <p className="text-sm font-semibold text-red-800">Reason for rejection (required)</p>
            <textarea
              rows={2}
              className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400 bg-white resize-none"
              placeholder="e.g. Pricing too high, needs revision…"
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={rejectQuotation}
                disabled={rejecting || !rejectNotes.trim()}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {rejecting ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
              <button
                onClick={() => { setShowRejectForm(false); setRejectNotes(''); setActionError(null) }}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Status history ── */}
      {initial.statusHistory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">History</h2>
          <div className="space-y-3">
            {initial.statusHistory.map((h, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <div className="mt-1 w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                <div>
                  <span className="text-gray-500">{h.fromStatus ? `${statusLabel(h.fromStatus)} → ` : ''}</span>
                  <span className="font-medium text-gray-900">{statusLabel(h.toStatus)}</span>
                  {h.changedBy && <span className="ml-1.5 text-xs text-gray-400">by {h.changedBy.name}</span>}
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(h.changedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {h.notes && <p className="text-xs text-gray-500 mt-0.5">{h.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
