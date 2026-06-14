/**
 * lib/access.ts — Central role-based access matrix for the CRM.
 *
 * IMPORTANT: This file must stay client-safe (no 'server-only', no prisma) —
 * it is imported by middleware.ts (edge) and the Sidebar (client component).
 *
 * Role hierarchy (decided 13 Jun 2026):
 *   Director    — top management (Timothy, Bandy, Javenn). Sees EVERYTHING:
 *                 reports, margins, team performance, all approvals.
 *   Manager     — same page access as Director (legacy role, currently unused).
 *   Admin       — operations staff. Runs the system day-to-day (approvals,
 *                 orders, products, users) but does NOT see strategic data:
 *                 no Reports (margins/team performance) and no Activities feed.
 *   Salesperson — own book only: dashboard, companies, contacts, pipeline,
 *                 quotations, orders, warehouse view, market scout.
 *   Warehouse   — picking board ONLY. No customer, pricing, or company data.
 *   Viewer      — read-only basics.
 */

export const CRM_ROLES = ['Director', 'Manager', 'Admin', 'Salesperson', 'Warehouse', 'Viewer'] as const
export type CrmRole = (typeof CRM_ROLES)[number]

/**
 * Allowed route prefixes per role. A path is allowed when it equals the
 * prefix or starts with `prefix + '/'`. '/' (dashboard) listed explicitly.
 */
const ACCESS: Record<string, string[]> = {
  Director: ['/', '/companies', '/contacts', '/pipeline', '/activities', '/quotations',
             '/orders', '/warehouse', '/reports', '/market-scout', '/admin'],
  Manager:  ['/', '/companies', '/contacts', '/pipeline', '/activities', '/quotations',
             '/orders', '/warehouse', '/reports', '/market-scout', '/admin'],
  Admin:    ['/', '/companies', '/contacts', '/pipeline', '/quotations',
             '/orders', '/warehouse', '/market-scout', '/admin'],
  Salesperson: ['/', '/companies', '/contacts', '/pipeline', '/quotations',
                '/orders', '/warehouse', '/market-scout'],
  Warehouse: ['/warehouse'],
  Viewer:    ['/', '/companies', '/contacts'],
}

/** Landing page after login / when a route is denied. */
export function homeFor(role: string): string {
  return role === 'Warehouse' ? '/warehouse' : '/'
}

/** Whether `role` may visit a CRM `pathname` (page routes, not /api). */
export function canAccessPath(role: string, pathname: string): boolean {
  const allowed = ACCESS[role]
  if (!allowed) return false
  return allowed.some(prefix =>
    prefix === '/'
      ? pathname === '/'
      : pathname === prefix || pathname.startsWith(prefix + '/')
  )
}

/** Roles allowed to see a given nav prefix — used by the Sidebar. */
export function rolesForNav(prefix: string): string[] {
  return Object.entries(ACCESS)
    .filter(([, prefixes]) => prefixes.includes(prefix))
    .map(([role]) => role)
}

/** Top-management roles: full strategic visibility (reports, margins, team). */
export function isExecutiveRole(role: string): boolean {
  return role === 'Director' || role === 'Manager'
}
