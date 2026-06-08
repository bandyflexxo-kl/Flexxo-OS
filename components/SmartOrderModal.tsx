'use client'

/**
 * SmartOrderModal — "✨ Smart Add" panel inside QuotationBuilder.
 *
 * Accepts a pasted text list OR an uploaded photo, matches items against
 * the product catalogue, lets the salesperson review/adjust, then bulk-adds
 * confirmed items to the quotation.
 *
 * Access: CRM only (rendered inside QuotationBuilder, never in B2B portal).
 */

import { useState, useRef, useCallback } from 'react'
import type { MatchedLine, ProductMatch } from '@/lib/smartOrder'

// ── Confidence UI helpers ─────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'none' }) {
  const map = {
    high:   { label: 'Auto-matched', cls: 'bg-green-100 text-green-700' },
    medium: { label: 'Review match', cls: 'bg-yellow-100 text-yellow-700' },
    none:   { label: 'Not found',    cls: 'bg-red-100 text-red-700' },
  }
  const { label, cls } = map[confidence]
  return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

// ── Row types ─────────────────────────────────────────────────────────────────

type RowState = {
  line:             MatchedLine
  included:         boolean
  selectedMatch:    ProductMatch | null   // null = free-text mode
  freeDesc:         string
  freePrice:        string
  qtyOverride:      string
}

function initRows(lines: MatchedLine[]): RowState[] {
  return lines.map(l => ({
    line:          l,
    included:      true,
    selectedMatch: l.topMatch,
    freeDesc:      l.topMatch ? '' : l.parsedName,
    freePrice:     '',
    qtyOverride:   String(l.qty),
  }))
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  quotationId: string
  currency:    string
  onSuccess:   (addedCount: number) => void
  onCancel:    () => void
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SmartOrderModal({ quotationId, currency, onSuccess, onCancel }: Props) {
  const [tab,           setTab]           = useState<'text' | 'photo'>('text')
  const [pasteText,     setPasteText]     = useState('')
  const [phase,         setPhase]         = useState<'input' | 'parsing' | 'results' | 'adding'>('input')
  const [rows,          setRows]          = useState<RowState[]>([])
  const [parseError,    setParseError]    = useState<string | null>(null)
  const [addError,      setAddError]      = useState<string | null>(null)
  const [imagePreview,  setImagePreview]  = useState<string | null>(null)
  const [imageBase64,   setImageBase64]   = useState<string | null>(null)
  const [imageMime,     setImageMime]     = useState<string>('image/jpeg')
  const [extractedText, setExtractedText] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Parse text ──────────────────────────────────────────────────────────────

  async function handleParseText() {
    if (!pasteText.trim()) return
    setParseError(null)
    setPhase('parsing')
    try {
      const res  = await fetch('/api/smart-order/parse-text', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: pasteText }),
      })
      const data = await res.json() as { lines?: MatchedLine[]; error?: string }
      if (!res.ok || !data.lines) {
        setParseError(data.error ?? 'Parsing failed')
        setPhase('input')
        return
      }
      setRows(initRows(data.lines))
      setPhase('results')
    } catch {
      setParseError('Network error — please try again')
      setPhase('input')
    }
  }

  // ── Scan photo ──────────────────────────────────────────────────────────────

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setImagePreview(dataUrl)
      // Strip data URL prefix to get pure base64
      const base64 = dataUrl.split(',')[1] ?? ''
      setImageBase64(base64)
      setImageMime(file.type || 'image/jpeg')
    }
    reader.readAsDataURL(file)
  }

  async function handleScanPhoto() {
    if (!imageBase64) return
    setParseError(null)
    setPhase('parsing')
    try {
      const res  = await fetch('/api/smart-order/scan-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64, mimeType: imageMime }),
      })
      const data = await res.json() as { lines?: MatchedLine[]; extractedText?: string; error?: string }
      if (!res.ok || !data.lines) {
        setParseError(data.error ?? 'Scan failed')
        setPhase('input')
        return
      }
      setExtractedText(data.extractedText ?? null)
      setRows(initRows(data.lines))
      setPhase('results')
    } catch {
      setParseError('Network error — please try again')
      setPhase('input')
    }
  }

  // ── Row edit helpers ────────────────────────────────────────────────────────

  const updateRow = useCallback((idx: number, patch: Partial<RowState>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }, [])

  // ── Bulk add ────────────────────────────────────────────────────────────────

  async function handleAddAll() {
    setAddError(null)
    setPhase('adding')

    const toAdd = rows.filter(r => r.included)
    let addedCount = 0

    for (const row of toAdd) {
      const qty = parseFloat(row.qtyOverride) || row.line.qty

      if (row.selectedMatch) {
        // Matched product
        const body: Record<string, unknown> = {
          productId:              row.selectedMatch.id,
          supplierPriceVersionId: row.selectedMatch.supplierPriceVersionId ?? undefined,
          description:            row.selectedMatch.name,
          brand:                  row.selectedMatch.brand ?? null,
          unit:                   row.selectedMatch.unit  ?? row.line.unit ?? null,
          qty,
        }
        const res = await fetch(`/api/quotations/${quotationId}/items`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        })
        if (res.ok) addedCount++
      } else {
        // Free-text fallback
        const desc  = row.freeDesc.trim()
        const price = parseFloat(row.freePrice)
        if (!desc || isNaN(price) || price <= 0) continue  // skip incomplete rows
        const body = {
          description: desc,
          brand:       null,
          unit:        row.line.unit ?? null,
          qty,
          unitPrice:   price,
        }
        const res = await fetch(`/api/quotations/${quotationId}/items`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        })
        if (res.ok) addedCount++
      }
    }

    if (addedCount === 0) {
      setAddError('No items were added. Check that matched items or free-text prices are filled in.')
      setPhase('results')
      return
    }

    onSuccess(addedCount)
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const includedRows = rows.filter(r => r.included)
  const highCount    = includedRows.filter(r => r.line.confidence === 'high').length
  const mediumCount  = includedRows.filter(r => r.line.confidence === 'medium').length
  const noneCount    = includedRows.filter(r => r.line.confidence === 'none').length

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Input phase ── */}
      {phase === 'input' && (
        <>
          {/* Tab switcher */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs w-fit">
            <button
              onClick={() => { setTab('text'); setParseError(null) }}
              className={`px-4 py-1.5 font-medium transition-colors ${tab === 'text' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              📋 Paste List
            </button>
            <button
              onClick={() => { setTab('photo'); setParseError(null) }}
              className={`px-4 py-1.5 font-medium transition-colors ${tab === 'photo' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              📷 Upload Photo
            </button>
          </div>

          {/* Text paste */}
          {tab === 'text' && (
            <div className="space-y-3">
              <textarea
                rows={8}
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={`Paste the customer's item list here — one item per line.\n\nExamples:\n  Faber Castel Gel Pen Blue x 2 box\n  Artline 90 Marker Black x 3 pcs\n  A4 Paper 80gsm 1 ream\n  Calculator x 1`}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
              />
              {parseError && <p className="text-sm text-red-600">{parseError}</p>}
              <button
                onClick={handleParseText}
                disabled={!pasteText.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Match Items →
              </button>
            </div>
          )}

          {/* Photo upload */}
          {tab === 'photo' && (
            <div className="space-y-3">
              {imagePreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Preview" className="max-h-64 rounded-lg border border-gray-200 object-contain" />
                  <button
                    onClick={() => { setImagePreview(null); setImageBase64(null); if (fileRef.current) fileRef.current.value = '' }}
                    className="absolute top-2 right-2 bg-white border border-gray-200 rounded-full w-7 h-7 flex items-center justify-center text-gray-500 hover:text-red-500 text-sm shadow"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <p className="text-3xl mb-2">📷</p>
                  <p className="text-sm font-medium text-gray-700">Click to upload a photo of the item list</p>
                  <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP — max 10 MB</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
              {parseError && <p className="text-sm text-red-600">{parseError}</p>}
              {imageBase64 && (
                <button
                  onClick={handleScanPhoto}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Scan &amp; Match Items →
                </button>
              )}
              <p className="text-xs text-gray-400">
                Uses AI to read the photo. Works on handwritten lists, printed orders, and WhatsApp screenshots.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Parsing phase ── */}
      {phase === 'parsing' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">
            {tab === 'photo' ? 'Reading photo and matching items…' : 'Matching items to catalogue…'}
          </p>
        </div>
      )}

      {/* ── Results phase ── */}
      {phase === 'results' && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-4 text-xs">
            <span className="font-semibold text-gray-700">{rows.length} items found</span>
            {highCount   > 0 && <span className="text-green-600">✅ {highCount} auto-matched</span>}
            {mediumCount > 0 && <span className="text-yellow-600">⚠ {mediumCount} need review</span>}
            {noneCount   > 0 && <span className="text-red-600">❌ {noneCount} not found</span>}
            <button onClick={() => { setPhase('input'); setRows([]) }} className="ml-auto text-gray-400 hover:text-gray-600 underline">
              ← Back
            </button>
          </div>

          {extractedText && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-600">View extracted text</summary>
              <pre className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 text-gray-600 whitespace-pre-wrap font-mono text-[11px]">{extractedText}</pre>
            </details>
          )}

          {/* Items table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="w-8 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={rows.every(r => r.included)}
                      onChange={e => setRows(prev => prev.map(r => ({ ...r, included: e.target.checked })))}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Item from list</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Matched product</th>
                  <th className="w-24 px-3 py-2 text-left text-xs font-semibold text-gray-600">Qty</th>
                  <th className="w-28 px-3 py-2 text-left text-xs font-semibold text-gray-600">Unit Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, idx) => (
                  <ResultRow
                    key={idx}
                    row={row}
                    currency={currency}
                    onChange={patch => updateRow(idx, patch)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {addError && <p className="text-sm text-red-600">{addError}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={handleAddAll}
              disabled={includedRows.length === 0}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              ✚ Add {includedRows.length} item{includedRows.length !== 1 ? 's' : ''} to Quote
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Adding phase ── */}
      {phase === 'adding' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Adding items to quotation…</p>
        </div>
      )}
    </div>
  )
}

// ── Result row sub-component ──────────────────────────────────────────────────

function ResultRow({
  row,
  currency,
  onChange,
}: {
  row:      RowState
  currency: string
  onChange: (patch: Partial<RowState>) => void
}) {
  const { line, included, selectedMatch, freeDesc, freePrice, qtyOverride } = row

  return (
    <tr className={`transition-colors ${!included ? 'opacity-40 bg-gray-50' : ''}`}>
      {/* Include checkbox */}
      <td className="px-3 py-2.5">
        <input
          type="checkbox"
          checked={included}
          onChange={e => onChange({ included: e.target.checked })}
          className="rounded"
        />
      </td>

      {/* Original text + confidence */}
      <td className="px-3 py-2.5">
        <p className="text-xs text-gray-500 truncate max-w-[180px]" title={line.rawText}>{line.rawText}</p>
        <ConfidenceBadge confidence={line.confidence} />
      </td>

      {/* Matched product selector / free-text */}
      <td className="px-3 py-2.5">
        {line.confidence !== 'none' && line.alternatives.length > 0 ? (
          <div className="space-y-1">
            <select
              value={selectedMatch?.id ?? ''}
              onChange={e => {
                const match = line.alternatives.find(a => a.id === e.target.value) ?? null
                onChange({ selectedMatch: match, freeDesc: match ? '' : line.parsedName })
              }}
              className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {line.alternatives.map(alt => (
                <option key={alt.id} value={alt.id}>
                  {alt.name}{alt.brand ? ` (${alt.brand})` : ''} — {alt.sellingPrice ? `${currency} ${Number(alt.sellingPrice).toFixed(2)}` : 'No price'}
                </option>
              ))}
              <option value="">✎ Enter manually</option>
            </select>
            {!selectedMatch && (
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="Description"
                  value={freeDesc}
                  onChange={e => onChange({ freeDesc: e.target.value })}
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
                />
              </div>
            )}
          </div>
        ) : (
          // No match — free-text entry
          <input
            type="text"
            placeholder="Description (required)"
            value={freeDesc}
            onChange={e => onChange({ freeDesc: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        )}
      </td>

      {/* Qty override */}
      <td className="px-3 py-2.5">
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={qtyOverride}
          onChange={e => onChange({ qtyOverride: e.target.value })}
          className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {line.unit && <p className="text-[10px] text-gray-400 mt-0.5">{line.unit}</p>}
      </td>

      {/* Unit price — auto-filled from matched product, editable for free-text */}
      <td className="px-3 py-2.5">
        {selectedMatch ? (
          selectedMatch.sellingPrice ? (
            <p className="text-xs font-medium text-gray-800">
              {currency} {Number(selectedMatch.sellingPrice).toFixed(2)}
              <span className="text-[10px] text-gray-400 block">auto</span>
            </p>
          ) : (
            <p className="text-xs text-gray-400 italic">No price</p>
          )
        ) : (
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={freePrice}
            onChange={e => onChange({ freePrice: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        )}
      </td>
    </tr>
  )
}
