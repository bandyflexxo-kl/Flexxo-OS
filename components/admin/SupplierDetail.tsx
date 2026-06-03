'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import DriveBrowser from './DriveBrowser'

type PriceFile = {
  id:            string
  fileName:      string
  fileType:      string
  importStatus:  string
  rowsExtracted: number | null
  rowsFailed:    number | null
  stagingCount:  number
  uploadedAt:    string
  processedAt:   string | null
  uploadedBy:    { name: string }
}

type Supplier = {
  id:          string
  name:        string
  paymentTerm: string | null
  currency:    string
  isActive:    boolean
  priceFiles:  PriceFile[]
}

export default function SupplierDetail({
  supplier:          initial,
  isGoogleConnected,
  rootFolderId,
  currentUrl,
}: {
  supplier:          Supplier
  isGoogleConnected: boolean
  rootFolderId:      string
  currentUrl:        string
}) {
  const [supplier,      setSupplier]      = useState(initial)
  const [uploading,     setUploading]     = useState(false)
  const [uploadResult,  setUploadResult]  = useState<{ extracted: number; fileId: string } | null>(null)
  const [showBrowser,   setShowBrowser]   = useState(false)
  const [driveResult,   setDriveResult]   = useState<{ fileName: string; extracted: number; fileId: string } | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [googleMsg,     setGoogleMsg]     = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Show feedback from Google OAuth redirect
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('google') === 'connected') {
      setGoogleMsg('Google Drive connected successfully!')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('google') === 'denied') {
      setGoogleMsg('Google Drive connection was cancelled.')
    } else if (params.get('google') === 'error') {
      setGoogleMsg(`Google connection failed: ${params.get('msg') ?? 'unknown error'}`)
    }
  }, [])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    setUploadResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res  = await fetch(`/api/suppliers/${supplier.id}/price-files`, { method: 'POST', body: formData })
      const data = await res.json() as { fileId?: string; extracted?: number; failed?: number; stagingCount?: number; error?: string }
      if (!res.ok) { setError(data.error ?? 'Upload failed'); return }

      setUploadResult({ extracted: data.extracted ?? 0, fileId: data.fileId ?? '' })

      const newFile: PriceFile = {
        id:           data.fileId ?? '',
        fileName:     file.name,
        fileType:     file.name.split('.').pop()?.toLowerCase() ?? '',
        importStatus: 'completed',
        rowsExtracted: data.extracted ?? 0,
        rowsFailed:   data.failed ?? 0,
        stagingCount: data.stagingCount ?? 0,
        uploadedAt:   new Date().toISOString(),
        processedAt:  new Date().toISOString(),
        uploadedBy:   { name: 'You' },
      }
      setSupplier(s => ({ ...s, priceFiles: [newFile, ...s.priceFiles] }))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleDriveExtracted(result: { fileId: string; extracted: number; stagingCount: number; fileName: string }) {
    setShowBrowser(false)
    setDriveResult({ fileName: result.fileName, extracted: result.extracted, fileId: result.fileId })

    const newFile: PriceFile = {
      id:           result.fileId,
      fileName:     result.fileName,
      fileType:     'pdf',
      importStatus: 'completed',
      rowsExtracted: result.extracted,
      rowsFailed:   0,
      stagingCount: result.stagingCount,
      uploadedAt:   new Date().toISOString(),
      processedAt:  new Date().toISOString(),
      uploadedBy:   { name: 'You' },
    }
    setSupplier(s => ({ ...s, priceFiles: [newFile, ...s.priceFiles] }))
  }

  return (
    <div className="space-y-6">
      {/* Supplier info card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{supplier.name}</h2>
            <div className="mt-2 flex items-center gap-6 text-sm text-gray-500 flex-wrap">
              {supplier.paymentTerm && <span>Term: <strong className="text-gray-700">{supplier.paymentTerm}</strong></span>}
              <span>Currency: <strong className="text-gray-700">{supplier.currency}</strong></span>
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${supplier.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${supplier.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                {supplier.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          {/* Upload actions */}
          <div className="flex items-center gap-3">
            {/* Google Drive button */}
            {isGoogleConnected ? (
              <button
                onClick={() => { setShowBrowser(true); setDriveResult(null); setError(null) }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <span>📁</span> Browse Drive
              </button>
            ) : (
              <a
                href={`/api/auth/google?returnUrl=${encodeURIComponent(currentUrl)}`}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-blue-300 text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <span>🔗</span> Connect Google Drive
              </a>
            )}

            {/* Manual upload fallback */}
            <label className={`cursor-pointer flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
              uploading ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}>
              {uploading ? '⏳ Uploading…' : '↑ Upload file'}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Google connection message */}
      {googleMsg && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          googleMsg.includes('success')
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          {googleMsg}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Drive extraction result */}
      {driveResult && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-5 py-4 text-sm text-green-800 space-y-1">
          <p className="font-semibold">Claude extracted {driveResult.extracted} price rows from "{driveResult.fileName}"</p>
          <Link
            href={`/admin/suppliers/${supplier.id}/price-files/${driveResult.fileId}`}
            className="inline-block mt-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-700 text-white hover:bg-green-800 transition-colors"
          >
            Review & approve prices →
          </Link>
        </div>
      )}

      {/* Manual upload result */}
      {uploadResult && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-5 py-4 text-sm text-green-800 space-y-1">
          <p className="font-semibold">{uploadResult.extracted} rows extracted successfully.</p>
          <Link
            href={`/admin/suppliers/${supplier.id}/price-files/${uploadResult.fileId}`}
            className="inline-block mt-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-700 text-white hover:bg-green-800 transition-colors"
          >
            Review staging rows →
          </Link>
        </div>
      )}

      {/* Price files list */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Price List History</h3>
        {supplier.priceFiles.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center text-sm text-gray-400">
            No price lists yet. Browse Google Drive or upload a file above.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Rows</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {supplier.priceFiles.map(f => (
                  <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900 text-xs font-mono truncate max-w-[200px] block">{f.fileName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        f.fileType === 'pdf'
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : 'bg-green-50 text-green-600 border border-green-200'
                      }`}>
                        {f.fileType === 'pdf' ? '📄 PDF' : `📊 ${f.fileType.toUpperCase()}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        f.importStatus === 'completed'  ? 'bg-green-100 text-green-700' :
                        f.importStatus === 'processing' ? 'bg-blue-100 text-blue-700' :
                        f.importStatus === 'failed'     ? 'bg-red-100 text-red-700' :
                                                          'bg-gray-100 text-gray-600'
                      }`}>
                        {f.importStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{f.rowsExtracted ?? '—'} rows</td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(f.uploadedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.stagingCount > 0 && (
                        <Link
                          href={`/admin/suppliers/${supplier.id}/price-files/${f.id}`}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          Review ({f.stagingCount}) →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drive browser modal */}
      {showBrowser && (
        <DriveBrowser
          supplierId={supplier.id}
          rootFolderId={rootFolderId}
          supplierName={supplier.name}
          onClose={() => setShowBrowser(false)}
          onExtracted={handleDriveExtracted}
        />
      )}
    </div>
  )
}
