'use client'

import { useState, useEffect, useCallback } from 'react'

type DriveItem = {
  id:           string
  name:         string
  mimeType:     string
  modifiedTime: string | null
  size:         string | null
  isFolder:     boolean
  isPdf:        boolean
}

type BreadcrumbItem = { id: string; name: string }

type ExtractResult = {
  fileId:       string
  extracted:    number
  stagingCount: number
}

export default function DriveBrowser({
  supplierId,
  rootFolderId,
  supplierName,
  onClose,
  onExtracted,
}: {
  supplierId:   string
  rootFolderId: string
  supplierName: string
  onClose:      () => void
  onExtracted:  (result: ExtractResult & { fileName: string }) => void
}) {
  const [items,       setItems]       = useState<DriveItem[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [breadcrumb,  setBreadcrumb]  = useState<BreadcrumbItem[]>([{ id: rootFolderId, name: 'Supplier Price List' }])
  const [extracting,  setExtracting]  = useState<string | null>(null)  // fileId being extracted
  const [extractMsg,  setExtractMsg]  = useState<string | null>(null)

  const currentFolderId = breadcrumb[breadcrumb.length - 1].id

  const loadFolder = useCallback(async (folderId: string) => {
    setLoading(true)
    setError(null)
    setItems([])
    try {
      const res  = await fetch(`/api/drive/browse?folderId=${encodeURIComponent(folderId)}`)
      const data = await res.json() as { items?: DriveItem[]; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to load folder'); return }
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFolder(rootFolderId) }, [rootFolderId, loadFolder])

  function navigateInto(item: DriveItem) {
    setBreadcrumb(prev => [...prev, { id: item.id, name: item.name }])
    loadFolder(item.id)
  }

  function navigateTo(index: number) {
    const crumb = breadcrumb[index]
    setBreadcrumb(prev => prev.slice(0, index + 1))
    loadFolder(crumb.id)
  }

  async function extractPdf(item: DriveItem) {
    setExtracting(item.id)
    setExtractMsg(`Downloading "${item.name}" from Drive…`)
    setError(null)
    try {
      const res  = await fetch(`/api/suppliers/${supplierId}/extract-from-drive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fileId: item.id, fileName: item.name }),
      })
      const data = await res.json() as ExtractResult & { error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Extraction failed')
        return
      }

      onExtracted({ ...data, fileName: item.name })
    } finally {
      setExtracting(null)
      setExtractMsg(null)
    }
  }

  const folders = items.filter(i => i.isFolder)
  const pdfs    = items.filter(i => i.isPdf)
  const others  = items.filter(i => !i.isFolder && !i.isPdf)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: '80vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Browse Google Drive</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Select a PDF to extract prices for <strong>{supplierName}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Breadcrumb */}
        <div className="px-5 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center gap-1 text-xs overflow-x-auto">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <span className="text-gray-300">/</span>}
              {i < breadcrumb.length - 1 ? (
                <button
                  onClick={() => navigateTo(i)}
                  className="text-blue-600 hover:underline"
                >
                  {crumb.name}
                </button>
              ) : (
                <span className="text-gray-700 font-medium">{crumb.name}</span>
              )}
            </span>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-gray-400 animate-pulse">Loading…</div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {extractMsg && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              {extractMsg.includes('Downloading') && extracting
                ? 'Downloading PDF and sending to Claude AI for extraction… this may take 20–40 seconds.'
                : extractMsg}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-10">
              This folder is empty.
            </div>
          )}

          {/* Folders first */}
          {folders.map(item => (
            <button
              key={item.id}
              onClick={() => navigateInto(item)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors group"
            >
              <span className="text-lg">📁</span>
              <span className="text-sm font-medium text-gray-800 flex-1 truncate">{item.name}</span>
              <span className="text-gray-300 group-hover:translate-x-0.5 transition-transform text-xs">→</span>
            </button>
          ))}

          {/* PDFs */}
          {pdfs.map(item => (
            <button
              key={item.id}
              onClick={() => !extracting && extractPdf(item)}
              disabled={!!extracting}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                extracting === item.id
                  ? 'bg-blue-50 border border-blue-200'
                  : extracting
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-green-50 hover:border hover:border-green-200 border border-transparent'
              }`}
            >
              <span className="text-lg">📄</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                {item.modifiedTime && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Modified {new Date(item.modifiedTime).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
              {extracting === item.id ? (
                <span className="text-xs text-blue-600 font-medium animate-pulse">Extracting…</span>
              ) : (
                <span className="text-xs text-green-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Extract prices →
                </span>
              )}
            </button>
          ))}

          {/* Other files (not PDF, not folder) */}
          {others.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-3 py-2.5 opacity-40"
            >
              <span className="text-lg">📎</span>
              <span className="text-sm text-gray-500 truncate">{item.name}</span>
              <span className="text-xs text-gray-400 ml-auto">Not a PDF</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-400">
            📄 Click a PDF to extract prices · 📁 Click a folder to navigate into it
          </p>
        </div>
      </div>
    </div>
  )
}
