import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const Schema = z.object({
  isActive: z.boolean().optional(),
  roleId:   z.string().uuid().optional(),
  name:     z.string().min(1).optional(),
  email:    z.string().email().optional(),
  mobileNo: z.string().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 })

  const { isActive, roleId, name, email, mobileNo } = parsed.data

  // Update name, email and/or mobileNo
  if (name || email || mobileNo !== undefined) {
    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) return Response.json({ error: 'That email is already used by another account.' }, { status: 409 })
    }
    await prisma.user.update({
      where: { id },
      data: {
        ...(name              ? { name }     : {}),
        ...(email             ? { email }    : {}),
        ...(mobileNo !== undefined ? { mobileNo: mobileNo || null } : {}),
      },
    })
  }

  // Update isActive
  if (typeof isActive === 'boolean') {
    await prisma.user.update({ where: { id }, data: { isActive } })
  }

  // Change role: revoke current, assign new
  if (roleId) {
    const role = await prisma.role.findUnique({ where: { id: roleId } })
    if (!role) return Response.json({ error: 'Role not found' }, { status: 404 })

    await prisma.$transaction([
      prisma.userRole.updateMany({
        where:  { userId: id, revokedAt: null },
        data:   { revokedAt: new Date() },
      }),
      prisma.userRole.create({
        data: { userId: id, roleId },
      }),
    ])
  }

  return Response.json({ ok: true })
}
