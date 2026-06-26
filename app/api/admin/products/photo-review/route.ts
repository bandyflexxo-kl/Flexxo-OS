import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 30

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url    = new URL(request.url)
  const page   = parseInt(url.searchParams.get('page') ?? '0', 10)
  const filter = url.searchParams.get('filter') ?? 'all'
  const search = url.searchParams.get('search') ?? ''

  type WhereClause = {
    photoUrl:             { not: null }
    isActive:             boolean
    photoQualityFlagged?: boolean | null
    photoApprovalPending?: boolean
    OR?: Array<{ name: { contains: string; mode: 'insensitive' } } | { qneItemCode: { contains: string; mode: 'insensitive' } }>
  }

  const where: WhereClause = { photoUrl: { not: null }, isActive: true }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { qneItemCode: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (filter === 'flagged')        where.photoQualityFlagged  = true
  else if (filter === 'clean')     where.photoQualityFlagged  = false
  else if (filter === 'unscanned') where.photoQualityFlagged  = null
  else if (filter === 'pending')   where.photoApprovalPending = true

  const [total, flaggedTotal, unscannedTotal, pendingApprovalTotal, products] = await Promise.all([
    prisma.product.count({ where: { photoUrl: { not: null }, isActive: true } }),
    prisma.product.count({ where: { photoUrl: { not: null }, isActive: true, photoQualityFlagged: true } }),
    prisma.product.count({ where: { photoUrl: { not: null }, isActive: true, photoQualityFlagged: null } }),
    prisma.product.count({ where: { photoUrl: { not: null }, isActive: true, photoApprovalPending: true } }),
    prisma.product.findMany({
      where,
      orderBy: [{ photoApprovalPending: 'desc' }, { photoQualityFlagged: 'desc' }, { name: 'asc' }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id:                   true,
        name:                 true,
        brand:                true,
        qneItemCode:          true,
        photoUrl:             true,
        photoQualityFlagged:  true,
        photoQualityNote:     true,
        photoApprovedByAdmin: true,
        photoApprovalPending: true,
        category:             { select: { name: true, parentCategory: { select: { name: true } } } },
      },
    }),
  ])

  return Response.json({ total, flaggedTotal, unscannedTotal, pendingApprovalTotal, page, pageSize: PAGE_SIZE, products })
}
