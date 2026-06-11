/**
 * GET  /api/portal/account  — fetch current B2B user's profile
 * PATCH /api/portal/account  — change password
 *
 * B2B Client role only. Returns: { name, email, companyName, mobileNo, lastLoginAt }
 */

import { NextResponse }  from 'next/server'
import { getOptionalShopSession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { z }             from 'zod'
import bcrypt            from 'bcryptjs'

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: {
      id:          true,
      name:        true,
      email:       true,
      mobileNo:    true,
      lastLoginAt: true,
      customerCompany: {
        select: { id: true, name: true },
      },
    },
  })

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({
    id:          user.id,
    name:        user.name,
    email:       user.email,
    mobileNo:    user.mobileNo,
    lastLoginAt: user.lastLoginAt,
    companyName: user.customerCompany?.name ?? null,
    companyId:   user.customerCompany?.id   ?? null,
  })
}

// ── PATCH — change password ───────────────────────────────────────────────────

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
})

export async function PATCH(req: Request) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body   = await req.json().catch(() => ({}))
  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { currentPassword, newPassword } = parsed.data

  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { id: true, passwordHash: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
  }

  const newHash = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({
    where: { id: user.id },
    data:  { passwordHash: newHash, mustChangePassword: false },
  })

  return NextResponse.json({ ok: true })
}
