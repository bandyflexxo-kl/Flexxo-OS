/**
 * Customer-level discounts (B7/#9).
 * GET   → list portal customers (companies with a B2B account) + their discount %.
 * PATCH → update a company's discount % (Admin/Director only).
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Companies that have at least one B2B portal user.
  const b2bUsers = await prisma.user.findMany({
    where:  { customerCompanyId: { not: null }, userRoles: { some: { role: { name: 'B2B Client' }, revokedAt: null } } },
    select: { customerCompanyId: true },
  })
  const companyIds = [...new Set(b2bUsers.map(u => u.customerCompanyId!).filter(Boolean))]

  const companies = await prisma.company.findMany({
    where:   { id: { in: companyIds } },
    select:  { id: true, name: true, discountPct: true },
    orderBy: { name: 'asc' },
  })

  return Response.json({
    companies: companies.map(c => ({ id: c.id, name: c.name, discountPct: c.discountPct ? Number(c.discountPct) : 0 })),
  })
}

const PatchSchema = z.object({
  companyId:   z.string().uuid(),
  discountPct: z.number().min(0, 'Min 0%').max(100, 'Max 100%'),
})

export async function PATCH(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const { companyId, discountPct } = parsed.data

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.company.update({ where: { id: companyId }, data: { discountPct } })
  return Response.json({ ok: true, discountPct })
}
