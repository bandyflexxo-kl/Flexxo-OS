import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { normalizeName } from '@/lib/normalize'

const CompanySchema = z.object({
  name: z.string().min(1, { error: 'Name is required.' }),
  industry: z.string().optional(),
  generalEmail: z.string().optional(),
  mainPhone: z.string().optional(),
  leadSource: z.string().optional(),
  leadTemperature: z.string().optional(),
  status: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const status = searchParams.get('status')

  const companies = await prisma.company.findMany({
    where: {
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(status ? { status } : {}),
    },
    select: { id: true, name: true, status: true, leadTemperature: true, industry: true },
    orderBy: { name: 'asc' },
    take: 100,
  })

  return Response.json(companies)
}

export async function POST(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = CompanySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const d = parsed.data
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const company = await prisma.company.create({
    data: {
      name: d.name,
      nameNormalized: normalizeName(d.name),
      industry: d.industry || null,
      generalEmail: d.generalEmail || null,
      mainPhone: d.mainPhone || null,
      leadSource: d.leadSource || null,
      leadTemperature: d.leadTemperature || null,
      status: d.status ?? 'Lead',
      createdById: session.userId,
      updatedAt: new Date(),
    },
  })

  return Response.json(company, { status: 201 })
}
