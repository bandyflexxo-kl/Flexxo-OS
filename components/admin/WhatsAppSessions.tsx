'use client'

import { useState, useEffect, useCallback } from 'react'

type User = { id: string; name: string; email: string }

type SessionState = {
  status:  'disconnected' | 'connecting' | 'connected'
  phone:   string | null
  qr:      string | null
}

const STATUS_COLOR = {
  connected:    'bg-green-500',
  connecting:   'bg-yellow-400 animate-pulse',
  disconnected: 'bg-gray-300',
}

const STATUS_LABEL = {
  connected:    'Connected',
  connecting:   'Waiting for scan…',
  disconnected: 'Not connected',
}

export default function WhatsAppSessions({ users }: { users: User[] }) {
  const [sessions, setSessions] = useState<Record<string, SessionState>>({})
  const [busy,     setBusy]     = useState<Record<string, boolean>>({})

  const fetchStatus = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/admin/whatsapp/${userId}/status`)
      if (!res.ok) return
      const state = await res.json() as SessionState
      setSessions(prev => ({ ...prev, [userId]: state }))
    } catch { /* bridge may not be running */ }
  }, [])

  // Initial status fetch for all users
  useEffect(() => {
    users.forEach(u => fetchStatus(u.id))
  }, [users, fetchStatus])

  // Poll every 2s for any user in 'connecting' state
  useEffect(() => {
    const connectingIds = Object.entries(sessions)
      .filter(([, s]) => s.status === 'connecting')
      .map(([id]) => id)

    if (connectingIds.length === 0) return
    const interval = setInterval(() => {
      connectingIds.forEach(userId => fetchStatus(userId))
    }, 2000)
    return () => clearInterval(interval)
  }, [sessions, fetchStatus])

  async function connect(userId: string) {
    setBusy(b => ({ ...b, [userId]: true }))
    try {
      const res = await fetch(`/api/admin/whatsapp/${userId}/connect`, { method: 'POST' })
      if (!res.ok) {
        alert('Could not reach bridge server. Make sure WHATSAPP_BRIDGE_URL is set in Vercel and the bridge is running on Railway.')
        return
      }
      const state = await res.json() as SessionState
      setSessions(prev => ({ ...prev, [userId]: state }))
    } finally {
      setBusy(b => ({ ...b, [userId]: false }))
    }
  }

  async function disconnect(userId: string) {
    if (!confirm('Disconnect this WhatsApp session? The salesperson will need to scan again.')) return
    setBusy(b => ({ ...b, [userId]: true }))
    try {
      await fetch(`/api/admin/whatsapp/${userId}/disconnect`, { method: 'DELETE' })
      setSessions(prev => ({ ...prev, [userId]: { status: 'disconnected', phone: null, qr: null } }))
    } finally {
      setBusy(b => ({ ...b, [userId]: false }))
    }
  }

  const isBridgeConfigured = typeof window !== 'undefined'  // always try; error shows if not configured

  return (
    <div className="space-y-4">
      {/* Bridge setup banner — shown until bridge is configured */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 space-y-1">
        <p className="font-semibold">Before using: add to Vercel environment variables</p>
        <p><code className="font-mono bg-amber-100 px-1 rounded">WHATSAPP_BRIDGE_URL</code> — your Railway bridge URL (e.g. <code className="font-mono">https://flexxo-wa-bridge.railway.app</code>)</p>
        <p><code className="font-mono bg-amber-100 px-1 rounded">BRIDGE_SECRET</code> — shared secret matching the bridge .env</p>
      </div>

      {users.map(user => {
        const state   = sessions[user.id] ?? { status: 'disconnected', phone: null, qr: null }
        const isbusy  = busy[user.id] ?? false

        return (
          <div key={user.id} className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between gap-4">
              {/* Identity + status dot */}
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLOR[state.status]}`} />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{user.name}</p>
                  <p className="text-xs text-gray-400">{user.email}</p>
                </div>
              </div>

              {/* Status label + buttons */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500">
                  {STATUS_LABEL[state.status]}
                  {state.phone && (
                    <span className="ml-1 font-mono text-green-700">{state.phone}</span>
                  )}
                </span>

                {state.status === 'connected' ? (
                  <button
                    onClick={() => disconnect(user.id)}
                    disabled={isbusy}
                    className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    {isbusy ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    onClick={() => state.status !== 'connecting' && connect(user.id)}
                    disabled={isbusy || state.status === 'connecting'}
                    className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isbusy
                      ? 'Starting…'
                      : state.status === 'connecting'
                      ? 'Scan QR ↓'
                      : 'Connect'}
                  </button>
                )}
              </div>
            </div>

            {/* QR code */}
            {state.status === 'connecting' && state.qr && (
              <div className="mt-4 flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                <p className="text-xs text-gray-500 text-center">
                  Open WhatsApp on <strong>{user.name}</strong>&#39;s phone →{' '}
                  <strong>Linked Devices → Link a device</strong> → scan this QR
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={state.qr} alt="WhatsApp QR Code" className="w-52 h-52 rounded-xl shadow" />
                <p className="text-xs text-gray-400">QR updates automatically if it expires</p>
              </div>
            )}

            {state.status === 'connecting' && !state.qr && (
              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
                <span className="inline-block w-3 h-3 border-2 border-yellow-400 border-t-yellow-700 rounded-full animate-spin" />
                Generating QR…
              </div>
            )}
          </div>
        )
      })}

      {isBridgeConfigured && users.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No internal users found.</p>
      )}
    </div>
  )
}
