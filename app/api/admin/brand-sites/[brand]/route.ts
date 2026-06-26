import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ brand: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { brand } = await params
  await prisma.brandSiteOverride.deleteMany({
    where: { brand: decodeURIComponent(brand).toUpperCase() },
  })
  return Response.json({ ok: true })
}
