/**
 * GET /api/admin/account-requests
 * Lists B2B account requests, optionally filtered by status.
 *
 * Query params:
 *   ?status=pending|contacted|converted|rejected  (omit for all)
 *
 * Admin / Manager only.
 */

import { NextResponse } from 'next/server'
import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'

export async function GET(req: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role) && session.role !== 'Manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? undefined

  const VALID = ['pending', 'contacted', 'converted', 'rejected']
  const statusFilter = status && VALID.includes(status) ? status : undefined

  const requests = await prisma.accountRequest.findMany({
    where:   statusFilter ? { status: statusFilter } : undefined,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ requests })
}
