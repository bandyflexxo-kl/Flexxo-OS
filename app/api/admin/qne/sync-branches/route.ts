/**
 * POST /api/admin/qne/sync-branches
 * Syncs QNE branch addresses into company_addresses for every company that has a
 * B2B portal account (so Aeon/Muji/OSK… get their branches pre-populated).
 * Customer-edited rows (source='manual') are never overwritten. Requires the
 * Radmin VPN. Admin/Director only.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { syncQneBranches } from '@/lib/qneBranchSync'
import { QneUnavailableError } from '@/lib/qneClient'

export const maxDuration = 60

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Scope to companies that actually have a portal account (the real customers).
  const b2bUsers = await prisma.user.findMany({
    where:  { customerCompanyId: { not: null }, userRoles: { some: { role: { name: 'B2B Client' }, revokedAt: null } } },
    select: { customerCompany: { select: { qneCustomerCode: true } } },
  })
  const codes = [...new Set(b2bUsers.map(u => u.customerCompany?.qneCustomerCode).filter(Boolean) as string[])]

  if (codes.length === 0) return Response.json({ ok: true, companies: 0, created: 0, note: 'No portal customers with a QNE code.' })

  try {
    const result = await syncQneBranches(codes)
    return Response.json({ ...result })
  } catch (err) {
    if (err instanceof QneUnavailableError)
      return Response.json({ error: 'QNE unreachable — connect the Radmin VPN and retry.' }, { status: 503 })
    return Response.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 502 })
  }
}
