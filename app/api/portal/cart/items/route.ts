import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import { z } from 'zod'
import { Prisma } from '@/app/generated/prisma/client'

const Schema = z.object({
  productId: z.string().uuid(),
  qty:       z.number().int().positive(),
})

export async function POST(request: Request) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return Response.json({ error: 'No company linked to this account.' }, { status: 400 })
  }

  const body   = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { productId, qty } = parsed.data

  // Fetch product + pricing
  const [product, globalSetting] = await Promise.all([
    prisma.product.findUnique({
      where:   { id: productId, isActive: true, isVisibleToCustomers: true },
      include: {
        category:      { select: { defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { id: true, costPrice: true, currency: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } }),
  ])

  if (!product) return Response.json({ error: 'Product not found.' }, { status: 404 })
  if (!product.priceVersions[0]) return Response.json({ error: 'This product has no price set yet.' }, { status: 422 })

  const costPrice    = product.priceVersions[0].costPrice
  const globalMargin = globalSetting?.value ?? '30'
  const unitPrice    = roundPrice(calculateSellingPrice(costPrice, product.defaultMarginPct, product.category.defaultMarginPct, globalMargin))
  const qtyDec       = new Prisma.Decimal(qty)
  const lineTotal    = unitPrice.times(qtyDec)

  // Find or create the cart quotation
  let cart = await prisma.quotation.findFirst({
    where: { status: 'cart', createdById: session.userId },
    select: { id: true },
  })

  if (!cart) {
    cart = await prisma.quotation.create({
      data: {
        companyId:    session.customerCompanyId,
        createdById:  session.userId,
        status:       'cart',
        referenceNo:  `CART-${session.userId.slice(-8)}-${Date.now()}`,
        currency:     product.priceVersions[0].currency,
        versionNumber: 1,
        subtotal:     new Prisma.Decimal(0),
        totalAmount:  new Prisma.Decimal(0),
      },
      select: { id: true },
    })
  }

  // Check if this product is already in the cart — if so, update qty
  const existingItem = await prisma.quotationItem.findFirst({
    where: { quotationId: cart.id, productId },
  })

  if (existingItem) {
    const newQty       = new Prisma.Decimal(qty).plus(existingItem.qty)
    const newLineTotal = unitPrice.times(newQty)
    await prisma.quotationItem.update({
      where: { id: existingItem.id },
      data:  { qty: newQty, lineTotal: newLineTotal },
    })
  } else {
    const itemCount = await prisma.quotationItem.count({ where: { quotationId: cart.id } })
    await prisma.quotationItem.create({
      data: {
        quotationId:            cart.id,
        productId,
        supplierPriceVersionId: product.priceVersions[0].id,
        description:            product.name,
        brand:                  product.brand ?? undefined,
        unit:                   product.unit  ?? undefined,
        qty:                    qtyDec,
        unitCost:               costPrice,
        unitPrice,
        marginPct:              unitPrice.minus(costPrice).dividedBy(unitPrice).times(100),
        lineTotal,
        sortOrder:              itemCount,
      },
    })
  }

  // Recalculate cart totals
  const items      = await prisma.quotationItem.findMany({ where: { quotationId: cart.id } })
  const subtotal   = items.reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0))
  await prisma.quotation.update({
    where: { id: cart.id },
    data:  { subtotal, totalAmount: subtotal },
  })

  return Response.json({ ok: true, cartId: cart.id }, { status: 200 })
}
