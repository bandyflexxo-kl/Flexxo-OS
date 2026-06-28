/**
 * Duplicate gate for the New Product modal (SOP §A6). Read-only.
 * GET /api/admin/products/check-duplicate?code=<stockCode>&name=<stockName>
 * Returns matches in QNE + CRM so a human can confirm the item is genuinely new.
 */

import { verifySession } from '@/lib/session'
import { checkStockDuplicates } from '@/lib/qneProductValidation'
import { QneUnavailableError } from '@/lib/qneClient'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const url  = new URL(request.url)
  const code = url.searchParams.get('code')?.trim() ?? ''
  const name = url.searchParams.get('name')?.trim() ?? ''
  if (code.length < 1 && name.length < 3)
    return Response.json({ codeInQne: false, codeInCrm: false, similarNames: [] })

  try {
    const report = await checkStockDuplicates(code, name)
    return Response.json(report)
  } catch (err) {
    if (err instanceof QneUnavailableError)
      return Response.json({ error: 'QNE unreachable — connect the Radmin VPN and retry.' }, { status: 503 })
    return Response.json({ error: err instanceof Error ? err.message : 'Duplicate check failed' }, { status: 502 })
  }
}
