import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendPortalWelcomeEmail } from '@/lib/portalWelcomeEmail'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

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
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

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

  // Auto-convert any open account request with this email — the admin
  // shouldn't have to go back and click "Mark Converted" manually.
  try {
    await prisma.accountRequest.updateMany({
      where: { email: { equals: email, mode: 'insensitive' }, status: { in: ['pending', 'contacted'] } },
      data:  { status: 'converted' },
    })
  } catch (err) {
    console.error('[customer-accounts] Failed to auto-convert account request:', err)
  }

  // A2: materialise the request's contacts (up to 3) as Contact rows on the
  // company — so the multi-contact info captured at request time isn't lost.
  try {
    const req = await prisma.accountRequest.findFirst({
      where:   { email: { equals: email, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      select:  { contacts: true },
    })
    const list = Array.isArray(req?.contacts)
      ? (req.contacts as Array<{ fullName?: string; position?: string; department?: string; email?: string; phone?: string; whatsapp?: string; influenceLevel?: string; isDecisionMaker?: boolean }>)
      : []
    if (list.length > 0) {
      await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
      for (const c of list.slice(0, 3)) {
        if (!c.fullName?.trim()) continue
        const dupe = c.email
          ? await prisma.contact.findFirst({ where: { companyId: customerCompanyId, email: { equals: c.email, mode: 'insensitive' } }, select: { id: true } })
          : null
        if (dupe) continue
        await prisma.contact.create({
          data: {
            companyId:       customerCompanyId,
            name:            c.fullName.trim(),
            position:        c.position || null,
            department:      c.department || null,
            email:           c.email || null,
            phone:           c.phone || null,
            whatsapp:        c.whatsapp || null,
            influenceLevel:  c.influenceLevel || null,
            isDecisionMaker: !!c.isDecisionMaker,
            isActive:        true,
            createdById:     session.userId,
          },
        })
      }
    }
  } catch (err) {
    console.error('[customer-accounts] Failed to create contacts from request:', err)
  }

  // Send welcome email with login credentials (outside transaction — failure is
  // non-fatal but REPORTED so the admin knows to share the login manually).
  let emailSent = false
  let emailError: string | null = null
  try {
    await sendPortalWelcomeEmail({
      to:          email,
      name,
      companyName: company.name,
      password,    // plain-text password, captured before hashing
    })
    emailSent = true
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err)
    console.error('[customer-accounts] Failed to send welcome email:', emailError)
    // Account was created successfully — do not fail the request
  }

  return Response.json(
    { id: user.id, name: user.name, email: user.email, emailSent, emailError },
    { status: 201 },
  )
}
