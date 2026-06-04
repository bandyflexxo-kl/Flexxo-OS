import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendPortalWelcomeEmail } from '@/lib/portalWelcomeEmail'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const users = await prisma.user.findMany({
    where: {
      userRoles: { some: { role: { name: 'B2B Client' }, revokedAt: null } },
    },
    select: {
      id:                true,
      name:              true,
      email:             true,
      isActive:          true,
      lastLoginAt:       true,
      customerCompanyId: true,
      customerCompany:   { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  })

  return Response.json(users.map(u => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  })))
}

const CreateSchema = z.object({
  name:              z.string().min(1, 'Name is required.'),
  email:             z.string().email('Valid email is required.'),
  password:          z.string().min(8, 'Password must be at least 8 characters.'),
  customerCompanyId: z.string().uuid('Company is required.'),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body   = await request.json() as unknown
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { name, email, password, customerCompanyId } = parsed.data

  // Check email uniqueness
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return Response.json({ error: 'That email is already registered.' }, { status: 409 })

  // Check company exists
  const company = await prisma.company.findUnique({ where: { id: customerCompanyId } })
  if (!company) return Response.json({ error: 'Company not found.' }, { status: 404 })

  const b2bRole = await prisma.role.findUnique({ where: { name: 'B2B Client' } })
  if (!b2bRole) return Response.json({ error: 'B2B Client role not seeded. Run: npx prisma db seed' }, { status: 500 })

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.$transaction(async tx => {
    const newUser = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        isActive:          true,
        mustChangePassword: true,  // force password change on first login
        customerCompanyId,
      },
    })
    await tx.userRole.create({
      data: { userId: newUser.id, roleId: b2bRole.id },
    })
    return newUser
  })

  // Send welcome email with login credentials (outside transaction — failure is non-fatal)
  try {
    await sendPortalWelcomeEmail({
      to:          email,
      name,
      companyName: company.name,
      password,    // plain-text password, captured before hashing
    })
  } catch (err) {
    console.error('[customer-accounts] Failed to send welcome email:', err)
    // Account was created successfully — do not fail the request
  }

  return Response.json({ id: user.id, name: user.name, email: user.email }, { status: 201 })
}
