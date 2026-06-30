import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/portal/reorder/by-branch?branchId={id|all}
 * Items previously purchased by this company — optionally scoped to one delivery
 * branch (Phase 5). Merges QNE invoice history (matched on the invoice's
 * branchCode == the branch's qneBranchCode) with portal orders (matched on the
 * order's quotation.deliveryAddressId). Grouped by product → reorder list.
 */
const CAP = 1500   // bound the per-request scan

type FreqItem = { productId: string; name: string; unit: string | null; orderCount: number; lastQty: number }

export async function GET(request: Request) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.customerCompanyId) return Response.json({ error: 'No company linked.' }, { status: 400 })

  const companyId = session.customerCompanyId
  const branchId  = new URL(request.url).searchParams.get('branchId') ?? 'all'

  // Resolve a specific branch → its QNE branch code (for invoice matching).
  let qneBranchCode: string | null = null
  if (branchId !== 'all') {
    const addr = await prisma.companyAddress.findFirst({
      where:  { id: branchId, companyId },
      select: { qneBranchCode: true },
    })
    if (!addr) return Response.json({ items: [] })
    qneBranchCode = addr.qneBranchCode
  }

  const map = new Map<string, { name: string; unit: string | null; orderCount: number; lastQty: number; lastDate: number }>()
  const add = (productId: string | null, name: string, unit: string | null, qty: number, dateMs: number) => {
    if (!productId) return
    const e = map.get(productId)
    if (!e) { map.set(productId, { name, unit, orderCount: 1, lastQty: qty, lastDate: dateMs }); return }
    e.orderCount++
    if (dateMs > e.lastDate) { e.lastDate = dateMs; e.lastQty = qty }
  }

  // 1) QNE invoice history. For a specific branch, only run if we have its code.
  const invoiceWhere =
    branchId === 'all'        ? { companyId } :
    qneBranchCode             ? { companyId, branchCode: qneBranchCode } :
    null
  if (invoiceWhere) {
    const invItems = await prisma.qneInvoiceItem.findMany({
      where:   { productId: { not: null }, invoice: invoiceWhere },
      select:  { productId: true, qty: true, invoice: { select: { docDate: true } }, product: { select: { name: true, unit: true } } },
      orderBy: { invoice: { docDate: 'desc' } },
      take:    CAP,
    })
    for (const it of invItems) {
      if (it.product) add(it.productId, it.product.name, it.product.unit, Number(it.qty), new Date(it.invoice.docDate).getTime())
    }
  }

  // 2) Portal orders (matched on the chosen delivery branch).
  const orderWhere =
    branchId === 'all'
      ? { companyId }
      : { companyId, quotation: { deliveryAddressId: branchId } }
  const orderItems = await prisma.orderItem.findMany({
    where:   { productId: { not: null }, order: orderWhere },
    select:  { productId: true, qty: true, order: { select: { createdAt: true } }, product: { select: { name: true, unit: true } } },
    orderBy: { order: { createdAt: 'desc' } },
    take:    CAP,
  })
  for (const it of orderItems) {
    if (it.product) add(it.productId, it.product.name, it.product.unit, Number(it.qty), new Date(it.order.createdAt).getTime())
  }

  const items: FreqItem[] = [...map.entries()]
    .map(([productId, v]) => ({ productId, name: v.name, unit: v.unit, orderCount: v.orderCount, lastQty: Math.max(1, Math.round(v.lastQty)) }))
    .sort((a, b) => b.orderCount - a.orderCount)

  return Response.json({ items })
}
