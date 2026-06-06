import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const Schema = z.object({
  visible:    z.boolean(),
  categoryId: z.string().uuid().optional(),
  hasPhoto:   z.boolean().optional(),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body   = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { visible, categoryId, hasPhoto } = parsed.data

  const result = await prisma.product.updateMany({
    where: {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(hasPhoto   ? { googleDrivePhotoId: { not: null } } : {}),
    },
    data: { isVisibleToCustomers: visible },
  })

  return Response.json({ updated: result.count })
}
