/**
 * /shop/dashboard — B2B Client Home
 *
 * 100% DB-sourced: every card, metric, and section reads ONLY from our synced
 * DB (qne_invoices aggregate, cached outstanding balance, portal orders) — never
 * from live QNE. There is no Radmin VPN on Vercel, so a live QNE call would just
 * stall to its timeout and leave skeletons spinning. The whole page renders
 * synchronously from the DB and appears instantly.
 */

import { redirect }              from 'next/navigation'
import Link                      from 'next/link'
import { prisma }                from '@/lib/prisma'
import { getOptionalShopSession } from '@/lib/session'
import AccountSection            from './AccountSection'
import QuickReorderSection, {
  type FrequentItem,
}                                from './QuickReorderSection'
import type { Decimal }          from '@prisma/client/runtime/client'

// ── Types ─────────────────────────────────────────────────────────────────────

type SmartReorder = {
  productId:     string
  name:          string
  unit:          string | null
  lastQty:       number
  daysUntilNext: number
  urgency:       'overdue' | 'urgent' | 'upcoming'
}

type CategoryBreakdown = { name: string; amount: number; pct: number }

type RecentOrder = {
  id:          string
  referenceNo: string | null
  status:      string
  totalAmount: number
  createdAt:   Date
  itemCount:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMalaysiaHour(): number {
  const utcHour = new Date().getUTCHours()
  return (utcHour + 8) % 24
}

function getDayGreeting(name: string): string {
  const h = getMalaysiaHour()
  const salutation = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return `${salutation}, ${name.split(' ')[0]} 👋`
}

function getPartnerTier(totalSpent: number): {
  tier: string; emoji: string; color: string
  nextTier: string | null; nextAt: number | null
} {
  if (totalSpent >= 50_000) return { tier: 'Platinum Partner', emoji: '💎', color: 'text-purple-700 bg-purple-50 border-purple-200', nextTier: null, nextAt: null }
  if (totalSpent >= 10_000) return { tier: 'Gold Partner',     emoji: '🥇', color: 'text-yellow-700 bg-yellow-50 border-yellow-200', nextTier: 'Platinum', nextAt: 50_000 }
  return                           { tier: 'Silver Partner',   emoji: '🥈', color: 'text-gray-600 bg-gray-50 border-gray-200',       nextTier: 'Gold',     nextAt: 10_000 }
}

function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    Delivered:  'text-green-700 bg-green-50',
    Delivering: 'text-blue-700 bg-blue-50',
    Packed:     'text-indigo-700 bg-indigo-50',
    Picking:    'text-indigo-600 bg-indigo-50',
    Approved:   'text-emerald-700 bg-emerald-50',
    Confirmed:  'text-amber-700 bg-amber-50',
    Shipped:    'text-blue-700 bg-blue-50',
    Processing: 'text-indigo-700 bg-indigo-50',
  }
  return map[status] ?? 'text-gray-600 bg-gray-50'
}

function computeSmartReorders(
  orders: Array<{
    createdAt: Date
    items: Array<{
      productId: string | null
      qty: Decimal
      product: { id: string; name: string; unit: string | null; category: { name: string } } | null
    }>
  }>
): SmartReorder[] {
  const map = new Map<string, { name: string; unit: string | null; category: string; dates: Date[]; lastQty: number }>()

  for (const order of orders) {
    for (const item of order.items) {
      if (!item.productId || !item.product) continue
      const existing = map.get(item.productId)
      if (existing) {
        existing.dates.push(order.createdAt)
        existing.lastQty = Number(item.qty)
      } else {
        map.set(item.productId, {
          name: item.product.name, unit: item.product.unit,
          category: item.product.category.name, dates: [order.createdAt], lastQty: Number(item.qty),
        })
      }
    }
  }

  const now = Date.now()
  const results: SmartReorder[] = []

  for (const [productId, data] of map) {
    const dates = [...data.dates].sort((a, b) => a.getTime() - b.getTime())
    if (dates.length < 2) continue

    let totalInterval = 0
    for (let i = 1; i < dates.length; i++) totalInterval += dates[i].getTime() - dates[i - 1].getTime()

    const avgInterval   = totalInterval / (dates.length - 1)
    const lastOrderDate = dates[dates.length - 1]
    const predictedNext = lastOrderDate.getTime() + avgInterval
    const daysUntilNext = Math.round((predictedNext - now) / 86_400_000)

    if (daysUntilNext <= 21) {
      results.push({
        productId, name: data.name, unit: data.unit, lastQty: data.lastQty, daysUntilNext,
        urgency: daysUntilNext <= 0 ? 'overdue' : daysUntilNext <= 7 ? 'urgent' : 'upcoming',
      })
    }
  }

  return results.sort((a, b) => a.daysUntilNext - b.daysUntilNext).slice(0, 4)
}

/**
 * computeFrequentItems — returns all distinct products ordered at least once,
 * sorted by order-frequency DESC.  Used by the Quick Reorder drawer.
 *
 * Orders are already sorted by createdAt DESC, so the first encounter of a
 * product is the most recent order → we use that qty as the default.
 */
function computeFrequentItems(
  orders: Array<{
    items: Array<{
      productId: string | null
      qty: Decimal
      product: { id: string; name: string; unit: string | null; category: { name: string } } | null
    }>
  }>
): FrequentItem[] {
  const map = new Map<string, { name: string; unit: string | null; orderCount: number; lastQty: number }>()

  for (const order of orders) {
    for (const item of order.items) {
      if (!item.productId || !item.product) continue
      const existing = map.get(item.productId)
      if (existing) {
        existing.orderCount++
        // First encounter (most recent order) already captured as lastQty — don't overwrite
      } else {
        map.set(item.productId, {
          name:       item.product.name,
          unit:       item.product.unit,
          orderCount: 1,
          lastQty:    Math.max(1, Number(item.qty)),
        })
      }
    }
  }

  return [...map.entries()]
    .map(([productId, d]) => ({ productId, name: d.name, unit: d.unit, orderCount: d.orderCount, lastQty: d.lastQty }))
    .sort((a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name))
    .slice(0, 50)   // cap at 50 items to keep the drawer manageable
}

function computeMonthlySpending(
  orders: Array<{ createdAt: Date; totalAmount: Decimal | null; status: string }>
): Array<{ month: string; amount: number }> {
  const completedStatuses = new Set(['Delivered', 'Shipped', 'Processing', 'Confirmed', 'Approved', 'Picking', 'Packed', 'Delivering'])
  const now    = new Date()
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ month: d.toLocaleDateString('en-MY', { month: 'short', year: '2-digit' }), amount: 0 })
  }
  for (const order of orders) {
    if (!completedStatuses.has(order.status)) continue
    const orderDate = new Date(order.createdAt)
    const monthsAgo = (now.getFullYear() - orderDate.getFullYear()) * 12 + (now.getMonth() - orderDate.getMonth())
    if (monthsAgo >= 0 && monthsAgo <= 5) {
      months[5 - monthsAgo].amount += Number(order.totalAmount ?? 0)
    }
  }
  return months
}

function computeCategoryBreakdown(
  orders: Array<{ items: Array<{ lineTotal: Decimal; product: { category: { name: string } } | null }> }>
): CategoryBreakdown[] {
  const map = new Map<string, number>()
  for (const order of orders) {
    for (const item of order.items) {
      const cat = item.product?.category.name ?? 'Others'
      map.set(cat, (map.get(cat) ?? 0) + Number(item.lineTotal))
    }
  }
  const grandTotal = [...map.values()].reduce((a, b) => a + b, 0)
  if (grandTotal === 0) return []
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount, pct: Math.round((amount / grandTotal) * 100) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
}

function fmtMyr(n: number): string {
  return `MYR ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

function memberSinceStr(createdAt: Date): string {
  return createdAt.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') redirect('/shop/login?returnUrl=/shop/dashboard')

  // ── Fetch user + company + salesperson ──────────────────────────────────
  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: {
      id: true, name: true, email: true, mobileNo: true, createdAt: true,
      customerCompany: {
        select: {
          id: true, name: true,
          qneCustomerCode: true,
          outstandingBalance: true,
          outstandingUpdatedAt: true,
          assignments: {
            where:   { unassignedAt: null },
            orderBy: { isPrimary: 'desc' },
            take:    1,
            select:  { user: { select: { id: true, name: true, mobileNo: true, email: true } } },
          },
        },
      },
    },
  })

  if (!user) redirect('/shop/login')

  const company     = user.customerCompany
  const salesperson = company?.assignments[0]?.user ?? null

  // ── Fetch order history ───────────────────────────────────────────────────
  const orders = company
    ? await prisma.order.findMany({
        where:   { companyId: company.id },
        orderBy: { createdAt: 'desc' },
        take:    200,
        select:  {
          id: true, referenceNo: true, status: true,
          totalAmount: true, createdAt: true,
          quotation: { select: { deliveryAddressId: true } },   // A3: which branch this order delivered to
          items: {
            select: {
              productId: true, qty: true, unitPrice: true, lineTotal: true,
              product: {
                select: {
                  id: true, name: true, unit: true,
                  category: { select: { name: true } },
                },
              },
            },
          },
        },
      })
    : []

  // ── Compute metrics (DB-only, fast) ──────────────────────────────────────
  const completedStatuses = new Set(['Delivered', 'Shipped', 'Processing', 'Confirmed', 'Approved', 'Picking', 'Packed', 'Delivering'])
  const activeStatuses    = new Set(['Confirmed', 'Approved', 'Picking', 'Packed', 'Delivering'])

  const totalSpent  = orders.reduce((sum, o) => sum + (completedStatuses.has(o.status) ? Number(o.totalAmount ?? 0) : 0), 0)
  const totalOrders = orders.filter(o => completedStatuses.has(o.status)).length
  const activeOrders = orders.filter(o => activeStatuses.has(o.status)).length

  // Cached QNE invoice totals (synced into our DB). These are the dashboard's
  // fallback for Total Spent / Orders Placed when live QNE is unreachable — which
  // it always is from Vercel/localhost (no Radmin VPN). Fast DB aggregate.
  let dbInvoiceTotal = 0
  let dbInvoiceCount = 0
  let spendFrom: Date | null = null
  let spendTo:   Date | null = null
  if (company) {
    const [cnt, sum, range] = await Promise.all([
      prisma.qneInvoice.count({ where: { companyId: company.id } }),
      prisma.qneInvoice.aggregate({ where: { companyId: company.id }, _sum: { totalAmount: true } }),
      prisma.qneInvoice.aggregate({ where: { companyId: company.id }, _min: { docDate: true }, _max: { docDate: true } }),
    ])
    dbInvoiceCount = cnt
    dbInvoiceTotal = Number(sum._sum.totalAmount ?? 0)
    spendFrom = range._min.docDate
    spendTo   = range._max.docDate
  }

  // Effective spend prefers real portal orders, else the cached QNE history —
  // so the partner tier / loyalty bar reflect a customer's true volume.
  const effectiveSpent = totalSpent > 0 ? totalSpent : dbInvoiceTotal

  // Top-of-page metric cards are rendered INLINE (synchronous) from data we
  // already have in the DB — NOT via a live QNE fetch. On Vercel there is no
  // Radmin VPN, so any live QNE call just stalls until its login timeout (~10s)
  // before falling back to exactly these values. Sourcing them straight from the
  // DB makes the cards appear instantly with the rest of the shell.
  const dashTotalIsInvoices = totalSpent === 0 && dbInvoiceTotal > 0
  const dashCount           = totalOrders > 0 ? totalOrders : dbInvoiceCount
  const dashCountIsInvoices = totalOrders === 0 && dbInvoiceCount > 0
  const dashOutstanding     = company?.outstandingBalance != null ? Number(company.outstandingBalance) : null

  // "From when to when" label for Total Spent — the span of the synced invoices.
  const fmtMonthYear   = (d: Date) => new Date(d).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })
  const spendRangeLabel = dashTotalIsInvoices && spendFrom && spendTo
    ? `${fmtMonthYear(spendFrom)} – ${fmtMonthYear(spendTo)}`
    : totalSpent > 0 ? 'lifetime (portal orders)' : null

  const partnerTier    = getPartnerTier(effectiveSpent)
  const smartReorders  = computeSmartReorders(orders)
  const frequentItems  = computeFrequentItems(orders)
  const categoryBreak  = computeCategoryBreakdown(orders)

  // A3: branch-scoped reorder — let the customer view past items per delivery branch.
  const branchRows = company
    ? await prisma.companyAddress.findMany({
        where:   { companyId: company.id, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select:  { id: true, branchName: true, label: true },
      })
    : []
  const branchOptions: { id: string; name: string }[] = branchRows.map(b => ({ id: b.id, name: b.branchName || b.label || 'Branch' }))
  const itemsByBranch: Record<string, FrequentItem[]> = { all: frequentItems }
  for (const b of branchRows) {
    itemsByBranch[b.id] = computeFrequentItems(orders.filter(o => o.quotation?.deliveryAddressId === b.id))
  }
  const monthlySpend   = computeMonthlySpending(orders)

  const recentOrders: RecentOrder[] = orders.slice(0, 3).map(o => ({
    id: o.id, referenceNo: o.referenceNo, status: o.status,
    totalAmount: Number(o.totalAmount ?? 0), createdAt: o.createdAt, itemCount: o.items.length,
  }))

  // WhatsApp deep link for salesperson
  const spWaNumber = salesperson?.mobileNo?.replace(/[^0-9]/g, '')
  const spWaHref   = spWaNumber
    ? `https://wa.me/6${spWaNumber.startsWith('0') ? spWaNumber : '0' + spWaNumber}?text=${encodeURIComponent(`Hi ${salesperson?.name?.split(' ')[0] ?? ''}, I'm reaching out regarding my Flexxo account (${company?.name ?? ''}).`)}`
    : null

  const greeting = getDayGreeting(user.name)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-24">

      {/* ── Hero greeting ─────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-green-900 via-green-800 to-green-700 px-4 pt-8 pb-16 relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
          <div className="absolute bottom-0 -left-8 w-32 h-32 rounded-full bg-green-600/30" />
        </div>

        <div className="max-w-3xl mx-auto relative">
          <p className="text-2xl font-bold text-white">{greeting}</p>
          <p className="text-green-200 text-sm mt-1">{company?.name ?? 'Your account'}</p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-white/10 text-white border-white/20">
              {partnerTier.emoji} {partnerTier.tier}
            </span>
            <span className="text-xs text-green-300">
              Partner since {memberSinceStr(user.createdAt)}
            </span>
            {activeOrders > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/15 text-white border border-white/20">
                🚚 {activeOrders} active order{activeOrders !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <p className="text-green-200 text-xs mt-4 leading-relaxed max-w-md">
            Your dedicated procurement partner — one supplier, zero hassle. We handle stationery, pantry, hygiene, furniture and more so your team can focus on what matters.
          </p>
        </div>
      </div>

      {/* ── Metric cards (pulled up over hero) — all 4 render instantly from DB ── */}
      <div className="max-w-3xl mx-auto px-4 -mt-8 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

          {/* Total Spent — instant from DB; links to monthly breakdown when invoice data exists */}
          {dbInvoiceCount > 0 ? (
            <Link href="/shop/spending" className="block bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:border-green-200 hover:shadow transition-colors">
              <p className="text-xs text-gray-400 font-medium">Total Spent</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
                {effectiveSpent > 0 ? `MYR ${(effectiveSpent / 1000).toFixed(1)}k` : 'MYR 0'}
              </p>
              {spendRangeLabel && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{spendRangeLabel}</p>}
              <p className="text-[11px] font-semibold text-green-600 mt-1">View breakdown →</p>
            </Link>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs text-gray-400 font-medium">Total Spent</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
                {effectiveSpent > 0 ? `MYR ${(effectiveSpent / 1000).toFixed(1)}k` : 'MYR 0'}
              </p>
              {spendRangeLabel && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{spendRangeLabel}</p>}
            </div>
          )}

          {/* Outstanding — instant from DB (cached QNE balance) */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <p className="text-xs text-gray-400 font-medium">Outstanding</p>
            {dashOutstanding !== null ? (
              <>
                <p className={`text-lg font-bold mt-1 tabular-nums ${dashOutstanding > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                  MYR {dashOutstanding.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                  as of {new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-gray-300 mt-1">—</p>
                <p className="text-[10px] text-gray-400 mt-0.5">contact manager</p>
              </>
            )}
          </div>

          {/* Orders / Invoices — instant from DB */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex flex-col">
            <p className="text-xs text-gray-400 font-medium">{dashCountIsInvoices ? 'Invoices' : 'Orders Placed'}</p>
            <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">{dashCount}</p>
            {!dashCountIsInvoices && totalOrders > 0
              ? <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">all time (portal orders)</p>
              : null}
            {dashCountIsInvoices && (
              <Link href="/shop/invoices" className="mt-auto pt-1.5 text-[11px] font-semibold text-green-600 hover:text-green-700">
                View all invoices →
              </Link>
            )}
          </div>

          {/* My Rewards — static (loyalty launching soon) */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <p className="text-xs text-gray-400 font-medium">My Rewards</p>
            <p className="text-lg font-bold text-gray-300 mt-1">0</p>
            <p className="text-[10px] text-green-500 mt-0.5 font-medium">Loyalty launching soon</p>
          </div>

        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 mt-6 space-y-5">


        {/* ── Loyalty progress bar (if has spend) ───────────────────── */}
        {effectiveSpent > 0 && partnerTier.nextTier && partnerTier.nextAt && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-700">
                {partnerTier.emoji} {partnerTier.tier}
              </p>
              <p className="text-xs text-gray-400">
                Next: <span className="font-semibold text-gray-600">{partnerTier.nextTier} Partner</span> at MYR {partnerTier.nextAt.toLocaleString()}
              </p>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all"
                style={{ width: `${Math.min(100, (effectiveSpent / partnerTier.nextAt) * 100).toFixed(1)}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              MYR {(partnerTier.nextAt - effectiveSpent).toLocaleString('en-MY', { maximumFractionDigits: 0 })} more to reach {partnerTier.nextTier} Partner
            </p>
          </div>
        )}

        {/* ── Smart Reorder ─────────────────────────────────────────── */}
        {smartReorders.length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
              <span className="text-amber-500 text-sm">🔄</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Smart Reorder</p>
                <p className="text-[10px] text-amber-600">Based on your buying pattern — these may be running low</p>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {smartReorders.map(item => (
                <div key={item.productId} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                      item.urgency === 'overdue' ? 'bg-red-500' :
                      item.urgency === 'urgent'  ? 'bg-orange-400' : 'bg-amber-300'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                      <p className="text-[11px] text-gray-400">
                        Last ordered: {item.lastQty} {item.unit ?? 'unit(s)'}
                        {' · '}
                        {item.daysUntilNext <= 0
                          ? <span className="text-red-500 font-medium">Overdue!</span>
                          : item.daysUntilNext === 1
                          ? <span className="text-orange-500 font-medium">Due tomorrow</span>
                          : <span className={item.urgency === 'urgent' ? 'text-orange-500 font-medium' : 'text-gray-500'}>
                              Due in {item.daysUntilNext} days
                            </span>
                        }
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/shop/products/${item.productId}`}
                    className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    Reorder
                  </Link>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-50">
              <Link href="/shop/products" className="text-[11px] text-green-600 hover:text-green-700 hover:underline">
                Browse full catalogue →
              </Link>
            </div>
          </div>
        )}

        {/* ── Recent Orders ─────────────────────────────────────────── */}
        {recentOrders.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">📦</span>
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recent Orders</p>
              </div>
              <Link href="/shop/orders" className="text-[11px] text-green-600 hover:underline">
                View all →
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {recentOrders.map(order => (
                <Link
                  key={order.id}
                  href={`/shop/orders/${order.id}`}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {order.referenceNo ?? `Order ${order.id.slice(0, 8).toUpperCase()}`}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {fmtDate(order.createdAt)} · {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                    <p className="text-xs font-semibold text-gray-800 mt-1 tabular-nums">
                      {fmtMyr(order.totalAmount)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Monthly Spending Chart (CRM orders only — hidden when QNE chart covers it) */}
        {!company?.qneCustomerCode && (() => {
          const hasSpend = monthlySpend.some(m => m.amount > 0)
          const max      = Math.max(...monthlySpend.map(m => m.amount), 1)
          return (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                <span className="text-sm">📈</span>
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Monthly Spending</p>
                <span className="ml-auto text-[10px] text-gray-400">last 6 months</span>
              </div>
              {hasSpend ? (
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-end gap-1.5 h-20">
                    {monthlySpend.map(m => {
                      const heightPct = m.amount > 0 ? Math.max((m.amount / max) * 100, 8) : 2
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5">
                          {m.amount > 0 && (
                            <p className="text-[9px] text-gray-500 font-medium leading-none mb-0.5">
                              {m.amount >= 1000 ? `${(m.amount / 1000).toFixed(1)}k` : Math.round(m.amount).toString()}
                            </p>
                          )}
                          <div
                            className="w-full rounded-t bg-green-500"
                            style={{ height: `${heightPct}%`, opacity: m.amount > 0 ? 1 : 0.15, minHeight: '2px' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    {monthlySpend.map(m => (
                      <p key={m.month} className="flex-1 text-center text-[9px] text-gray-400 truncate">{m.month}</p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-gray-400">No orders yet — your spending history will appear here after your first order.</p>
                  <Link href="/shop/products" className="inline-block mt-3 text-xs font-semibold text-green-600 hover:text-green-700 transition-colors">
                    Browse Products →
                  </Link>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Category Spending Breakdown ───────────────────────────── */}
        {categoryBreak.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
              <span className="text-sm">📊</span>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Your Spending By Category</p>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {categoryBreak.map(cat => (
                <div key={cat.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-700 font-medium">{cat.name}</span>
                    <span className="text-gray-400 tabular-nums">{cat.pct}% · MYR {cat.amount.toLocaleString('en-MY', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${cat.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Quick Reorder ─────────────────────────────────────────── */}
        {/*
          Always shown for B2B clients.
          Opens a slide-in drawer listing all frequently ordered items
          with checkboxes + qty spinners → bulk-adds to cart in one click.
          When there's no order history yet, the drawer shows an empty state.
        */}
        <QuickReorderSection frequentItems={frequentItems} branchOptions={branchOptions} itemsByBranch={itemsByBranch} />

        {/* ── Quick Actions ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/shop/products"
            className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:border-green-300 hover:shadow-md transition-all group"
          >
            <div className="text-2xl mb-2">🛒</div>
            <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 transition-colors">Browse Products</p>
            <p className="text-[11px] text-gray-400 mt-0.5">3,700+ items in stock</p>
          </Link>

          <Link
            href="/shop/quotations"
            className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:border-green-300 hover:shadow-md transition-all group"
          >
            <div className="text-2xl mb-2">📋</div>
            <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 transition-colors">My Quotations</p>
            <p className="text-[11px] text-gray-400 mt-0.5">View &amp; track quotes</p>
          </Link>

          <Link
            href="/shop/orders"
            className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:border-green-300 hover:shadow-md transition-all group"
          >
            <div className="text-2xl mb-2">📦</div>
            <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 transition-colors">My Orders</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Track deliveries</p>
          </Link>

          {spWaHref ? (
            <a
              href={spWaHref}
              target="_blank"
              rel="noreferrer"
              className="bg-green-600 border border-green-600 rounded-xl p-4 shadow-sm hover:bg-green-700 transition-all group"
            >
              <div className="text-2xl mb-2">💬</div>
              <p className="text-sm font-semibold text-white">WhatsApp Manager</p>
              <p className="text-[11px] text-green-200 mt-0.5">Direct line to {salesperson?.name.split(' ')[0]}</p>
            </a>
          ) : (
            <Link
              href="/shop/account"
              className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:border-green-300 hover:shadow-md transition-all group"
            >
              <div className="text-2xl mb-2">👤</div>
              <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 transition-colors">My Account</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Profile &amp; password</p>
            </Link>
          )}
        </div>

        {/* ── "Why Flexxo" Value Strip ──────────────────────────────── */}
        <div className="bg-gradient-to-br from-green-800 to-green-700 rounded-xl p-5 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-green-300 mb-3">Your Flexxo Advantage</p>
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            {[
              { icon: '🏪', title: 'One-Stop Partner',  desc: 'Stationery to furniture — one supplier, one invoice' },
              { icon: '⚡', title: 'Fast Response',      desc: 'WhatsApp your manager, solved within the hour' },
              { icon: '📍', title: 'KL-Based Delivery', desc: 'Reliable, fast fulfilment across Klang Valley' },
              { icon: '🔄', title: 'Smart Reordering',  desc: 'We track your pattern so you never run out' },
            ].map(v => (
              <div key={v.title} className="flex items-start gap-2">
                <span className="text-base shrink-0 mt-0.5">{v.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-white">{v.title}</p>
                  <p className="text-[10px] text-green-200 leading-snug">{v.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Account (change password + sign out) ─────────────────── */}
        <AccountSection />

      </div>
    </div>
  )
}
