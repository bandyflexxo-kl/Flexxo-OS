import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [products, globalSetting] = await Promise.all([
    prisma.product.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true, defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { costPrice: true, currency: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
  ])

  const globalMargin = globalSetting?.value ?? '30'

  return Response.json(products.map(p => {
    const costPrice = p.priceVersions[0]?.costPrice ?? null
    const sellingPrice = costPrice
      ? roundPrice(calculateSellingPrice(costPrice, p.defaultMarginPct, p.category.defaultMarginPct, globalMargin))
      : null

    return {
      id:                   p.id,
      name:                 p.name,
      brand:                p.brand,
      unit:                 p.unit,
      internalSku:          p.internalSku,
      qneItemCode:          p.qneItemCode,
      category:             { id: p.category.id, name: p.category.name },
      catalogDescription:   p.catalogDescription,
      defaultMarginPct:     p.defaultMarginPct?.toString() ?? null,
      googleDrivePhotoId:   p.googleDrivePhotoId,
      isVisibleToCustomers: p.isVisibleToCustomers,
      costPrice:            costPrice?.toString() ?? null,
      sellingPrice:         sellingPrice?.toString() ?? null,
      currency:             p.priceVersions[0]?.currency ?? 'MYR',
    }
  }))
}
