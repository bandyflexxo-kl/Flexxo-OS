'use client'

import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'

type ScannedFile = {
  fileId:       string
  fileName:     string
  mimeType:     string
  fileCategory: 'pdf' | 'image' | 'xlsx' | 'unsupported'
  sizeBytes:    number | null
  modifiedTime: string | null
  folderHint:   string | null
  status:       'new' | 'processed' | 'failed' | 'processing'
  processedFileId?: string
  supplierId:   string | null
  supplierName: string | null
}

type Supplier = { id: string; name: string }

type ExtractResult = {
  fileId:         string
  extracted:      number
  stagingCount:   number
  matchedCount?:  number
  possibleCount?: number
  isMaybeCatalogue?: boolean
  error?:         string
  duplicate?:     boolean
  existingFileName?: string
}

const STATUS_BADGE: Record<string, string> = {
  new:        'bg-blue-100 text-blue-700',
  processed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
  processing: 'bg-amber-100 text-amber-700',
}

const CAT_ICON: Record<string, string> = {
  pdf:  '📄',
  image: '🖼️',
  xlsx: '📊',
  unsupported: '📎',
}

function fmt(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes >= 1024 * 1024) return ` ${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024)         return ` ${(bytes / 1024).toFixed(0)} KB`
  return ` ${bytes} B`
}

export default function PriceScannerPage() {
  const [files,         setFiles]         = useState<ScannedFile[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [extractingId,  setExtractingId]  = useState<string | null>(null)
  const [results,       setResults]       = useState<Map<string, ExtractResult>>(new Map())
  const [suppliers,     setSuppliers]     = useState<Supplier[]>([])
  const [assignedTo,    setAssignedTo]    = useState<Map<string, string>>(new Map())   // fileId → supplierId
  const [newFilesAlert, setNewFilesAlert] = useState<string[]>([])
  const [driveStatus,   setDriveStatus]   = useState<{ expireAt?: number } | null>(null)
  const [watchLoading,  setWatchLoading]  = useState(false)
  const [filter,        setFilter]        = useState<'all' | 'new' | 'processed'>('all')

  useEffect(() => {
    loadScan()
    loadDriveStatus()
    loadSuppliers()
  }, [])

  async function loadScan() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/admin/price-scan')
      const data = await res.json() as { files?: ScannedFile[]; error?: string; newFilesAlert?: string[] }
      if (!res.ok) { setError(data.error ?? 'Scan failed'); return }
      setFiles(data.files ?? [])
      setNewFilesAlert(data.newFilesAlert ?? [])
      // Pre-fill supplier assignments from scan
      const map = new Map<string, string>()
      for (const f of data.files ?? []) {
        if (f.supplierId) map.set(f.fileId, f.supplierId)
      }
      setAssignedTo(map)
    } finally {
      setLoading(false)
    }
  }

  async function loadDriveStatus() {
    const res  = await fetch('/api/admin/drive/register-watch')
    const data = await res.json() as { state?: { expireAt?: number } | null }
    setDriveStatus(data.state ?? null)
  }

  async function loadSuppliers() {
    const res  = await fetch('/api/suppliers')
    const data = await res.json() as { suppliers?: Supplier[] }
    setSuppliers(data.suppliers ?? [])
  }

  async function enableDriveWatch() {
    setWatchLoading(true)
    try {
      const res  = await fetch('/api/admin/drive/register-watch', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string; expireAt?: number }
      if (!res.ok) { alert(data.error ?? 'Failed to enable'); return }
      setDriveStatus({ expireAt: data.expireAt })
    } finally {
      setWatchLoading(false)
    }
  }

  async function extractFile(file: ScannedFile) {
    const sid = assignedTo.get(file.fileId) ?? file.supplierId
    if (!sid) {
      alert('Select a supplier for this file first.')
      return
    }

    setExtractingId(file.fileId)
    try {
      const res = await fetch(`/api/suppliers/${sid}/extract-from-drive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          fileId:        file.fileId,
          fileName:      file.fileName,
          mimeType:      file.mimeType,
          fileSizeBytes: file.sizeBytes,
        }),
      })
      const data = await res.json() as ExtractResult
      setResults(prev => new Map(prev).set(file.fileId, data))

      if (res.status !== 409) {
        // Update file status locally
        setFiles(prev => prev.map(f =>
          f.fileId === file.fileId
            ? { ...f, status: res.ok ? 'processed' : 'failed', supplierId: sid }
            : f,
        ))
      }
    } finally {
      setExtractingId(null)
    }
  }

  async function extractAllNew() {
    const newFiles = filtered.filter(f => f.status === 'new' || f.status === 'failed')
    for (const file of newFiles) {
      await extractFile(file)
    }
  }

  const filtered = files.filter(f => {
    if (filter === 'new')       return f.status === 'new' || f.status === 'failed'
    if (filter === 'processed') return f.status === 'processed'
    return true
  })

  const newCount   = files.filter(f => f.status === 'new' || f.status === 'failed').length
  const doneCount  = files.filter(f => f.status === 'processed').length

  return (
    <div>
      <Topbar title="Price List Scanner" />
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl space-y-6">

        {/* Drive Auto-Detect status */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Google Drive Auto-Detect</p>
              {driveStatus?.expireAt ? (
                <p className="text-xs text-green-600 mt-0.5">
                  Active — webhook expires {new Date(driveStatus.expireAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-0.5">
                  Not active — enable to get notified when suppliers upload new price lists to Drive
                </p>
              )}
            </div>
            {!driveStatus?.expireAt && (
              <button
                onClick={enableDriveWatch}
                disabled={watchLoading}
                className="shrink-0 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {watchLoading ? 'Enabling…' : 'Enable Auto-Detect'}
              </button>
            )}
          </div>
        </div>

        {/* New files alert */}
        {newFilesAlert.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-800">
              New price files detected in Google Drive
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {newFilesAlert.slice(0, 5).join(', ')}{newFilesAlert.length > 5 ? ` +${newFilesAlert.length - 5} more` : ''}
            </p>
          </div>
        )}

        {/* Header stats + controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(['all', 'new', 'processed'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 capitalize ${filter === f ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  {f === 'all' ? `All (${files.length})` : f === 'new' ? `New (${newCount})` : `Done (${doneCount})`}
                </button>
              ))}
            </div>
            <button
              onClick={loadScan}
              disabled={loading}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              {loading ? '⏳ Scanning…' : '↻ Refresh'}
            </button>
          </div>

          {newCount > 0 && (
            <button
              onClick={extractAllNew}
              disabled={!!extractingId}
              className="text-sm font-medium text-white bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {extractingId ? 'Extracting…' : `Extract All New (${newCount})`}
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        )}

        {/* File table */}
        {!loading && files.length === 0 && !error && (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400 text-sm">
            No price list files found in the Drive folder.
          </div>
        )}

        {filtered.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">File</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Supplier</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(file => {
                    const result  = results.get(file.fileId)
                    const isExtracting = extractingId === file.fileId
                    const sid     = assignedTo.get(file.fileId) ?? file.supplierId

                    return (
                      <tr key={file.fileId} className="hover:bg-gray-50">
                        {/* File name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{CAT_ICON[file.fileCategory]}</span>
                            <div>
                              <p className="font-medium text-gray-900 truncate max-w-xs">{file.fileName}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {file.folderHint && <span className="mr-2">📁 {file.folderHint}</span>}
                                {file.fileCategory.toUpperCase()}{fmt(file.sizeBytes)}
                                {file.modifiedTime && ` · ${new Date(file.modifiedTime).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Supplier assignment */}
                        <td className="px-4 py-3">
                          {file.status === 'processed' ? (
                            <span className="text-gray-700">{file.supplierName ?? '—'}</span>
                          ) : (
                            <select
                              value={sid ?? ''}
                              onChange={e => {
                                const map = new Map(assignedTo)
                                if (e.target.value) map.set(file.fileId, e.target.value)
                                else map.delete(file.fileId)
                                setAssignedTo(map)
                              }}
                              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 max-w-[180px]"
                            >
                              <option value="">— Select supplier —</option>
                              {suppliers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[file.status] ?? ''}`}>
                            {file.status}
                          </span>
                          {result && !result.error && !result.duplicate && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {result.extracted} rows · {result.matchedCount ?? 0} matched · {result.possibleCount ?? 0} possible
                              {result.isMaybeCatalogue && ' · ⚠️ may be catalogue'}
                            </p>
                          )}
                          {result?.duplicate && (
                            <p className="text-xs text-amber-600 mt-0.5">Duplicate of "{result.existingFileName}"</p>
                          )}
                          {result?.error && (
                            <p className="text-xs text-red-600 mt-0.5">{result.error}</p>
                          )}
                        </td>

                        {/* Action */}
                        <td className="px-4 py-3 text-right">
                          {file.status === 'processed' && file.processedFileId ? (
                            <Link
                              href={`/admin/suppliers/${file.supplierId ?? ''}/price-files/${file.processedFileId}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Review staging →
                            </Link>
                          ) : (
                            <button
                              onClick={() => extractFile(file)}
                              disabled={isExtracting || !!extractingId || !sid}
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                                !sid
                                  ? 'text-gray-300 bg-gray-100 cursor-not-allowed'
                                  : isExtracting
                                    ? 'text-blue-600 bg-blue-50 animate-pulse'
                                    : 'text-white bg-green-600 hover:bg-green-700 disabled:opacity-50'
                              }`}
                            >
                              {isExtracting ? 'Extracting…' : 'Extract'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Scanning folder: <code className="bg-gray-100 px-1 py-0.5 rounded">1K23_RJRHCZhB4Kq6ZI3slHSdgoCa87AF</code>
          {' · '}Supports PDF, JPEG, PNG, XLSX/CSV
          {' · '}Large PDFs (&gt;30 MB) use text extraction
        </p>
      </div>
    </div>
  )
}
