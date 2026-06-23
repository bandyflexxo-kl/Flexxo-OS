import { z }               from 'zod'
import { verifySession }    from '@/lib/session'
import { prisma }           from '@/lib/prisma'
import { normaliseAlias }   from '@/lib/smartOrder'

const schema = z.object({
  query:     z.string().min(2).max(200),
  productId: z.string().min(1),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director', 'Manager', 'Salesperson'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const result = schema.safeParse(body)
  if (!result.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { query, productId } = result.data
  const alias = normaliseAlias(query)
  if (alias.length < 2) return Response.json({ error: 'Query too short after normalisation' }, { status: 400 })

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

  await prisma.productAlias.upsert({
    where:  { alias },
    update: { productId, createdById: session.userId },
    create: { alias, productId, createdById: session.userId },
  })

  return Response.json({ ok: true, alias })
}
