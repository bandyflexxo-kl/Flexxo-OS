import { z }                    from 'zod'
import { verifySession }         from '@/lib/session'
import { prisma }                from '@/lib/prisma'
import { companyOwnerFilter }    from '@/lib/authorization'

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director', 'Manager', 'Salesperson'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const result = schema.safeParse(body)
  if (!result.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { ids } = result.data
  const ownerFilter = companyOwnerFilter(session)

  // Only archive quotations the session user is allowed to see
  const { count } = await prisma.quotation.updateMany({
    where: {
      id:        { in: ids },
      status:    { not: 'cart' },
      company:   ownerFilter,
    },
    data: { isArchived: true },
  })

  return Response.json({ archived: count })
}
