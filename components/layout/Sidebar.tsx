'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NotificationBell from '@/components/layout/NotificationBell'
import PushNotificationToggle from '@/components/layout/PushNotificationToggle'

// ── SVG icons ─────────────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
    </svg>
  )
}

function IconCompanies() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
    </svg>
  )
}

function IconContacts() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
    </svg>
  )
}

function IconPipeline() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/>
    </svg>
  )
}

function IconActivities() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
    </svg>
  )
}

function IconQuotations() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
    </svg>
  )
}

function IconOrders() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
    </svg>
  )
}

function IconWarehouse() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/>
    </svg>
  )
}

function IconReports() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
    </svg>
  )
}

function IconQneSandbox() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
    </svg>
  )
}

function IconAdmin() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
  )
}

function IconSignOut() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
    </svg>
  )
}

// ── Nav item definition ────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/',            label: 'Dashboard',  Icon: IconDashboard,   roles: null },
  { href: '/companies',  label: 'Companies',  Icon: IconCompanies,   roles: null },
  { href: '/contacts',   label: 'Contacts',   Icon: IconContacts,    roles: null },
  { href: '/pipeline',   label: 'Pipeline',   Icon: IconPipeline,    roles: null },
  { href: '/activities', label: 'Activities', Icon: IconActivities,  roles: null },
  { href: '/quotations', label: 'Quotations', Icon: IconQuotations,  roles: null },
  { href: '/orders',     label: 'Orders',     Icon: IconOrders,      roles: null },
  { href: '/warehouse',  label: 'Warehouse',  Icon: IconWarehouse,   roles: ['Admin', 'Manager', 'Warehouse'] },
  { href: '/reports',             label: 'Reports',    Icon: IconReports,      roles: ['Admin', 'Manager'] },
  { href: '/admin/qne-sandbox',  label: 'QNE Sandbox', Icon: IconQneSandbox, roles: ['Admin', 'Manager'] },
  { href: '/admin',              label: 'Admin',      Icon: IconAdmin,        roles: ['Admin', 'Manager'] },
] as const

// ── Sidebar ────────────────────────────────────────────────────────────────

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-100 flex flex-col min-h-screen">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center tracking-tight shadow-sm">
            F
          </div>
          <div>
            <span className="font-bold text-gray-900 text-sm tracking-tight">Flexxo OS</span>
            <p className="text-xs text-gray-400 leading-none mt-0.5">Sales Operations</p>
          </div>
        </div>
      </div>

      {/* Notification bell */}
      <div className="px-3 pt-3 pb-1 border-b border-gray-50">
        <NotificationBell />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter(item =>
          item.roles === null || (role && (item.roles as readonly string[]).includes(role))
        ).map(item => {
          // A more specific nav item takes precedence — check exact match or
          // startsWith(href) only when no sibling nav item has a longer matching prefix.
          const otherHrefs = (NAV_ITEMS as readonly { href: string }[])
            .map(n => n.href)
            .filter(h => h !== item.href)
          const active = item.href === '/'
            ? pathname === '/'
            : (pathname === item.href || pathname.startsWith(item.href + '/'))
              && !otherHrefs.some(h => h !== '/' && pathname.startsWith(h) && h.length > item.href.length)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                active
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className={`shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                <item.Icon />
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-1">
        <PushNotificationToggle />
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <IconSignOut />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
