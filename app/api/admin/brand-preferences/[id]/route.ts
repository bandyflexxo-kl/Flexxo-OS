/**
 * PUT    /api/admin/brand-preferences/[id]  — update a rule
 * DELETE /api/admin/brand-preferences/[id]  — delete a rule
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { invalidateCatalogueCache } from '@/lib/smartOrder'

const ALLOWED_ROLES = new Set(['Admin', 'Manager', 'Director'])

const UpdateSchema = z.object({
  label:           z.string().min(1).max(120).optional(),
  keywords:        z.string().min(1).max(500).optional(),
  brands:          z.string().min(1).max(500).optional(),
  boostMultiplier: z.number().min(1.0).max(5.0).optional(),
  isActive:        z.boolean().optional(),
})

async function requirePrivileged() {
  const session = await verifySession().catch(() => null)
  if (!session) return null
  if (!ALLOWED_ROLES.has(session.role)) return null
  return session
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePrivileged()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body: unknown = await request.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  try {
    const pref = await prisma.productBrandPreference.update({ where: { id }, data: parsed.data })
    invalidateCatalogueCache()
    return Response.json({ pref })
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePrivileged()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    await prisma.productBrandPreference.delete({ where: { id } })
    invalidateCatalogueCache()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}
