import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { normalizeName } from '@/lib/normalize'
import { assertCompanyAccess, isPrivilegedRole } from '@/lib/authorization'

const UpdateSchema = z.object({
  name:            z.string().min(1).max(300).optional(),
  status:          z.string().optional(),
  leadTemperature: z.string().optional().nullable(),
  industry:        z.string().max(200).optional().nullable(),
  generalEmail:    z.string().max(500).optional().nullable(),
  mainPhone:       z.string().max(50).optional().nullable(),
  regNumber:       z.string().max(100).optional().nullable(),
  tinNumber:       z.string().max(100).optional().nullable(),
  companySize:     z.string().max(50).optional().nullable(),
  website:         z.string().max(500).optional().nullable(),
  leadSource:      z.string().max(100).optional().nullable(),
})

const FIELD_LABELS: Record<string, string> = {
  name:            'Company Name',
  status:          'Status',
  leadTemperature: 'Lead Temperature',
  industry:        'Industry',
  generalEmail:    'General Email',
  mainPhone:       'Main Phone',
  regNumber:       'Registration No.',
  tinNumber:       'TIN Number',
  companySize:     'Company Size',
  website:         'Website',
  leadSource:      'Lead Source',
}

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/companies/[id]'>) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const denied = await assertCompanyAccess(id, session)
  if (denied) return denied

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

  if (!isPrivilegedRole(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const denied = await assertCompanyAccess(id, session)
  if (denied) return denied

  const body = await req.json()
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  // Capture current values to diff for activity log
  const current = await prisma.company.findUnique({
    where: { id },
    select: {
      name: true, status: true, leadTemperature: true, industry: true,
      generalEmail: true, mainPhone: true, regNumber: true, tinNumber: true,
      companySize: true, website: true, leadSource: true,
    },
  })
  if (!current) return Response.json({ error: 'Not found' }, { status: 404 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const data = parsed.data
  const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() }
  if (data.name) updateData.nameNormalized = normalizeName(data.name)

  // Build human-readable diff for activity log
  const changes: string[] = []
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const oldVal = (current as Record<string, string | null>)[key]
    const newVal = (data as Record<string, string | null | undefined>)[key]
    if (newVal !== undefined && String(newVal ?? '') !== String(oldVal ?? '')) {
      changes.push(`${label}: "${oldVal ?? ''}" → "${newVal ?? ''}"`)
    }
  }

  const company = await prisma.company.update({ where: { id }, data: updateData })

  if (changes.length > 0) {
    await prisma.activity.create({
      data: {
        companyId:    id,
        userId:       session.userId,
        activityType: 'note',
        subject:      'Company details updated',
        body:         changes.join('\n'),
      },
    })
  }

  return Response.json(company)
}
