/**
 * POST /api/admin/qne/sync-quotations
 * Pulls QNE Quotations (last 2 years) into qne_quotations table.
 * Admin / Director only. Requires Radmin VPN to be active.
 *
 * Body (optional): { from: "2025-01-01" }
 * Returns: { ok, quotationsFetched, quotationsUpserted, itemsUpserted, companiesLinked, errors[] }
 */

import { NextRequest, NextResponse }  from 'next/server'
import { verifySession }              from '@/lib/session'
import { syncQneQuotations }          from '@/lib/qneQuotationSync'
import { QneUnavailableError }        from '@/lib/qneClient'

export async function POST(request: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!['Admin', 'Director', 'Manager'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { from?: string }

  try {
    const result = await syncQneQuotations(body.from)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      return NextResponse.json(
        { error: 'QNE unavailable — ensure Radmin VPN is active.', code: 'QNE_UNAVAILABLE' },
        { status: 503 },
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
