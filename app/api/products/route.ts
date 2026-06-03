/**
 * GET /api/products?q=search
 * Internal product search for quotation builder (salesperson typeahead).
 * Returns active products with current cost price.
 * Accessible to: Admin, Manager, Salesperson.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''

  if (q.length < 2) return Response.json([])

  const [products, globalSetting] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name:        { contains: q, mode: 'insensitive' } },
          { brand:       { contains: q, mode: 'insensitive' } },
          { qneItemCode: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: {
        category: { select: { id: true, name: true, defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { id: true, costPrice: true, currency: true },
        },
      },
      orderBy: { name: 'asc' },
      take:    20,
    }),
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
  ])

  const globalMargin = globalSetting?.value ?? '30'

  return Response.json(products.map(p => {
    const price    = p.priceVersions[0] ?? null
    const selling  = price
      ? roundPrice(calculateSellingPrice(price.costPrice, p.defaultMarginPct, p.category.defaultMarginPct, globalMargin))
      : null

    return {
      id:                    p.id,
      name:                  p.name,
      brand:                 p.brand,
      unit:                  p.unit,
      qneItemCode:           p.qneItemCode,
      categoryName:          p.category.name,
      costPrice:             price?.costPrice.toString() ?? null,
      sellingPrice:          selling?.toString()         ?? null,
      currency:              price?.currency             ?? 'MYR',
      supplierPriceVersionId: price?.id                 ?? null,
    }
  }))
}
