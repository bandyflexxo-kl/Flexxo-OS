import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import type { SessionPayload } from '@/lib/session'
import { countEmptyStockCategories } from '@/lib/categoryCoverage'

/**
 * TodoSection — the FIRST thing every internal user sees after login.
 *
 * A loud, numbered action list computed live from the database, tailored to
 * the role. Empty state = green "all clear". Each item links straight to the
 * page where the work happens.
 *
 * Role rules (13 Jun 2026):
 *   Director/Manager — approvals + ops escalations + team follow-up debt
 *   Admin            — operational queue (approvals, requests, QNE entry)
 *   Salesperson      — own follow-ups, own stale drafts, own quiet accounts
 *   (Warehouse never sees this — they are redirected to /warehouse)
 */

export type TodoItem = {
  label:    string
  count:    number
  href:     string
  urgency:  'red' | 'amber' | 'blue'
  hint:     string
}

async function computeTodos(session: SessionPayload): Promise<TodoItem[]> {
  const role  = session.role
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

  const items: TodoItem[] = []

  if (role === 'Director' || role === 'Manager' || role === 'Admin') {
    const [pendingQuotes, ordersToApprove, packedOrders, accountRequests, qnePending, emptyStockCats] = await Promise.all([
      prisma.quotation.count({ where: { status: 'pending_review' } }),
      prisma.order.count({ where: { status: 'Confirmed' } }),
      prisma.order.count({ where: { status: 'Packed' } }),
      prisma.accountRequest.count({ where: { status: 'pending' } }),
      prisma.qnePendingAction.count({ where: { status: 'pending' } }),
      countEmptyStockCategories(),
    ])

    if (pendingQuotes > 0) items.push({
      label: 'Approve customer quotations', count: pendingQuotes, href: '/quotations',
      urgency: 'red', hint: 'Customers are waiting — approve & auto-send',
    })
    if (ordersToApprove > 0) items.push({
      label: 'Approve new orders', count: ordersToApprove, href: '/orders',
      urgency: 'red', hint: 'Approving issues the invoice + creates the picking task',
    })
    if (packedOrders > 0) items.push({
      label: 'Arrange delivery for packed orders', count: packedOrders, href: '/orders',
      urgency: 'amber', hint: 'Warehouse finished picking — book Lalamove or own transport',
    })
    if (accountRequests > 0) items.push({
      label: 'Review business account requests', count: accountRequests, href: '/admin/account-requests',
      urgency: 'amber', hint: 'New companies asking for portal access',
    })
    if (qnePending > 0) items.push({
      label: 'Enter staged documents into QNE', count: qnePending, href: '/admin/qne-sandbox',
      urgency: 'blue', hint: 'Invoices & DOs waiting for manual QNE entry',
    })
    if (emptyStockCats > 0) items.push({
      label: 'Sub-categories now empty (no stock)', count: emptyStockCats, href: '/admin/stock-gaps',
      urgency: 'blue', hint: 'Decide which items to start keeping in stock',
    })
  }

  if (role === 'Director' || role === 'Manager') {
    // Team-wide follow-up debt — executives chase coverage
    const overdueFollowUps = await prisma.activity.count({
      where: {
        followUpAt: { lt: today },
        OR: [{ followUpStatus: 'Pending' }, { followUpStatus: null }],
        NOT: { followUpAt: null },
      },
    })
    if (overdueFollowUps > 0) items.push({
      label: 'Team has overdue follow-ups', count: overdueFollowUps, href: '/activities?followUpStatus=Pending',
      urgency: 'amber', hint: 'Chase the team — these client promises are past due',
    })
  }

  // Directors also do sales — show personal follow-ups, stale drafts, quiet accounts
  // on top of the executive block they already received above.
  if (role === 'Salesperson' || role === 'Director' || role === 'Viewer') {
    const myCompanies = await prisma.companyAssignment.findMany({
      where:  { userId: session.userId, unassignedAt: null },
      select: { companyId: true },
    })
    const myCompanyIds = myCompanies.map(c => c.companyId)

    const [overdue, dueToday, staleDrafts, quietAccounts] = await Promise.all([
      prisma.activity.count({
        where: {
          userId: session.userId, followUpAt: { lt: today },
          OR: [{ followUpStatus: 'Pending' }, { followUpStatus: null }],
          NOT: { followUpAt: null },
        },
      }),
      prisma.activity.count({
        where: {
          userId: session.userId, followUpAt: { gte: today, lt: tomorrow },
          OR: [{ followUpStatus: 'Pending' }, { followUpStatus: null }],
        },
      }),
      prisma.quotation.count({
        where: { createdById: session.userId, status: 'draft', createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } },
      }),
      prisma.company.count({
        where: {
          id: { in: myCompanyIds },
          status: { in: ['Lead', 'Contacted', 'Active Customer'] },
          activities: { none: { createdAt: { gte: thirtyDaysAgo } } },
        },
      }),
    ])

    if (overdue > 0) items.push({
      label: 'Overdue follow-ups — call these clients first', count: overdue, href: '#followups',
      urgency: 'red', hint: 'Past-due promises damage trust — clear these before anything else',
    })
    if (dueToday > 0) items.push({
      label: 'Follow-ups due today', count: dueToday, href: '#followups',
      urgency: 'amber', hint: 'Scheduled for today — list is below',
    })
    if (staleDrafts > 0) items.push({
      label: 'Draft quotations going stale', count: staleDrafts, href: '/quotations',
      urgency: 'amber', hint: 'Drafts older than 2 days — finish and submit them',
    })
    if (quietAccounts > 0) items.push({
      label: 'Your accounts have gone quiet (30+ days)', count: quietAccounts, href: '#inactive',
      urgency: 'blue', hint: 'No contact in a month — a quick WhatsApp keeps them warm',
    })
  }

  return items
}

const URGENCY_STYLES = {
  red:   { dot: 'bg-red-500',   badge: 'bg-red-100 text-red-700',     ring: 'hover:bg-red-50' },
  amber: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', ring: 'hover:bg-amber-50' },
  blue:  { dot: 'bg-blue-500',  badge: 'bg-blue-100 text-blue-700',   ring: 'hover:bg-blue-50' },
} as const

export default async function TodoSection({ session }: { session: SessionPayload }) {
  const items = await computeTodos(session)

  return (
    <div className="bg-white rounded-2xl border-2 border-gray-900/10 shadow-sm p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-xl">📋</span>
        <h2 className="text-base font-bold text-gray-900 tracking-tight">Your To-Do List</h2>
        {items.length > 0 && (
          <span className="ml-auto bg-gray-900 text-white text-xs font-bold rounded-full px-2.5 py-1 tabular-nums">
            {items.length} action{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-4">Work through this list top to bottom — most urgent first.</p>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-4">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-sm font-semibold text-green-800">All clear — nothing needs your attention right now.</p>
            <p className="text-xs text-green-600 mt-0.5">New tasks will appear here the moment they need you.</p>
          </div>
        </div>
      ) : (
        <ol className="space-y-2">
          {items.map((item, i) => {
            const s = URGENCY_STYLES[item.urgency]
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-4 border border-gray-100 rounded-xl px-4 py-3.5 transition-colors group ${s.ring}`}
                >
                  <span className="w-7 h-7 rounded-full bg-gray-900 text-white text-sm font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{item.label}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{item.hint}</p>
                  </div>
                  <span className={`text-sm font-bold rounded-full px-3 py-1 tabular-nums shrink-0 ${s.badge}`}>
                    {item.count}
                  </span>
                  <span className="text-gray-300 group-hover:text-gray-500 transition-colors shrink-0">→</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
