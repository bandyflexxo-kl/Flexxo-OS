import { verifySession }       from '@/lib/session'
import { prisma }              from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const denied = await assertCompanyAccess(id, session)
  if (denied) return denied

  // Prefer the default (isDefault=true) address; fall back to first active address
  const address = await prisma.companyAddress.findFirst({
    where:   { companyId: id, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select:  { line1: true, line2: true, city: true, state: true, postcode: true, country: true },
  })

  if (!address) return Response.json({ address: null })

  const parts = [address.line1, address.line2, address.city, address.state, address.postcode, address.country]
  const formatted = parts.filter(Boolean).join(', ')

  return Response.json({ address: formatted || null })
}
