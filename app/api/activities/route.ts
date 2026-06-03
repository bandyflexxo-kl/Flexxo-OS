import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { assertCompanyAccess, companyOwnerFilter } from '@/lib/authorization'

const ActivitySchema = z.object({
  companyId: z.string(),
  userId: z.string().optional(),
  contactId: z.string().optional(),
  activityType: z.string(),
  subject: z.string().min(1, { error: 'Subject is required.' }),
  body: z.string().optional(),
  outcome: z.string().optional(),
  direction: z.string().optional(),
  scheduledAt: z.string().optional(),
  followUpAt: z.string().optional(),
  followUpStatus: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = ActivitySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const d = parsed.data
  const denied = await assertCompanyAccess(d.companyId, session)
  if (denied) return denied

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const activity = await prisma.activity.create({
    data: {
      companyId: d.companyId,
      userId: d.userId ?? session.userId,
      contactId: d.contactId || null,
      activityType: d.activityType,
      subject: d.subject,
      body: d.body || null,
      outcome: d.outcome || null,
      direction: d.direction || null,
      scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : null,
      followUpAt: d.followUpAt ? new Date(d.followUpAt) : null,
      followUpStatus: d.followUpStatus || null,
    },
  })

  return Response.json(activity, { status: 201 })
}

export async function GET(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')

  // If filtering by a specific company, verify access first
  if (companyId) {
    const denied = await assertCompanyAccess(companyId, session)
    if (denied) return denied
  }

  const ownerFilter = companyOwnerFilter(session)

  const activities = await prisma.activity.findMany({
    where: companyId
      ? { companyId }
      : { company: ownerFilter },
    include: { user: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return Response.json(activities)
}
