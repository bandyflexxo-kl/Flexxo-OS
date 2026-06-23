import { verifySession }    from '@/lib/session'
import { prisma }            from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import type { ProductMatch } from '@/lib/smartOrder'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director', 'Manager', 'Salesperson'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return Response.json({ products: [] })

  const [products, globalSetting] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name:        { contains: q, mode: 'insensitive' } },
          { qneItemCode: { contains: q, mode: 'insensitive' } },
          { brand:       { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ qneInvoiceFreq: 'desc' }, { name: 'asc' }],
      take: 20,
      select: {
        id:                   true,
        name:                 true,
        brand:                true,
        unit:                 true,
        qneItemCode:          true,
        isVisibleToCustomers: true,
        qneInvoiceFreq:       true,
        qneAvailableQty:      true,
        defaultMarginPct:     true,
        category: { select: { name: true, defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { id: true, costPrice: true, currency: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
  ])

  const globalMargin = globalSetting?.value ?? '30'

  const results: ProductMatch[] = products.map(p => {
    const price = p.priceVersions[0] ?? null
    const sellingPrice = price
      ? roundPrice(calculateSellingPrice(price.costPrice, p.defaultMarginPct, p.category.defaultMarginPct, globalMargin)).toString()
      : null

    return {
      id:                     p.id,
      name:                   p.name,
      brand:                  p.brand,
      unit:                   p.unit,
      qneItemCode:            p.qneItemCode,
      categoryName:           p.category.name,
      sellingPrice,
      currency:               price?.currency ?? 'MYR',
      supplierPriceVersionId: price?.id ?? null,
      score:                  1,
      isVisible:              p.isVisibleToCustomers,
      orderFreq:              p.qneInvoiceFreq,
      availableQty:           p.qneAvailableQty ?? null,
    }
  })

  return Response.json({ products: results })
}
