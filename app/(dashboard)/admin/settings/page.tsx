'use client'

import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'

type GoogleStatus = {
  hasClientId:   boolean
  isConnected:   boolean
  connectedName: string | null
  folderId:      string
}

export default function AdminSettingsPage() {
  const [margin,        setMargin]        = useState('')
  const [retailMargin,  setRetailMargin]  = useState('')
  const [b2bMargin,     setB2bMargin]     = useState('')
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [savingShop,    setSavingShop]    = useState(false)
  const [success,       setSuccess]       = useState('')
  const [error,         setError]         = useState<string | null>(null)

  const [gStatus,       setGStatus]       = useState<GoogleStatus | null>(null)
  const [folderId,      setFolderId]      = useState('')
  const [savingFolder,  setSavingFolder]  = useState(false)
  const [folderSaved,   setFolderSaved]   = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/settings').then(r => r.json() as Promise<Record<string, string>>),
      fetch('/api/admin/settings/google-status').then(r => r.json() as Promise<GoogleStatus>),
    ]).then(([settings, gs]) => {
      setMargin(settings['default_margin_pct']  ?? '30')
      setRetailMargin(settings['retail_margin_pct'] ?? '30')
      setB2bMargin(settings['b2b_margin_pct']       ?? '20')
      setGStatus(gs)
      setFolderId(gs.folderId)
    }).finally(() => setLoading(false))
  }, [])

  // ── Save margin ──────────────────────────────────────────────────────────
  async function saveMargin(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess('')
    try {
      const res = await fetch('/api/admin/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ default_margin_pct: margin }),
      })
      if (!res.ok) { setError('Failed to save.'); return }
      setSuccess('margin')
      setTimeout(() => setSuccess(''), 3000)
    } finally {
      setSaving(false)
    }
  }

  // ── Save shop pricing ────────────────────────────────────────────────────
  async function saveShopPricing(e: React.FormEvent) {
    e.preventDefault()
    setSavingShop(true)
    setError(null)
    setSuccess('')
    try {
      const res = await fetch('/api/admin/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ retail_margin_pct: retailMargin, b2b_margin_pct: b2bMargin }),
      })
      if (!res.ok) { setError('Failed to save shop pricing.'); return }
      setSuccess('shop')
      setTimeout(() => setSuccess(''), 3000)
    } finally {
      setSavingShop(false)
    }
  }

  // ── Save folder ID ───────────────────────────────────────────────────────
  async function saveFolderId(e: React.FormEvent) {
    e.preventDefault()
    setSavingFolder(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ google_drive_photos_folder_id: folderId.trim() }),
      })
      if (!res.ok) { setError('Failed to save folder ID.'); return }
      setFolderSaved(true)
      setTimeout(() => setFolderSaved(false), 3000)
      setGStatus(prev => prev ? { ...prev, folderId: folderId.trim() } : prev)
    } finally {
      setSavingFolder(false)
    }
  }

  // ── Disconnect Google ────────────────────────────────────────────────────
  async function disconnectGoogle() {
    if (!confirm('Disconnect your Google account? Photo features will stop working.')) return
    setDisconnecting(true)
    try {
      await fetch('/api/admin/settings/google-status', { method: 'DELETE' })
      setGStatus(prev => prev ? { ...prev, isConnected: false } : prev)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div>
      <Topbar
        title="System Settings"
        actions={<Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Admin</Link>}
      />
      <div className="p-8 max-w-2xl space-y-6">
        {loading ? (
          <div className="text-sm text-gray-400 animate-pulse">Loading settings…</div>
        ) : (
          <>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {/* ── Pricing ── */}
            <form onSubmit={saveMargin} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <h2 className="text-sm font-semibold text-gray-800">Pricing Defaults</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Selling Margin %</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={margin}
                    onChange={e => setMargin(e.target.value)}
                    min="0" max="200" step="0.5"
                    className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Selling price = Cost × (1 + margin ÷ 100). Overridable per category or product.
                </p>
              </div>
              {success === 'margin' && <p className="text-sm text-green-600">✓ Saved.</p>}
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </form>

            {/* ── Shop Pricing ── */}
            <form onSubmit={saveShopPricing} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Shop Pricing</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Prices at <strong>shop.flexxo.com.my</strong>. Changes take effect immediately for all products — no per-product update needed.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Retail Margin % <span className="text-xs text-gray-400 font-normal">(guests / public)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" value={retailMargin} onChange={e => setRetailMargin(e.target.value)}
                      min="0" max="200" step="0.5"
                      className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Global only — overrides not allowed. One rate for all products.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    B2B Margin % <span className="text-xs text-gray-400 font-normal">(logged-in customers)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" value={b2bMargin} onChange={e => setB2bMargin(e.target.value)}
                      min="0" max="200" step="0.5"
                      className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Base rate — overridable per product or category.</p>
                </div>
              </div>

              {success === 'shop' && <p className="text-sm text-green-600">✓ Shop pricing saved. All product prices updated immediately.</p>}
              <button type="submit" disabled={savingShop}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingShop ? 'Saving…' : 'Save Shop Pricing'}
              </button>
            </form>

            {/* ── Google Drive ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <h2 className="text-sm font-semibold text-gray-800">Google Drive — Product Photos</h2>

              {/* Step 1: OAuth credentials */}
              <div className={`rounded-lg px-4 py-3 text-sm ${gStatus?.hasClientId ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
                {gStatus?.hasClientId ? (
                  <span>✓ Google OAuth credentials configured</span>
                ) : (
                  <div className="space-y-2">
                    <p className="font-medium">⚠ Google OAuth credentials not set</p>
                    <p className="text-xs">Add these to <code className="bg-amber-100 px-1 rounded">.env.local</code> then restart the dev server:</p>
                    <pre className="text-xs bg-amber-100 rounded p-2 font-mono mt-1">
{`GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-secret"`}
                    </pre>
                    <p className="text-xs">
                      Get these from{' '}
                      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline font-medium">
                        Google Cloud Console → APIs & Services → Credentials
                      </a>
                      {' '}→ Create OAuth 2.0 Client ID (Web application).
                      <br />
                      Authorized redirect URI: <code className="bg-amber-100 px-1 rounded">http://localhost:3000/api/auth/google/callback</code>
                    </p>
                  </div>
                )}
              </div>

              {/* Step 2: Connect account */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Step 2 — Connect Google Account</label>
                {gStatus?.isConnected ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-green-700 font-medium">✓ Connected ({gStatus.connectedName})</span>
                    <button
                      onClick={disconnectGoogle}
                      disabled={disconnecting}
                      className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      {disconnecting ? '…' : 'Disconnect'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <a
                      href={gStatus?.hasClientId ? '/api/auth/google?returnUrl=/admin/settings' : '#'}
                      className={`inline-block px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        gStatus?.hasClientId
                          ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed pointer-events-none'
                      }`}
                    >
                      <span className="mr-2">🔗</span>Connect Google Account
                    </a>
                    {!gStatus?.hasClientId && (
                      <p className="text-xs text-gray-400">Set OAuth credentials first (Step 1 above).</p>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  The connected account&apos;s Google Drive is used to serve product photos to customers.
                  Only one admin account needs to be connected.
                </p>
              </div>

              {/* Step 3: Folder ID */}
              <form onSubmit={saveFolderId} className="space-y-3">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Step 3 — Product Photos Folder ID</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={folderId}
                    onChange={e => setFolderId(e.target.value)}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={savingFolder}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {savingFolder ? 'Saving…' : 'Save Folder ID'}
                  </button>
                </div>
                {folderSaved && <p className="text-sm text-green-600">✓ Folder ID saved.</p>}
                <p className="text-xs text-gray-400">
                  Open your Google Drive folder → copy the ID from the URL:
                  <br />
                  <code className="bg-gray-100 px-1 rounded text-gray-500">
                    drive.google.com/drive/folders/<strong>THIS_PART_IS_THE_ID</strong>
                  </code>
                  <br className="mt-1" />
                  Photo filenames in this folder must match QNE item codes (e.g. <code className="bg-gray-100 px-1 rounded">ABP64772.jpg</code>).
                </p>
              </form>

              {/* Step 4: Scan */}
              {gStatus?.isConnected && gStatus?.folderId && (
                <div className="pt-2 border-t border-gray-100">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Step 4 — Scan &amp; Match Photos</label>
                  <p className="text-xs text-gray-400 mb-3">
                    Once connected and folder ID is set, go to{' '}
                    <a href="/admin/products" className="text-blue-600 hover:underline">/admin/products</a>
                    {' '}and click <strong>Scan All Photos</strong> to match Drive files to products automatically.
                  </p>
                  <a
                    href="/admin/products"
                    className="inline-block px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Go to Product Catalog →
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
