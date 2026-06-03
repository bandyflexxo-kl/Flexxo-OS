import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      priceFiles: {
        orderBy: { uploadedAt: 'desc' },
        include: {
          uploadedBy: { select: { name: true } },
          _count: { select: { stagingRows: true } },
        },
      },
    },
  })

  if (!supplier) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({
    ...supplier,
    createdAt:  supplier.createdAt.toISOString(),
    priceFiles: supplier.priceFiles.map(f => ({
      ...f,
      uploadedAt:  f.uploadedAt.toISOString(),
      processedAt: f.processedAt?.toISOString() ?? null,
      stagingCount: f._count.stagingRows,
    })),
  })
}
