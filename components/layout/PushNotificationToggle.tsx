'use client'

import { useState, useEffect } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = window.atob(base64)
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)))
}

export default function PushNotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission | 'loading'>('loading')
  const [subscribing, setSubscribing] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('denied')
      return
    }
    setPermission(Notification.permission)
  }, [])

  // Don't render if push not supported
  if (typeof window !== 'undefined' && !('serviceWorker' in navigator)) return null
  if (permission === 'loading') return null

  async function enable() {
    setSubscribing(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      const key  = sub.getKey('p256dh')
      const auth = sub.getKey('auth')

      await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          endpoint: sub.endpoint,
          p256dh:   key  ? btoa(String.fromCharCode(...new Uint8Array(key)))  : '',
          auth:     auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
        }),
      })
    } finally {
      setSubscribing(false)
    }
  }

  async function disable() {
    setSubscribing(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setPermission('default')
    } finally {
      setSubscribing(false)
    }
  }

  if (permission === 'denied') {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-2">
        <span>🔕</span>
        <span>Push blocked in browser</span>
      </div>
    )
  }

  if (permission === 'granted') {
    return (
      <button
        onClick={disable}
        disabled={subscribing}
        className="w-full px-3 py-2 text-sm text-left text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2"
        title="Click to disable push notifications"
      >
        <span>🔔</span>
        <span>{subscribing ? 'Disabling…' : 'Notifications ON'}</span>
      </button>
    )
  }

  return (
    <button
      onClick={enable}
      disabled={subscribing}
      className="w-full px-3 py-2 text-sm text-left text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-2 font-medium"
      title="Get instant alerts for follow-ups, quotes, and more"
    >
      <span>🔔</span>
      <span>{subscribing ? 'Enabling…' : 'Enable Notifications'}</span>
    </button>
  )
}
