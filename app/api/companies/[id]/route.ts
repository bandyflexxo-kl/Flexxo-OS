import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { normalizeName } from '@/lib/normalize'

const UpdateSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  leadTemperature: z.string().optional(),
  industry: z.string().optional(),
  generalEmail: z.string().optional(),
  mainPhone: z.string().optional(),
})

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/companies/[id]'>) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const company = await prisma.company.findUnique({
    where: { id },
    include: { contacts: true, addresses: true },
  })

  if (!company) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(company)
}

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/companies/[id]'>) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json()
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  if (parsed.data.name) data.nameNormalized = normalizeName(parsed.data.name)

  const company = await prisma.company.update({ where: { id }, data })
  return Response.json(company)
}
