import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const products = await prisma.product.findMany({
    where:  { isActive: true, photoUrl: { not: null }, photoQualityFlagged: null },
    select: { id: true },
    orderBy: { name: 'asc' },
  })

  return Response.json({ ids: products.map(p => p.id), total: products.length })
}
