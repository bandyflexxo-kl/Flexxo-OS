import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const Schema = z.object({
  catalogDescription:   z.string().optional(),
  defaultMarginPct:     z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  googleDrivePhotoId:   z.string().optional().nullable(),
  isVisibleToCustomers: z.boolean().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body   = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

  const data = parsed.data
  await prisma.product.update({
    where: { id },
    data: {
      ...(data.catalogDescription   !== undefined ? { catalogDescription:   data.catalogDescription   } : {}),
      ...(data.defaultMarginPct     !== undefined ? { defaultMarginPct:     data.defaultMarginPct ?? null } : {}),
      ...(data.googleDrivePhotoId   !== undefined ? { googleDrivePhotoId:   data.googleDrivePhotoId ?? null } : {}),
      ...(data.isVisibleToCustomers !== undefined ? { isVisibleToCustomers: data.isVisibleToCustomers } : {}),
    },
  })

  return Response.json({ ok: true })
}
