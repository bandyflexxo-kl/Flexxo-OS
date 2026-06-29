'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import NotificationBell from '@/components/layout/NotificationBell'
import PushNotificationToggle from '@/components/layout/PushNotificationToggle'
import { Z } from '@/constants/zIndex'
import { rolesForNav } from '@/lib/access'

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

function IconDeliveryRun() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM3 6h11v11H3V6zm11 4h4l3 3v4h-7v-7z"/>
    </svg>
  )
}

function IconTenders() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
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

function IconMarketScout() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 10l1.5 1.5M10 10a2 2 0 100-4 2 2 0 000 4"/>
    </svg>
  )
}

function IconSalesAgent() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
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

function IconAdminAgent() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
    </svg>
  )
}

function IconOpsAgent() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/>
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

function IconMenu() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
    </svg>
  )
}

function IconClose() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
    </svg>
  )
}

// ── Nav item definition ────────────────────────────────────────────────────

// Visibility is driven by the central access matrix in lib/access.ts —
// the middleware enforces the same matrix server-side, so hiding a link
// here is cosmetic; the hard guard lives in middleware.ts.
const NAV_ITEMS = [
  { href: '/',            label: 'Dashboard',  Icon: IconDashboard,   roles: rolesForNav('/') },
  { href: '/companies',  label: 'Companies',  Icon: IconCompanies,   roles: rolesForNav('/companies') },
  { href: '/contacts',   label: 'Contacts',   Icon: IconContacts,    roles: rolesForNav('/contacts') },
  { href: '/pipeline',   label: 'Pipeline',   Icon: IconPipeline,    roles: rolesForNav('/pipeline') },
  { href: '/activities', label: 'Activities', Icon: IconActivities,  roles: rolesForNav('/activities') },
  { href: '/quotations', label: 'Quotations', Icon: IconQuotations,  roles: rolesForNav('/quotations') },
  { href: '/orders',     label: 'Orders',     Icon: IconOrders,      roles: rolesForNav('/orders') },
  { href: '/tenders',    label: 'Tenders',    Icon: IconTenders,     roles: rolesForNav('/tenders') },
  { href: '/warehouse',  label: 'Warehouse',  Icon: IconWarehouse,   roles: rolesForNav('/warehouse') },
  { href: '/delivery-runs', label: 'Delivery Runs', Icon: IconDeliveryRun, roles: rolesForNav('/delivery-runs') },
  { href: '/reports',             label: 'Reports',       Icon: IconReports,      roles: rolesForNav('/reports') },
  { href: '/agents/sales',       label: 'Sales Agent',    Icon: IconSalesAgent,   roles: rolesForNav('/agents') },
  { href: '/agents/admin',       label: 'Admin Agent',    Icon: IconAdminAgent,   roles: ['Admin', 'Director', 'Manager'] },
  { href: '/agents/operation',   label: 'Operation Agent', Icon: IconOpsAgent,    roles: rolesForNav('/agents') },
  { href: '/market-scout',       label: 'Market Scout',   Icon: IconMarketScout,  roles: rolesForNav('/market-scout') },
  { href: '/admin/qne-sandbox',  label: 'QNE Sandbox',   Icon: IconQneSandbox,   roles: rolesForNav('/admin') },
  { href: '/admin',              label: 'Admin',      Icon: IconAdmin,        roles: rolesForNav('/admin') },
] as const

// ── Shared nav list ────────────────────────────────────────────────────────

function NavList({
  role,
  pathname,
  onNavigate,
}: {
  role?: string
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
      {NAV_ITEMS.filter(item =>
        item.roles === null || (role && (item.roles as readonly string[]).includes(role))
      ).map(item => {
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
            onClick={onNavigate}
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
  )
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Prevent body scroll when drawer open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  return (
    <>
      {/* ── Mobile top bar ── */}
      <header
        className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-100 h-14 flex items-center px-3 gap-2"
        style={{ zIndex: Z.crmTopbar }}
      >
        {/* Hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          aria-label="Open navigation"
        >
          <IconMenu />
        </button>

        {/* Brand */}
        <div className="flex items-center gap-2 flex-1">
          <div className="w-6 h-6 rounded-md bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center tracking-tight shadow-sm">
            F
          </div>
          <span className="font-bold text-gray-900 text-sm tracking-tight">Flexxo OS</span>
        </div>

        {/* Notification bell on mobile */}
        <NotificationBell />
      </header>

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 transition-opacity"
          style={{ zIndex: Z.crmBackdrop }}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 w-72 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-300 ease-in-out ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ zIndex: Z.crmDrawer }}
      >
        {/* Drawer header */}
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center tracking-tight shadow-sm">
            F
          </div>
          <div className="flex-1">
            <span className="font-bold text-gray-900 text-sm tracking-tight">Flexxo OS</span>
            <p className="text-xs text-gray-400 leading-none mt-0.5">Sales Operations</p>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors"
            aria-label="Close navigation"
          >
            <IconClose />
          </button>
        </div>

        {/* Notification bell inside drawer */}
        <div className="px-3 pt-3 pb-1 border-b border-gray-50 shrink-0">
          <NotificationBell />
        </div>

        {/* Nav list */}
        <NavList role={role} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-1 shrink-0">
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

      {/* ── Desktop sidebar (static) ── */}
      <aside className="hidden lg:flex w-56 shrink-0 bg-white border-r border-gray-100 flex-col min-h-screen">
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
        <NavList role={role} pathname={pathname} />

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
    </>
  )
}
