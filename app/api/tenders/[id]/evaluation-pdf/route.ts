/**
 * GET /api/tenders/[id]/evaluation-pdf — branded landscape evaluation summary.
 * Access: privileged tender roles (managers/directors/admin/superadmin) + creator.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { renderEvaluationPdf } from '@/lib/tenderPdf'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { pos: 'asc' },
        include: {
          awardedSupplier: { select: { name: true } },
          quotes: { include: { supplier: { select: { name: true } } } },
        },
      },
    },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!isPrivilegedRole(session.role) && tender.createdById !== session.userId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pdf = await renderEvaluationPdf({
    refNo: tender.refNo,
    tenderName: tender.name,
    threshold: tender.varianceThreshold != null ? Number(tender.varianceThreshold) : 5,
    lockedAt: tender.pricesLockedAt,
    items: tender.items.map(it => ({
      pos: it.pos, name: it.name, unit: it.unit, qty: Number(it.qty),
      normalUnitPrice: it.normalUnitPrice != null ? Number(it.normalUnitPrice) : null,
      awardedSupplierName: it.awardedSupplier?.name ?? null,
      awardedUnitPrice: it.awardedUnitPrice != null ? Number(it.awardedUnitPrice) : null,
      quotes: it.quotes.map(q => ({
        supplierName: q.supplier.name,
        quotedUnitPrice: Number(q.quotedUnitPrice),
        variancePct: q.variancePct != null ? Number(q.variancePct) : null,
        flagged: q.flaggedOverThreshold,
      })),
    })),
  })

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${tender.refNo}-evaluation.pdf"`,
    },
  })
}
