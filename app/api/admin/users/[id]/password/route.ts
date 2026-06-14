import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

const Schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters.'),
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
    return Response.json({ error: parsed.error.flatten().fieldErrors.password?.[0] ?? 'Invalid input' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 })

  const hash = await bcrypt.hash(parsed.data.password, 12)

  // If admin is setting a password for another user → mark mustChangePassword
  const mustChangePassword = id !== session.userId

  await prisma.user.update({
    where: { id },
    data:  { passwordHash: hash, mustChangePassword },
  })

  return Response.json({ ok: true, mustChangePassword })
}
