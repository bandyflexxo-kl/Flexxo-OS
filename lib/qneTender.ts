import 'server-only'
import { qneLogin, qnePost } from '@/lib/qneClient'

/**
 * Create a QNE Project representing a tender (one tender = one project).
 * The project code becomes the join key on every downstream PO/GRN/SO so QNE's
 * own reporting rolls the whole tender up. Uses the tender ref as projectCode.
 *
 * Gated by caller (tender.qne_writes_enabled) and rule #13 (double approval).
 * Returns the QNE project code on success; throws on failure (caller decides
 * whether to treat as fatal).
 */
export async function createQneTenderProject(t: {
  refNo: string
  name: string
  estValue: number | null
  periodStart: Date | null
  periodEnd: Date | null
}): Promise<string> {
  const token = await qneLogin()
  const body = {
    projectCode:      t.refNo,
    description:      t.name,
    contractSum:      t.estValue ?? 0,
    startDate:        (t.periodStart ?? new Date()).toISOString(),
    projectedEndDate: t.periodEnd ? t.periodEnd.toISOString() : undefined,
    isActive:         true,
  }
  await qnePost('/Projects', token, body)
  return t.refNo
}
