'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NotificationBell from '@/components/layout/NotificationBell'
import PushNotificationToggle from '@/components/layout/PushNotificationToggle'

const NAV_ITEMS = [
  { href: '/',            label: 'Dashboard',  icon: '◻',  roles: null },
  { href: '/companies',  label: 'Companies',  icon: '🏢',  roles: null },
  { href: '/contacts',   label: 'Contacts',   icon: '👤',  roles: null },
  { href: '/pipeline',   label: 'Pipeline',   icon: '⇒',  roles: null },
  { href: '/activities', label: 'Activities', icon: '📋',  roles: null },
  { href: '/quotations', label: 'Quotations', icon: '📄',  roles: null },
  { href: '/orders',     label: 'Orders',     icon: '📦',  roles: null },
  { href: '/warehouse',  label: 'Warehouse',  icon: '🏭',  roles: ['Admin', 'Manager', 'Warehouse'] },
  { href: '/reports',    label: 'Reports',    icon: '📊',  roles: ['Admin', 'Manager'] },
  { href: '/admin',      label: 'Admin',      icon: '⚙',   roles: ['Admin', 'Manager'] },
] as const

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      <div className="px-6 py-5 border-b border-gray-200">
        <span className="font-bold text-gray-900 text-lg tracking-tight">Flexxo OS</span>
        <p className="text-xs text-gray-400 mt-0.5">Sales Operations</p>
      </div>
      <div className="px-3 pt-3 pb-1 border-b border-gray-100">
        <NotificationBell />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.filter(item =>
          item.roles === null || (role && (item.roles as readonly string[]).includes(role))
        ).map((item) => {
          const active = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-4 border-t border-gray-200 space-y-1">
        <PushNotificationToggle />
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <span>⇤</span> Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
