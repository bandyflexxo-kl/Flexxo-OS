/**
 * POST /api/admin/qne/sync-portfolio
 * Triggers a QNE portfolio sync — updates outstanding balances and top items.
 * Admin/Manager only. READ-ONLY from QNE (Principle 10).
 */

import { NextResponse }             from 'next/server'
import { verifySession }            from '@/lib/session'
import { isPrivilegedRole }         from '@/lib/authorization'
import { syncPortfolio, QneUnavailableError } from '@/lib/qnePortfolio'
import { z }                        from 'zod'

const Schema = z.object({
  maxInvoices: z.number().int().min(50).max(2000).optional(),
})

export async function POST(req: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) {
    return NextResponse.json({ error: 'Admin or Manager required' }, { status: 403 })
  }

  let maxInvoices = 500
  try {
    const body   = await req.json().catch(() => ({}))
    const parsed = Schema.safeParse(body)
    if (parsed.success && parsed.data.maxInvoices) maxInvoices = parsed.data.maxInvoices
  } catch {
    // use default
  }

  try {
    const result = await syncPortfolio(maxInvoices)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      return NextResponse.json(
        { error: 'QNE unreachable — is Radmin VPN active?', code: 'QNE_UNAVAILABLE' },
        { status: 503 },
      )
    }
    console.error('[sync-portfolio]', err)
    return NextResponse.json(
      { error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
