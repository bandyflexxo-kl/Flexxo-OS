/**
 * /shop/dashboard — B2B Client Home
 *
 * Performance architecture:
 *   ─ Fast data (DB): user profile, orders, metrics — rendered immediately
 *   ─ Slow data (QNE via Radmin VPN): balance, invoices, aging — streamed in
 *     via React Suspense so the page is NEVER blocked by a QNE call.
 *
 * Two async Server Components are Suspense-wrapped:
 *   <OutstandingCard>   — Outstanding metric card (streams into the grid)
 *   <QneInvoicesAging>  — Recent Invoices + Aging sections (stream in below)
 *
 * Both call fetchQneFinancialDataCached — Next.js unstable_cache
 * deduplicates concurrent requests with the same key, so QNE is only
 * contacted once per render regardless of how many components need the data.
 */

import { Suspense }              from 'react'
import { redirect }              from 'next/navigation'
import Link                      from 'next/link'
import { prisma }                from '@/lib/prisma'
import { getOptionalShopSession } from '@/lib/session'
import {
  fetchQneFinancialDataCached,
  QneUnavailableError,
}                                from '@/lib/qneFinancial'
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
  if (company) {
    const [cnt, sum] = await Promise.all([
      prisma.qneInvoice.count({ where: { companyId: company.id } }),
      prisma.qneInvoice.aggregate({ where: { companyId: company.id }, _sum: { totalAmount: true } }),
    ])
    dbInvoiceCount = cnt
    dbInvoiceTotal = Number(sum._sum.totalAmount ?? 0)
  }

  // Effective spend prefers real portal orders, else the cached QNE history —
  // so the partner tier / loyalty bar reflect a customer's true volume.
  const effectiveSpent = totalSpent > 0 ? totalSpent : dbInvoiceTotal

  const partnerTier    = getPartnerTier(effectiveSpent)
  const smartReorders  = computeSmartReorders(orders)
  const frequentItems  = computeFrequentItems(orders)
  const categoryBreak  = computeCategoryBreakdown(orders)
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

      {/* ── Metric cards (pulled up over hero) ────────────────────────── */}
      {/*
        3 cards render immediately (DB data).
        Outstanding card streams in via Suspense — shows skeleton while
        QNE financial data loads. No spinner blocks the rest of the page.
      */}
      <div className="max-w-3xl mx-auto px-4 -mt-8 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

          {/* Total Spent — prefers QNE invoice total when CRM is zero */}
          <Suspense fallback={<StatCardSkeleton label="Total Spent" />}>
            <TotalSpentCard
              crmTotal={totalSpent}
              qneCustomerCode={company?.qneCustomerCode}
              fallbackTotal={dbInvoiceTotal}
            />
          </Suspense>

          {/* Orders / Invoices — prefers QNE invoice count when CRM is zero */}
          <Suspense fallback={<StatCardSkeleton label="Invoices" />}>
            <OrdersCard
              crmCount={totalOrders}
              qneCustomerCode={company?.qneCustomerCode}
              fallbackCount={dbInvoiceCount}
            />
          </Suspense>

          {/* Outstanding — streams in from QNE (skeleton while loading) */}
          <Suspense fallback={<OutstandingCardSkeleton />}>
            <OutstandingCard
              qneCustomerCode={company?.qneCustomerCode}
              fallbackBalance={company?.outstandingBalance}
            />
          </Suspense>

          {/* Vouchers — static */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <p className="text-xs text-gray-400 font-medium">Vouchers</p>
            <p className="text-lg font-bold text-gray-300 mt-1">0</p>
            <p className="text-[10px] text-green-500 mt-0.5 font-medium">Loyalty launching soon</p>
          </div>

        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 mt-6 space-y-5">

        {/* ── Payment alert (streams in, shown only if outstanding > 0) ─ */}
        {company?.qneCustomerCode && (
          <Suspense fallback={null}>
            <PaymentAlertBanner qneCustomerCode={company.qneCustomerCode} />
          </Suspense>
        )}

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

        {/* ── Account Manager ───────────────────────────────────────── */}
        {salesperson && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2">
              <span className="text-green-600 text-sm">🤝</span>
              <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Your Dedicated Account Manager</p>
            </div>
            <div className="px-4 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-green-700">
                    {salesperson.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{salesperson.name}</p>
                  <p className="text-xs text-gray-400">Flexxo Account Manager</p>
                  {salesperson.mobileNo && (
                    <p className="text-xs text-gray-500 mt-0.5">{salesperson.mobileNo}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {spWaHref && (
                  <a
                    href={spWaHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.55 4.116 1.517 5.845L0 24l6.338-1.487A11.936 11.936 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.896 0-3.671-.504-5.201-1.385l-.373-.22-3.863.907.921-3.773-.24-.389A9.945 9.945 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                    </svg>
                    WhatsApp
                  </a>
                )}
                {salesperson.mobileNo && (
                  <a
                    href={`tel:${salesperson.mobileNo}`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    📞 Call
                  </a>
                )}
              </div>
            </div>
            <div className="px-4 pb-3">
              <p className="text-[11px] text-gray-400 italic">
                &ldquo;Need something urgently? Missing an item? Special pricing? Reach out directly — we respond within the hour.&rdquo;
              </p>
            </div>
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

        {/* ── QNE invoices + aging — streams in via Suspense ────────── */}
        {/*
          These sections only render when QNE data is available.
          Suspense fallback is null — sections simply don't exist until
          QNE responds (rather than showing a placeholder that "flashes in").
          If QNE is unreachable, QneInvoicesAging returns null — sections
          are silently omitted.
        */}
        {company?.qneCustomerCode && (
          <Suspense fallback={<QneInvoicesSkeleton />}>
            <QneInvoicesAging qneCustomerCode={company.qneCustomerCode} />
          </Suspense>
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

        {/* ── QNE Invoice History — streams in, shown when QNE has data ── */}
        {company?.qneCustomerCode && (
          <Suspense fallback={<QneInvoiceHistorySkeleton />}>
            <QneInvoiceHistory qneCustomerCode={company.qneCustomerCode} />
          </Suspense>
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
        <QuickReorderSection frequentItems={frequentItems} />

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

        {/* No orders yet — onboarding CTA */}
        {totalOrders === 0 && (
          <div className="bg-white border border-dashed border-green-300 rounded-xl p-6 text-center">
            <p className="text-2xl mb-2">👋</p>
            <p className="text-sm font-semibold text-gray-800">Welcome to Flexxo!</p>
            <p className="text-xs text-gray-500 mt-1 mb-4 max-w-xs mx-auto">
              You&rsquo;re all set. Browse our catalogue or reach out to{' '}
              {salesperson?.name?.split(' ')[0] ?? 'your account manager'} to place your first order.
            </p>
            <Link
              href="/shop/products"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors"
            >
              Explore Products →
            </Link>
          </div>
        )}

        {/* ── Account (change password + sign out) ─────────────────── */}
        <AccountSection />

      </div>
    </div>
  )
}

// ── Streaming async Server Components ────────────────────────────────────────
//
// These components are rendered in <Suspense> boundaries in DashboardPage.
// They execute concurrently in the background while the main page HTML is
// already streaming to the client.  When they complete, their HTML is
// flushed into the stream and injected into the correct position in the DOM.
//
// Both call fetchQneFinancialDataCached with the same key — unstable_cache
// deduplicates concurrent requests so QNE is only contacted once.

// ── Stat card skeleton (used while QNE loads) ─────────────────────────────────
function StatCardSkeleton({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm animate-pulse">
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <div className="h-6 bg-gray-200 rounded-md w-20 mt-1 mb-1" />
      <div className="h-2.5 bg-gray-100 rounded-md w-14" />
    </div>
  )
}

// ── Stat card "temporarily unavailable" state ─────────────────────────────────
// Shown when a customer's figures live only in QNE and QNE is unreachable.
// Better than a misleading "MYR 0 / 0 orders" — makes clear the data couldn't
// be loaded right now, rather than implying the customer has spent nothing.
function StatCardUnavailable({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <p className="text-lg font-bold text-gray-300 mt-1">—</p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">Temporarily unavailable</p>
    </div>
  )
}

/** Total Spent card — shows QNE invoice total when CRM is zero */
async function TotalSpentCard({
  crmTotal,
  qneCustomerCode,
  fallbackTotal,
}: {
  crmTotal:         number
  qneCustomerCode:  string | null | undefined
  fallbackTotal:    number
}) {
  let qneTotal: number | null = null
  let isQne = false
  let qneFailed = false

  if (crmTotal === 0 && qneCustomerCode) {
    try {
      const fin  = await fetchQneFinancialDataCached(qneCustomerCode)
      qneTotal   = fin.invoiceStats.totalAmount
      isQne      = true
    } catch { qneFailed = true }
  }

  // Live QNE unreachable (Vercel/localhost have no Radmin VPN) → fall back to the
  // QNE invoice total already synced into our DB, instead of a dead "unavailable".
  const useCached = qneFailed && fallbackTotal > 0
  if (qneFailed && fallbackTotal === 0) return <StatCardUnavailable label="Total Spent" />

  const amount = useCached ? fallbackTotal : isQne ? (qneTotal ?? 0) : crmTotal

  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const days  = Math.round((now.getTime() - start.getTime()) / 86_400_000)
  const rangeLabel = useCached
    ? '⚠ cached · QNE invoice history'
    : isQne
      ? `${start.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })} – today · ${days} days`
      : 'lifetime (portal orders)'

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <p className="text-xs text-gray-400 font-medium">Total Spent</p>
      <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
        {amount > 0 ? `MYR ${(amount / 1000).toFixed(1)}k` : 'MYR 0'}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{rangeLabel}</p>
    </div>
  )
}

/** Orders / Invoices card — shows QNE invoice count when CRM is zero */
async function OrdersCard({
  crmCount,
  qneCustomerCode,
  fallbackCount,
}: {
  crmCount:         number
  qneCustomerCode:  string | null | undefined
  fallbackCount:    number
}) {
  let qneCount: number | null = null
  let isQne = false
  let qneFailed = false

  if (crmCount === 0 && qneCustomerCode) {
    try {
      const fin = await fetchQneFinancialDataCached(qneCustomerCode)
      qneCount  = fin.invoiceStats.count
      isQne     = true
    } catch { qneFailed = true }
  }

  // Live QNE unreachable → fall back to the cached QNE invoice count in our DB.
  const useCached = qneFailed && fallbackCount > 0
  if (qneFailed && fallbackCount === 0) return <StatCardUnavailable label="Orders Placed" />

  const count      = useCached ? fallbackCount : isQne ? (qneCount ?? 0) : crmCount
  const isInvoices = isQne || useCached

  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const days  = Math.round((now.getTime() - start.getTime()) / 86_400_000)
  const rangeLabel = useCached
    ? '⚠ cached · QNE invoices'
    : isQne
      ? `${start.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })} – today · ${days} days`
      : 'all time (portal orders)'

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <p className="text-xs text-gray-400 font-medium">{isInvoices ? 'Invoices' : 'Orders Placed'}</p>
      <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">{count}</p>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{rangeLabel}</p>
    </div>
  )
}

/** QNE invoice history — monthly chart + stats, streams in via Suspense */
async function QneInvoiceHistory({ qneCustomerCode }: { qneCustomerCode: string }) {
  let fin: Awaited<ReturnType<typeof fetchQneFinancialDataCached>>
  try {
    fin = await fetchQneFinancialDataCached(qneCustomerCode)
  } catch {
    return null
  }

  const { monthlySpend, invoiceStats } = fin
  if (!monthlySpend.some(m => m.amount > 0)) return null

  const max = Math.max(...monthlySpend.map(m => m.amount), 1)

  // Month-on-month delta: compare last full month vs the month before it
  // monthlySpend[5] = current month (may be partial), [4] = last full month, [3] = month before
  const currentMonthAmt = monthlySpend[5]?.amount ?? 0
  const prevMonthAmt    = monthlySpend[4]?.amount ?? 0
  const prevPrevAmt     = monthlySpend[3]?.amount ?? 0
  // Use last full month vs month before for a more meaningful delta
  const deltaBase   = prevPrevAmt
  const deltaTarget = prevMonthAmt
  const deltaSign   = deltaTarget >= deltaBase ? 1 : -1
  const deltaPct    = deltaBase > 0 ? Math.abs(((deltaTarget - deltaBase) / deltaBase) * 100) : null
  const prevMonthName = monthlySpend[4]?.month ?? ''
  const prevPrevName  = monthlySpend[3]?.month ?? ''

  // Date range for the 6-month window
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const days  = Math.round((now.getTime() - start.getTime()) / 86_400_000)
  const rangeStr = `${start.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })} – today · ${days} days`

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
        <span className="text-sm">📈</span>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Monthly Spending</p>
        <span className="ml-auto text-[10px] text-green-500 font-medium">● Live from QNE</span>
      </div>

      {/* Summary stats row */}
      <div className="px-4 pt-3 pb-0 flex gap-6 text-xs">
        <div>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">6-Month Total</p>
          <p className="font-bold text-gray-900 text-sm mt-0.5">
            MYR {invoiceStats.totalAmount.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Invoices</p>
          <p className="font-bold text-gray-900 text-sm mt-0.5">{invoiceStats.count}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Avg / Invoice</p>
          <p className="font-bold text-gray-900 text-sm mt-0.5">
            MYR {invoiceStats.count > 0
              ? (invoiceStats.totalAmount / invoiceStats.count).toLocaleString('en-MY', { maximumFractionDigits: 0 })
              : '0'}
          </p>
        </div>
        {/* Month-on-month delta */}
        {deltaPct !== null && prevMonthAmt > 0 && (
          <div className="ml-auto text-right">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
              {prevMonthName} vs {prevPrevName}
            </p>
            <p className={`font-bold text-sm mt-0.5 ${deltaSign >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {deltaSign >= 0 ? '↑' : '↓'} {deltaPct.toFixed(0)}%
            </p>
          </div>
        )}
        {/* Current month spend (partial) */}
        {currentMonthAmt > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
              {monthlySpend[5]?.month} (so far)
            </p>
            <p className="font-bold text-gray-900 text-sm mt-0.5">
              MYR {currentMonthAmt >= 1000 ? `${(currentMonthAmt / 1000).toFixed(1)}k` : currentMonthAmt.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
            </p>
          </div>
        )}
      </div>
      {/* Date range context */}
      <p className="px-4 pt-1.5 text-[10px] text-gray-400">{rangeStr}</p>

      {/* Bar chart */}
      <div className="px-4 pt-3 pb-3">
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
    </div>
  )
}

/** Skeleton for QNE invoice history while loading */
function QneInvoiceHistorySkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
        <div className="h-3 bg-gray-200 rounded w-32" />
        <div className="ml-auto h-2.5 bg-gray-100 rounded w-20" />
      </div>
      <div className="px-4 py-4">
        <div className="flex gap-6 mb-4">
          {[1,2,3].map(i => <div key={i} className="space-y-1"><div className="h-2 bg-gray-100 rounded w-16" /><div className="h-4 bg-gray-200 rounded w-20" /></div>)}
        </div>
        <div className="flex items-end gap-1.5 h-20">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="flex-1 rounded-t bg-gray-100" style={{ height: `${[40,65,30,80,55,70][i-1]}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Outstanding metric card — streams in live QNE balance */
async function OutstandingCard({
  qneCustomerCode,
  fallbackBalance,
}: {
  qneCustomerCode: string | null | undefined
  fallbackBalance:  Decimal | null | undefined
}) {
  let outstanding: number | null = null
  let paymentTerm: string | null = null
  let isCached = false

  if (qneCustomerCode) {
    try {
      const fin = await fetchQneFinancialDataCached(qneCustomerCode)
      outstanding = fin.customer.currentBalance
      paymentTerm = fin.customer.paymentTerm
    } catch (e) {
      if (e instanceof QneUnavailableError && fallbackBalance != null) {
        outstanding = Number(fallbackBalance)
        isCached = true
      }
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <p className="text-xs text-gray-400 font-medium">Outstanding</p>
      {outstanding !== null ? (
        <>
          <p className={`text-lg font-bold mt-1 tabular-nums ${outstanding > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            MYR {outstanding.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
            {isCached ? '⚠ cached' : '● live'} · as of {new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
            {paymentTerm && ` · ${paymentTerm}`}
          </p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-300 mt-1">—</p>
          <p className="text-[10px] text-gray-400 mt-0.5">contact manager</p>
        </>
      )}
    </div>
  )
}

/** Skeleton placeholder shown in the Outstanding card slot while QNE loads */
function OutstandingCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm animate-pulse">
      <p className="text-xs text-gray-400 font-medium">Outstanding</p>
      <div className="h-6 bg-gray-200 rounded-md w-20 mt-1 mb-1" />
      <div className="h-2.5 bg-gray-100 rounded-md w-14" />
    </div>
  )
}

/** Single invoice table row — module-level to avoid defining components inside async functions */
function InvoiceTableRow({ inv }: {
  inv: { invoiceNo: string; invoiceDate: string; dueDate: string | null; amount: number }
}) {
  const overdue = inv.dueDate && new Date(inv.dueDate) < new Date()
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="px-4 py-2.5 font-mono text-gray-800">{inv.invoiceNo}</td>
      <td className="px-4 py-2.5 text-gray-500">
        {inv.invoiceDate
          ? new Date(inv.invoiceDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
          : '—'}
      </td>
      <td className={`px-4 py-2.5 font-medium ${overdue ? 'text-red-600' : 'text-gray-600'}`}>
        {inv.dueDate
          ? new Date(inv.dueDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
          : '—'}
        {overdue && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1 py-0.5 rounded">Overdue</span>}
      </td>
      <td className="px-4 py-2.5 text-right font-semibold text-gray-800">
        MYR {inv.amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
    </tr>
  )
}

/** QNE invoice table + aging breakdown — streams in after fast content */
async function QneInvoicesAging({ qneCustomerCode }: { qneCustomerCode: string }) {
  let fin: Awaited<ReturnType<typeof fetchQneFinancialDataCached>>
  try {
    fin = await fetchQneFinancialDataCached(qneCustomerCode)
  } catch {
    return null // QNE unreachable — sections silently omitted
  }

  const allInvoices    = fin.recentInvoices
  const topInvoices    = allInvoices.slice(0, 10)
  const olderInvoices  = allInvoices.slice(10)
  const aging          = fin.aging

  if (allInvoices.length === 0 && (!aging || aging.totalOutstanding === 0)) return null

  return (
    <>
      {/* ── Recent Invoices ──────────────────────────────────────── */}
      {allInvoices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">🧾</span>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Recent Invoices
                <span className="ml-1.5 font-normal text-gray-400">({allInvoices.length} total)</span>
              </p>
            </div>
            <span className="text-[10px] text-green-500 font-medium">● Live from QNE</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-50">
                <th className="px-4 py-2 text-left font-medium">Invoice</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Due</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {topInvoices.map(inv => <InvoiceTableRow key={inv.invoiceNo} inv={inv} />)}
            </tbody>
          </table>

          {/* Expandable older invoices */}
          {olderInvoices.length > 0 && (
            <details className="group">
              <summary className="px-4 py-2.5 text-xs text-green-600 font-medium cursor-pointer hover:bg-gray-50 border-t border-gray-50 flex items-center gap-1 select-none list-none [&::-webkit-details-marker]:hidden">
                <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                View all {olderInvoices.length} older invoices
              </summary>
              <table className="w-full text-xs">
                <tbody>
                  {olderInvoices.map(inv => <InvoiceTableRow key={inv.invoiceNo} inv={inv} />)}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {/* ── Aging Breakdown + Credit Limit ──────────────────────── */}
      {aging && aging.totalOutstanding > 0 && (() => {
        const total = aging.totalOutstanding || 1
        const bars: { label: string; val: number; color: string }[] = [
          { label: 'Current', val: aging.current,        color: 'bg-green-400' },
          { label: '1–30d',   val: aging.overdue30,      color: 'bg-yellow-400' },
          { label: '31–60d',  val: aging.overdue60,      color: 'bg-orange-400' },
          { label: '61–90d',  val: aging.overdue90,      color: 'bg-red-400' },
          { label: '90d+',    val: aging.overdueAbove90, color: 'bg-red-600' },
        ].filter(b => b.val > 0)

        return (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">📅</span>
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Payment Aging</p>
              </div>
              <span className="text-[10px] text-green-500 font-medium">● Live from QNE</span>
            </div>
            <div className="px-4 py-4">
              <div className="h-3 rounded-full overflow-hidden flex mb-3">
                {bars.map(b => (
                  <div
                    key={b.label}
                    className={`${b.color} h-full transition-all`}
                    style={{ width: `${Math.round((b.val / total) * 100)}%` }}
                    title={`${b.label}: MYR ${b.val.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {bars.map(b => (
                  <div key={b.label} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${b.color}`} />
                    <span className="text-[11px] text-gray-500">{b.label}</span>
                    <span className="text-[11px] font-semibold text-gray-700 ml-auto tabular-nums">
                      MYR {b.val.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                ))}
              </div>
              {aging.creditLimit !== null && aging.creditLimit > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-50">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-500 font-medium">Credit Utilisation</span>
                    <span className="tabular-nums text-gray-700 font-semibold">
                      MYR {aging.totalOutstanding.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                      {' / '}
                      MYR {aging.creditLimit.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        aging.totalOutstanding / aging.creditLimit > 0.8 ? 'bg-red-500' :
                        aging.totalOutstanding / aging.creditLimit > 0.5 ? 'bg-amber-400' : 'bg-green-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.round((aging.totalOutstanding / aging.creditLimit) * 100))}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {Math.round((aging.totalOutstanding / aging.creditLimit) * 100)}% of credit limit used
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </>
  )
}

/**
 * Payment alert banner — streams in via Suspense, renders only when outstanding > 0.
 * Shows: total owed, oldest overdue invoice, 90d+ bucket if any.
 */
async function PaymentAlertBanner({ qneCustomerCode }: { qneCustomerCode: string }) {
  let fin: Awaited<ReturnType<typeof fetchQneFinancialDataCached>>
  try {
    fin = await fetchQneFinancialDataCached(qneCustomerCode)
  } catch {
    return null
  }

  const outstanding = fin.customer.currentBalance
  if (!outstanding || outstanding <= 0) return null

  const aging = fin.aging

  // Find oldest overdue invoice from stored invoices
  const today = new Date()
  const overdueInvoices = fin.recentInvoices.filter(
    inv => inv.dueDate && new Date(inv.dueDate) < today
  )
  const oldestOverdue = overdueInvoices.sort(
    (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()
  )[0]

  const has90d  = aging && aging.overdueAbove90 > 0
  const hasOver = overdueInvoices.length > 0 || has90d

  return (
    <div className={`rounded-xl px-4 py-3.5 flex items-start gap-3 border ${
      has90d         ? 'bg-red-50 border-red-200'
      : hasOver      ? 'bg-amber-50 border-amber-200'
      :                'bg-blue-50 border-blue-200'
    }`}>
      <span className={`text-base mt-0.5 shrink-0 ${has90d ? 'text-red-500' : hasOver ? 'text-amber-500' : 'text-blue-500'}`}>
        {has90d ? '🔴' : hasOver ? '⚠️' : 'ℹ️'}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${has90d ? 'text-red-900' : hasOver ? 'text-amber-900' : 'text-blue-900'}`}>
          MYR {outstanding.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding balance
        </p>
        <div className={`text-xs mt-0.5 space-y-0.5 ${has90d ? 'text-red-700' : hasOver ? 'text-amber-700' : 'text-blue-700'}`}>
          {oldestOverdue && (
            <p>
              Oldest overdue: <span className="font-medium">{oldestOverdue.invoiceNo}</span>
              {' — due '}
              <span className="font-medium">
                {new Date(oldestOverdue.dueDate!).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </p>
          )}
          {has90d && aging && (
            <p className="font-medium text-red-700">
              MYR {aging.overdueAbove90.toLocaleString('en-MY', { maximumFractionDigits: 0 })} is 90+ days overdue — please settle urgently
            </p>
          )}
          {!hasOver && (
            <p>All invoices are current — thank you!</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Skeleton shown while QNE invoices + aging load */
function QneInvoicesSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-3 bg-gray-200 rounded w-32" />
      </div>
      <div className="px-4 py-4 space-y-2.5">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 bg-gray-200 rounded flex-1" />
            <div className="h-3 bg-gray-100 rounded w-12" />
            <div className="h-3 bg-gray-100 rounded w-12" />
            <div className="h-3 bg-gray-200 rounded w-20 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
