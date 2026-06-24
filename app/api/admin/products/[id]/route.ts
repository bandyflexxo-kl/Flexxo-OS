import { verifySession }             from '@/lib/session'
import { prisma }                    from '@/lib/prisma'
import { invalidateSmartOrderCache } from '@/lib/smartOrder'
import { Prisma }                    from '@/app/generated/prisma/client'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director', 'Manager', 'Salesperson'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const rawPrice = body.customSellingPrice
  const customSellingPrice =
    rawPrice === null || rawPrice === undefined
      ? null
      : new Prisma.Decimal(String(rawPrice))

  if (
    customSellingPrice !== null &&
    (customSellingPrice.lessThanOrEqualTo(0) || !customSellingPrice.isFinite())
  ) {
    return Response.json({ error: 'Price must be a positive number' }, { status: 400 })
  }

  await prisma.product.update({
    where: { id },
    data:  { customSellingPrice },
  })

  await invalidateSmartOrderCache()

  return Response.json({ ok: true })
}
