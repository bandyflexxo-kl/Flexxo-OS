/**
 * /api/admin/products/catalog-health — data + bulk actions for the Catalog
 * Health tab on /admin/products.
 *
 * Definitions (all limited to isActive products):
 * - DEAD STOCK      : zero QNE invoice lines (2-year synced window) AND zero
 *                     portal orders. Candidates to hide from the online shop.
 * - FLAGGED         : photoQualityFlagged=true (photo review found no good photo)
 *                     and still visible in the shop.
 * - FREQUENT-BUY    : qneInvoiceFreq >= FREQ_MIN or has portal orders. These MUST
 *                     stay visible in the shop — bulk hide actions skip them, and
 *                     the tab surfaces any currently hidden so they can be re-shown.
 *
 * Restock data (purchase invoices) is not synced from QNE yet, so "not restocked
 * since 2023" is approximated by "no sales in the synced window + current QNE qty"
 * — the qty column lets the admin spot sitting stock vs genuinely dead items.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { invalidateProductsCache } from '@/lib/products-api'
import { invalidateSmartOrderCache } from '@/lib/smartOrder'
import type { Prisma } from '@/generated/prisma/client'
import { z } from 'zod'

/** Visibility changed → bust the shop's 24h Redis catalogue + Smart Order caches. */
async function bustCaches(): Promise<void> {
  await Promise.all([invalidateProductsCache(), invalidateSmartOrderCache()])
}

export const maxDuration = 60

const FREQ_MIN  = 3     // invoices in the 2-yr window to count as "frequent buy"
const ROW_CAP   = 500   // max rows shipped to the client per section

const frequentWhere: Prisma.ProductWhereInput = {
  OR: [
    { qneInvoiceFreq: { gte: FREQ_MIN } },
    { orderItems: { some: {} } },
  ],
}

const deadStockWhere: Prisma.ProductWhereInput = {
  isActive: true,
  qneInvoiceItems: { none: {} },
  orderItems:      { none: {} },
}

const rowSelect = {
  id: true, name: true, brand: true, qneItemCode: true,
  qneAvailableQty: true, qneInvoiceFreq: true, isVisibleToCustomers: true,
  photoUrl: true, googleDrivePhotoId: true, photoQualityFlagged: true,
  category: { select: { name: true, parentCategory: { select: { name: true } } } },
  _count: { select: { orderItems: true } },
} satisfies Prisma.ProductSelect

type RawRow = {
  id: string; name: string; brand: string | null; qneItemCode: string | null
  qneAvailableQty: number | null; qneInvoiceFreq: number; isVisibleToCustomers: boolean
  photoUrl: string | null; googleDrivePhotoId: string | null; photoQualityFlagged: boolean | null
  category: { name: string; parentCategory: { name: string } | null }
  _count: { orderItems: number }
}

function toRow(p: RawRow) {
  return {
    id:          p.id,
    name:        p.name,
    brand:       p.brand,
    qneItemCode: p.qneItemCode,
    qty:         p.qneAvailableQty,
    invoiceFreq: p.qneInvoiceFreq,
    portalOrders: p._count.orderItems,
    visible:     p.isVisibleToCustomers,
    hasPhoto:    !!(p.photoUrl || p.googleDrivePhotoId),
    flagged:     p.photoQualityFlagged === true,
    categoryName: p.category.parentCategory ? `${p.category.parentCategory.name} › ${p.category.name}` : p.category.name,
  }
}

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [deadTotal, deadVisible, deadRows, flaggedTotal, flaggedVisible, flaggedVisibleRows, freqHiddenTotal, freqHiddenRows] = await Promise.all([
    prisma.product.count({ where: deadStockWhere }),
    prisma.product.count({ where: { ...deadStockWhere, isVisibleToCustomers: true } }),
    prisma.product.findMany({
      where:   { ...deadStockWhere, isVisibleToCustomers: true },
      select:  rowSelect,
      orderBy: [{ qneAvailableQty: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      take:    ROW_CAP,
    }),
    prisma.product.count({ where: { isActive: true, photoQualityFlagged: true } }),
    prisma.product.count({ where: { isActive: true, photoQualityFlagged: true, isVisibleToCustomers: true } }),
    prisma.product.findMany({
      where:   { isActive: true, photoQualityFlagged: true, isVisibleToCustomers: true },
      select:  rowSelect,
      orderBy: { name: 'asc' },
      take:    ROW_CAP,
    }),
    prisma.product.count({ where: { isActive: true, isVisibleToCustomers: false, ...frequentWhere } }),
    prisma.product.findMany({
      where:   { isActive: true, isVisibleToCustomers: false, ...frequentWhere },
      select:  rowSelect,
      orderBy: { qneInvoiceFreq: 'desc' },
      take:    ROW_CAP,
    }),
  ])

  return Response.json({
    freqMin: FREQ_MIN,
    rowCap:  ROW_CAP,
    deadStock: { total: deadTotal, visible: deadVisible, rows: deadRows.map(toRow) },
    flagged:   { total: flaggedTotal, visible: flaggedVisible, rows: flaggedVisibleRows.map(toRow) },
    frequentHidden: { total: freqHiddenTotal, rows: freqHiddenRows.map(toRow) },
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide-dead-stock') }),
  z.object({ action: z.literal('hide-flagged') }),
  z.object({ action: z.literal('show-frequent') }),
  z.object({ action: z.literal('hide-one'), productId: z.string().uuid() }),
  z.object({ action: z.literal('show-one'), productId: z.string().uuid() }),
])

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const body = parsed.data

  // Rule: the shop MUST include all frequent-buy products, so bulk hides always
  // exclude them (NOT frequentWhere) and report how many were protected.
  if (body.action === 'hide-dead-stock') {
    const guard = await prisma.product.count({ where: { ...deadStockWhere, isVisibleToCustomers: true, ...frequentWhere } })
    const r = await prisma.product.updateMany({
      where: { ...deadStockWhere, isVisibleToCustomers: true, NOT: frequentWhere },
      data:  { isVisibleToCustomers: false },
    })
    await bustCaches()
    return Response.json({ updated: r.count, protected: guard })
  }

  if (body.action === 'hide-flagged') {
    const guard = await prisma.product.count({ where: { isActive: true, photoQualityFlagged: true, isVisibleToCustomers: true, ...frequentWhere } })
    const r = await prisma.product.updateMany({
      where: { isActive: true, photoQualityFlagged: true, isVisibleToCustomers: true, NOT: frequentWhere },
      data:  { isVisibleToCustomers: false },
    })
    await bustCaches()
    return Response.json({ updated: r.count, protected: guard })
  }

  if (body.action === 'show-frequent') {
    const r = await prisma.product.updateMany({
      where: { isActive: true, isVisibleToCustomers: false, ...frequentWhere },
      data:  { isVisibleToCustomers: true },
    })
    await bustCaches()
    return Response.json({ updated: r.count, protected: 0 })
  }

  // Single-row toggles — explicit admin choice on one product, no guard.
  const visible = body.action === 'show-one'
  await prisma.product.update({ where: { id: body.productId }, data: { isVisibleToCustomers: visible } })
  await bustCaches()
  return Response.json({ updated: 1, protected: 0 })
}
