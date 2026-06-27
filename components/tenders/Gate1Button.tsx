'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Gate1Button({ tenderId }: { tenderId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ack() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gate1`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={ack}
        disabled={busy}
        className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {busy ? 'Acknowledging…' : '✓ Acknowledge Gate 1'}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}
