import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { sendPortalWelcomeEmail } from '@/lib/portalWelcomeEmail'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

const CreateSchema = z.object({
  name:     z.string().min(1, 'Name is required.'),
  email:    z.string().email('Valid email is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: companyId } = await params

  // Verify caller has access to this company (assigned salesperson, admin, director)
  const denied = await assertCompanyAccess(companyId, session)
  if (denied) return denied

  const body   = await request.json() as unknown
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { name, email, password } = parsed.data

  const company = await prisma.company.findUnique({
    where:  { id: companyId },
    select: { id: true, name: true },
  })
  if (!company) return Response.json({ error: 'Company not found.' }, { status: 404 })

  // Guard: only one B2B account per company
  const existingForCompany = await prisma.user.findFirst({
    where: {
      customerCompanyId: companyId,
      userRoles: { some: { role: { name: 'B2B Client' }, revokedAt: null } },
    },
    select: { email: true },
  })
  if (existingForCompany) {
    return Response.json(
      { error: `A B2B account already exists for this company (${existingForCompany.email}).` },
      { status: 409 },
    )
  }

  // Guard: email uniqueness across all users
  const existingEmail = await prisma.user.findUnique({ where: { email } })
  if (existingEmail) return Response.json({ error: 'That email is already registered.' }, { status: 409 })

  const b2bRole = await prisma.role.findUnique({ where: { name: 'B2B Client' } })
  if (!b2bRole) return Response.json({ error: 'B2B Client role not seeded.' }, { status: 500 })

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.$transaction(async tx => {
    const newUser = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        isActive:           true,
        mustChangePassword: true,
        customerCompanyId:  companyId,
      },
    })
    await tx.userRole.create({
      data: { userId: newUser.id, roleId: b2bRole.id },
    })
    return newUser
  })

  // Auto-convert any open account requests with this email
  try {
    await prisma.accountRequest.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, status: { in: ['pending', 'contacted'] } },
      data:  { status: 'converted' },
    })
  } catch (err) {
    console.error('[open-portal-account] Failed to auto-convert account request:', err)
  }

  try {
    await sendPortalWelcomeEmail({ to: email, name, companyName: company.name, password })
  } catch (err) {
    console.error('[open-portal-account] Failed to send welcome email:', err)
  }

  return Response.json({ id: user.id, name: user.name, email: user.email }, { status: 201 })
}
