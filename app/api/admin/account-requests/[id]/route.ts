/**
 * PATCH /api/admin/account-requests/[id]
 * Update status and/or internal notes on an account request.
 *
 * Body: { status?: 'contacted'|'converted'|'rejected', notes?: string }
 *
 * Admin / Manager only.
 */

import { NextResponse }   from 'next/server'
import { verifySession }  from '@/lib/session'
import { prisma }         from '@/lib/prisma'
import { z }              from 'zod'

const PatchSchema = z.object({
  status: z.enum(['contacted', 'converted', 'rejected']).optional(),
  notes:  z.string().max(2000).optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role) && session.role !== 'Manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id }   = await params
  const body     = await req.json().catch(() => ({}))
  const parsed   = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const existing = await prisma.accountRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.accountRequest.update({
    where: { id },
    data:  {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.notes  !== undefined ? { notes:  parsed.data.notes  } : {}),
    },
  })

  return NextResponse.json({ request: updated })
}
