import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { priceRun, buildPartnerMessage, runCode, type PartnerMessageStop } from '@/lib/deliveryRun'

const stopSchema = z.object({
  orderId:      z.string().uuid(),
  zoneId:       z.string().trim().max(40).optional(),
  km:           z.number().int().min(0).max(1000),
  qty:          z.number().int().min(1).max(999),
  address:      z.string().trim().max(400).optional(),
  contactName:  z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(40).optional(),
})

const createRunSchema = z.object({
  mode:  z.enum(['parcel', 'pallet']),
  notes: z.string().trim().max(500).optional(),
  stops: z.array(stopSchema).min(1, 'Add at least one stop').max(20),
})

const PICKUP = process.env.LALAMOVE_PICKUP_ADDRESS
  ?? 'Flexxo Warehouse, Lot 2772F, Jalan Industri 12, 47000 Sungai Buloh, Selangor'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const runs = await prisma.deliveryRun.findMany({
    orderBy: { createdAt: 'desc' },
    take:    50,
    include: { stops: { select: { id: true }, orderBy: { sequence: 'asc' } } },
  })
  return Response.json({
    runs: runs.map(r => ({
      id: r.id, code: runCode(r.id), mode: r.mode, status: r.status,
      maxKm: r.maxKm, totalQty: r.totalQty, priceMyr: r.priceMyr?.toString() ?? null,
      stops: r.stops.length, sentAt: r.sentAt, createdAt: r.createdAt,
    })),
  })
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = createRunSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const { mode, notes, stops } = parsed.data

  // Load the orders behind the stops (company, items, DO ref) and guard their state.
  const orderIds = stops.map(s => s.orderId)
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true, status: true, referenceNo: true, qneDoRef: true,
      company: {
        select: {
          name:      true,
          addresses: { where: { isActive: true }, orderBy: { isDefault: 'desc' }, take: 1,
            select: { line1: true, line2: true, city: true, postcode: true, state: true } },
          contacts:  { where: { isActive: true }, orderBy: { isDecisionMaker: 'desc' }, take: 1,
            select: { name: true, phone: true } },
        },
      },
      items: { select: { qty: true, product: { select: { name: true } } } },
    },
  })
  const byId = new Map(orders.map(o => [o.id, o]))

  for (const s of stops) {
    const o = byId.get(s.orderId)
    if (!o) return Response.json({ error: `Order ${s.orderId} not found` }, { status: 404 })
    if (o.status !== 'Packed')
      return Response.json({ error: `Order ${o.referenceNo ?? o.id} is "${o.status}", not Packed` }, { status: 422 })
  }

  const { maxKm, totalQty, price } = priceRun(mode, stops.map(s => ({ km: s.km, qty: s.qty })))

  // Message stops, in the submitted order.
  const msgStops: PartnerMessageStop[] = stops.map(s => {
    const o = byId.get(s.orderId)!
    const a = o.company.addresses[0]
    const c = o.company.contacts[0]
    return {
      company:      o.company.name,
      doRef:        o.qneDoRef ?? o.referenceNo ?? null,
      address:      s.address || [a?.line1, a?.line2, a?.city, a?.postcode, a?.state].filter(Boolean).join(', '),
      contactName:  s.contactName || c?.name || null,
      contactPhone: s.contactPhone || c?.phone || null,
      qty:          s.qty,
      items:        o.items.map(it => ({ name: it.product?.name ?? 'Item', qty: Number(it.qty) })),
    }
  })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const run = await prisma.deliveryRun.create({
    data: {
      mode, status: 'draft', maxKm, totalQty,
      priceMyr:    new Prisma.Decimal(price),
      notes:       notes ?? null,
      createdById: session.userId,
      stops: {
        create: stops.map((s, i) => ({
          orderId:      s.orderId,
          sequence:     i,
          zone:         s.zoneId ?? null,
          km:           s.km,
          qty:          s.qty,
          address:      msgStops[i].address,
          contactName:  msgStops[i].contactName,
          contactPhone: msgStops[i].contactPhone,
        })),
      },
    },
    select: { id: true },
  })

  const message = buildPartnerMessage({
    runCode: runCode(run.id), mode, maxKm, totalQty, price, pickup: PICKUP, stops: msgStops,
  })
  await prisma.deliveryRun.update({ where: { id: run.id }, data: { messageText: message } })

  return Response.json({
    ok: true,
    run: { id: run.id, code: runCode(run.id), mode, maxKm, totalQty, price, message },
  }, { status: 201 })
}
