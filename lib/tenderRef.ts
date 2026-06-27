import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Generate the next tender reference: FLX-TDR-YYYY-NNNN.
 * Sequence is per calendar year, based on the count of tenders created this
 * year (same approach as quotation refs). Not collision-proof under heavy
 * concurrency, which is fine for this low-volume, human-driven workflow.
 */
export async function nextTenderRef(): Promise<string> {
  const year = new Date().getFullYear()
  const start = new Date(year, 0, 1)
  const end = new Date(year + 1, 0, 1)
  const count = await prisma.tender.count({
    where: { createdAt: { gte: start, lt: end } },
  })
  return `FLX-TDR-${year}-${String(count + 1).padStart(4, '0')}`
}

/** Sequential supplier PO number: FLX-PO-YYYY-NNNN (per calendar year). */
export async function nextSupplierPoNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const start = new Date(year, 0, 1)
  const end = new Date(year + 1, 0, 1)
  const count = await prisma.supplierPO.count({ where: { issuedAt: { gte: start, lt: end } } })
  return `FLX-PO-${year}-${String(count + 1).padStart(4, '0')}`
}

/** Sequential GRN number: FLX-GRN-YYYY-NNNN (per calendar year). */
export async function nextGrnNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const start = new Date(year, 0, 1)
  const end = new Date(year + 1, 0, 1)
  const count = await prisma.goodsReceipt.count({ where: { receivedAt: { gte: start, lt: end } } })
  return `FLX-GRN-${year}-${String(count + 1).padStart(4, '0')}`
}
