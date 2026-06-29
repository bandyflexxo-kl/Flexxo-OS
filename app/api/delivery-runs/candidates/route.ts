import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { zoneForPostcode } from '@/lib/deliveryZones'

/**
 * Packed orders available to add to a private-partner delivery run: status = Packed
 * and not already on an active run. Each row carries a suggested zone/km (from the
 * default address postcode) that the admin confirms when compiling the run.
 */
export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Orders already committed to a non-cancelled run — exclude them.
  const onRun = await prisma.deliveryRunStop.findMany({
    where:  { run: { status: { in: ['draft', 'dispatched'] } } },
    select: { orderId: true },
  })
  const taken = new Set(onRun.map(s => s.orderId))

  const orders = await prisma.order.findMany({
    where:   { status: 'Packed' },
    orderBy: { createdAt: 'asc' },
    select: {
      id:            true,
      referenceNo:   true,
      qneDoRef:      true,
      company: {
        select: {
          name:      true,
          addresses: { where: { isActive: true }, orderBy: { isDefault: 'desc' }, take: 1,
            select: { line1: true, line2: true, city: true, state: true, postcode: true } },
          contacts:  { where: { isActive: true }, orderBy: { isDecisionMaker: 'desc' }, take: 1,
            select: { name: true, phone: true } },
        },
      },
      items: {
        select: { qty: true, product: { select: { name: true } } },
      },
    },
  })

  const rows = orders
    .filter(o => !taken.has(o.id))
    .map(o => {
      const a = o.company.addresses[0]
      const c = o.company.contacts[0]
      const address = [a?.line1, a?.line2, a?.city, a?.postcode, a?.state].filter(Boolean).join(', ')
      const zone = zoneForPostcode(a?.postcode)
      return {
        orderId:         o.id,
        doRef:           o.qneDoRef ?? o.referenceNo ?? null,
        company:         o.company.name,
        address,
        postcode:        a?.postcode ?? null,
        suggestedZoneId: zone?.id ?? 'custom',
        suggestedKm:     zone?.km ?? 0,
        contactName:     c?.name ?? null,
        contactPhone:    c?.phone ?? null,
        items:           o.items.map(it => ({ name: it.product?.name ?? 'Item', qty: Number(it.qty) })),
      }
    })

  return Response.json({ candidates: rows })
}
