'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/',            label: 'Dashboard',  icon: '◻' },
  { href: '/companies',  label: 'Companies',  icon: '🏢' },
  { href: '/contacts',   label: 'Contacts',   icon: '👤' },
  { href: '/pipeline',   label: 'Pipeline',   icon: '⇒' },
  { href: '/activities', label: 'Activities', icon: '📋' },
  { href: '/quotations', label: 'Quotations', icon: '📄' },
  { href: '/admin',      label: 'Admin',      icon: '⚙' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      <div className="px-6 py-5 border-b border-gray-200">
        <span className="font-bold text-gray-900 text-lg tracking-tight">Flexxo OS</span>
        <p className="text-xs text-gray-400 mt-0.5">Sales Operations</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
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
      <div className="px-3 py-4 border-t border-gray-200">
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
