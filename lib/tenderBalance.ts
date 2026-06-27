import 'server-only'
import { prisma } from '@/lib/prisma'

export type ItemBalance = {
  tenderItemId: string
  name:         string
  unit:         string | null
  awardedQty:   number   // full tender qty (awarded)
  orderedQty:   number   // Σ supplier PO line qty
  deliveredQty: number   // Σ GRN received qty
  openQty:      number   // ordered − delivered (in transit / awaited)
  remainingQty: number   // awarded − ordered (still to order)
  utilisationPct: number // ordered / awarded
  awardedUnitPrice: number | null
}

export type TenderBalance = {
  items: ItemBalance[]
  totalAwardedValue: number
  totalOrderedValue: number
}

/**
 * Live per-item balance for a tender (the single source of truth for the
 * Stage-5 over-order guard and the Stage-6 tracker). Pure read.
 */
export async function getTenderBalance(tenderId: string): Promise<TenderBalance> {
  const items = await prisma.tenderItem.findMany({
    where: { tenderId },
    select: { id: true, name: true, unit: true, qty: true, awardedUnitPrice: true },
    orderBy: { pos: 'asc' },
  })

  const poItems = await prisma.supplierPOItem.findMany({
    where: { supplierPo: { tenderId } },
    select: { tenderItemId: true, qty: true, grnItems: { select: { qtyReceived: true } } },
  })

  const orderedByItem   = new Map<string, number>()
  const deliveredByItem = new Map<string, number>()
  for (const pi of poItems) {
    orderedByItem.set(pi.tenderItemId, (orderedByItem.get(pi.tenderItemId) ?? 0) + Number(pi.qty))
    const recv = pi.grnItems.reduce((s, g) => s + Number(g.qtyReceived), 0)
    deliveredByItem.set(pi.tenderItemId, (deliveredByItem.get(pi.tenderItemId) ?? 0) + recv)
  }

  let totalAwardedValue = 0
  let totalOrderedValue = 0

  const out: ItemBalance[] = items.map(it => {
    const awardedQty   = Number(it.qty)
    const orderedQty   = orderedByItem.get(it.id) ?? 0
    const deliveredQty = deliveredByItem.get(it.id) ?? 0
    const price        = it.awardedUnitPrice != null ? Number(it.awardedUnitPrice) : null
    if (price != null) {
      totalAwardedValue += price * awardedQty
      totalOrderedValue += price * orderedQty
    }
    return {
      tenderItemId: it.id,
      name: it.name,
      unit: it.unit,
      awardedQty,
      orderedQty,
      deliveredQty,
      openQty: orderedQty - deliveredQty,
      remainingQty: awardedQty - orderedQty,
      utilisationPct: awardedQty > 0 ? (orderedQty / awardedQty) * 100 : 0,
      awardedUnitPrice: price,
    }
  })

  return { items: out, totalAwardedValue, totalOrderedValue }
}

/** Remaining-to-order qty per item (used by the Stage-5 over-order guard). */
export async function getRemainingByItem(tenderId: string): Promise<Map<string, number>> {
  const bal = await getTenderBalance(tenderId)
  return new Map(bal.items.map(i => [i.tenderItemId, i.remainingQty]))
}
