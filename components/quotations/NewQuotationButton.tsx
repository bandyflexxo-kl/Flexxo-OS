'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type Company = { id: string; name: string; status: string }

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  prospect: 'bg-blue-100 text-blue-700',
  inactive: 'bg-gray-100 text-gray-500',
  lead:     'bg-yellow-100 text-yellow-700',
}

export default function NewQuotationButton({ companyId }: { companyId?: string }) {
  const router = useRouter()
  const [open,     setOpen]     = useState(false)
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<Company[]>([])
  const [searching, setSearching] = useState(false)
  const [creating,  setCreating]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mode B — companyId already known: create immediately on click
  async function handleDirectCreate() {
    if (!companyId || creating) return
    setCreating(true)
    setError(null)
    try {
      await createQuotation(companyId)
    } catch {
      setError('Could not create quotation. Try again.')
      setCreating(false)
    }
  }

  // Mode A — open modal
  function openModal() {
    setOpen(true)
    setQuery('')
    setResults([])
    setError(null)
  }

  function closeModal() {
    setOpen(false)
    setQuery('')
    setResults([])
    setError(null)
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  // Autofocus when modal opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [open])

  // Debounced company search
  const search = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies?q=${encodeURIComponent(q)}&limit=8`)
        if (!res.ok) throw new Error()
        const data = await res.json() as { companies?: Company[]; data?: Company[] }
        setResults(data.companies ?? data.data ?? (Array.isArray(data) ? data : []))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 280)
  }, [])

  useEffect(() => { search(query) }, [query, search])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  async function createQuotation(cId: string) {
    const res = await fetch('/api/quotations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ companyId: cId }),
    })
    if (!res.ok) throw new Error('Failed')
    const { id } = await res.json() as { id: string }
    router.push(`/quotations/${id}`)
  }

  async function handleSelect(company: Company) {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      await createQuotation(company.id)
    } catch {
      setError('Could not create quotation. Try again.')
      setCreating(false)
    }
  }

  // ── Mode B: simple button ────────────────────────────────────────────────
  if (companyId) {
    return (
      <>
        <button
          onClick={handleDirectCreate}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {creating ? (
            <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <span className="text-base leading-none">+</span>
          )}
          New Quotation
        </button>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </>
    )
  }

  // ── Mode A: button + company-picker modal ────────────────────────────────
  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <span className="text-base leading-none">+</span>
        New Quotation
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-28 px-4"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">New Quotation — Select Company</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            {/* Search input */}
            <div className="px-5 py-3 border-b border-gray-100">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Type company name…"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
              />
            </div>

            {/* Results */}
            <div className="max-h-72 overflow-y-auto">
              {searching && (
                <p className="text-xs text-gray-400 text-center py-6">Searching…</p>
              )}
              {!searching && query.length >= 2 && results.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">No companies found.</p>
              )}
              {!searching && query.length < 2 && (
                <p className="text-xs text-gray-400 text-center py-6">Type at least 2 characters to search.</p>
              )}
              {results.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  disabled={creating}
                  className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 transition-colors disabled:opacity-50 border-b border-gray-50 last:border-0"
                >
                  <span className="text-sm text-gray-800 font-medium truncate pr-3">{c.name}</span>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {c.status}
                  </span>
                </button>
              ))}
            </div>

            {/* Footer */}
            {(creating || error) && (
              <div className="px-5 py-3 border-t border-gray-100">
                {creating && (
                  <p className="text-xs text-blue-600 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                    Creating quotation…
                  </p>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
