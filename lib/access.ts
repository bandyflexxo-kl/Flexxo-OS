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

export const CRM_ROLES = ['Director', 'SuperAdmin', 'Manager', 'Admin', 'Salesperson', 'Purchaser', 'Warehouse', 'Viewer'] as const
export type CrmRole = (typeof CRM_ROLES)[number]

/**
 * Allowed route prefixes per role. A path is allowed when it equals the
 * prefix or starts with `prefix + '/'`. '/' (dashboard) listed explicitly.
 */
const ACCESS: Record<string, string[]> = {
  Director: ['/', '/companies', '/contacts', '/pipeline', '/activities', '/quotations',
             '/orders', '/warehouse', '/delivery-runs', '/reports', '/market-scout', '/agents', '/tenders', '/admin'],
  // SuperAdmin — top system role: everything Director sees, plus the right to
  // break a tender price lock / manage tender settings (enforced in tenderAccess).
  SuperAdmin: ['/', '/companies', '/contacts', '/pipeline', '/activities', '/quotations',
               '/orders', '/warehouse', '/delivery-runs', '/reports', '/market-scout', '/agents', '/tenders', '/admin'],
  Manager:  ['/', '/companies', '/contacts', '/pipeline', '/activities', '/quotations',
             '/orders', '/warehouse', '/delivery-runs', '/reports', '/market-scout', '/agents', '/tenders', '/admin'],
  Admin:    ['/', '/companies', '/contacts', '/pipeline', '/quotations',
             '/orders', '/warehouse', '/delivery-runs', '/market-scout', '/agents', '/tenders', '/admin'],
  Salesperson: ['/', '/companies', '/contacts', '/pipeline', '/quotations',
                '/orders', '/warehouse', '/market-scout', '/agents', '/tenders'],
  // Purchaser — procurement only: tender Stages 4 & 5 (client PO + supplier PO).
  Purchaser: ['/', '/tenders'],
  Warehouse: ['/warehouse'],
  Viewer:    ['/', '/companies', '/contacts'],
}

/** Landing page after login / when a route is denied. */
export function homeFor(role: string): string {
  if (role === 'Warehouse') return '/warehouse'
  if (role === 'Purchaser') return '/tenders'
  return '/'
}

/**
 * Display label per role. The stored role key stays stable (e.g. "Salesperson"),
 * but the UI shows the tender-org label ("Sales Executive"). Reviving "Manager"
 * as "Sales Manager". Falls back to the key itself.
 */
const ROLE_LABELS: Record<string, string> = {
  Salesperson: 'Sales Executive',
  Manager:     'Sales Manager',
  SuperAdmin:  'Super Admin',
  Warehouse:   'Receiver / Warehouse',
}
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
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
  return role === 'Director' || role === 'Manager' || role === 'SuperAdmin'
}
