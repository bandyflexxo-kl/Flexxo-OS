import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { z }             from 'zod'

const UpsertSchema = z.object({
  brand: z.string().trim().min(1),
  site:  z.string().trim().optional().nullable(),
  hint:  z.string().trim().optional().nullable(),
})

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const overrides = await prisma.brandSiteOverride.findMany({
    orderBy: { brand: 'asc' },
  })
  return Response.json({ overrides })
}

export async function POST(req: Request) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body   = await req.json()
  const parsed = UpsertSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { brand, site, hint } = parsed.data
  const override = await prisma.brandSiteOverride.upsert({
    where:  { brand: brand.toUpperCase() },
    update: { site: site ?? null, hint: hint ?? null },
    create: { brand: brand.toUpperCase(), site: site ?? null, hint: hint ?? null },
  })
  return Response.json({ override })
}
