'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

type NotificationItem = {
  type:      string
  title:     string
  body:      string
  url:       string
  createdAt: string
}

type NotificationResult = {
  items:  NotificationItem[]
  count:  number
  urgent: number
}

const TYPE_EMOJI: Record<string, string> = {
  overdue_followup:  '🔴',
  due_today:         '📋',
  approved_quote:    '✉',
  draft_quote:       '📝',
  pending_approval:  '⏳',
  inactive_account:  '😴',
  account_request:   '🆕',
}

const TYPE_LABEL: Record<string, string> = {
  overdue_followup:  'Overdue',
  due_today:         'Due Today',
  approved_quote:    'Ready to Send',
  draft_quote:       'Draft Quote',
  pending_approval:  'Pending Approval',
  inactive_account:  'Inactive Account',
  account_request:   'Account Request',
}

export default function NotificationBell() {
  const [data,    setData]    = useState<NotificationResult | null>(null)
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef           = useRef<HTMLDivElement>(null)

  async function fetchNotifications() {
    if (document.visibilityState === 'hidden') return  // don't poll when tab hidden
    setLoading(true)
    try {
      const res  = await fetch('/api/notifications')
      if (res.ok) setData(await res.json() as NotificationResult)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60_000)  // poll every 60s
    return () => clearInterval(interval)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const count  = data?.count  ?? 0
  const urgent = data?.urgent ?? 0

  return (
    <div ref={dropdownRef} className="relative px-3 py-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center gap-2 w-full text-left text-sm text-gray-600 hover:text-gray-900 transition-colors"
        title={count > 0 ? `${count} action${count !== 1 ? 's' : ''} needed` : 'No actions needed'}
      >
        <span className="relative text-lg">
          🔔
          {count > 0 && (
            <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1 ${urgent > 0 ? 'bg-red-500' : 'bg-blue-500'}`}>
              {count > 99 ? '99+' : count}
            </span>
          )}
        </span>
        <span className="font-medium">
          {count > 0 ? `${count} Action${count !== 1 ? 's' : ''}` : 'All clear'}
        </span>
        {loading && <span className="ml-auto w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">
              {count > 0 ? `${count} action${count !== 1 ? 's' : ''} needed` : 'All clear ✓'}
            </span>
            <button
              onClick={fetchNotifications}
              className="text-xs text-blue-600 hover:underline"
            >
              Refresh
            </button>
          </div>

          {count === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              <p className="text-2xl mb-2">✅</p>
              No actions needed right now.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {data?.items.map((item, i) => (
                <Link
                  key={i}
                  href={item.url}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <span className="text-base flex-shrink-0 mt-0.5">
                    {TYPE_EMOJI[item.type] ?? '•'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.body}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{TYPE_LABEL[item.type] ?? item.type}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
