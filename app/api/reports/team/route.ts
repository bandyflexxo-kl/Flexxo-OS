/**
 * GET /api/reports/team
 * Returns per-salesperson portfolio intelligence from our DB (no QNE call).
 * Reads: company_assignments, companies (outstandingBalance), qne_top_items.
 * Admin/Manager only.
 */

import { NextResponse } from 'next/server'
import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'

export type TopItem = {
  itemCode:   string | null
  itemName:   string
  orderCount: number
  totalQty:   number
  lastOrderAt: string
}

export type ClientRow = {
  companyId:          string
  companyName:        string
  qneCustomerCode:    string | null
  outstandingBalance: number | null
  balanceUpdatedAt:   string | null
  topItems:           TopItem[]
}

export type SalespersonPortfolio = {
  userId:         string
  name:           string
  email:          string
  clientCount:    number
  totalOutstanding: number
  clients:        ClientRow[]
}

export type TeamPortfolioResponse = {
  salespersons:    SalespersonPortfolio[]
  lastSyncAt:      string | null   // most recent outstandingUpdatedAt across all companies
  unassignedCount: number
}

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) {
    return NextResponse.json({ error: 'Admin or Manager required' }, { status: 403 })
  }

  // ── Fetch all salesperson users ───────────────────────────────────────────
  const salespersons = await prisma.user.findMany({
    where: {
      isActive:  true,
      userRoles: { some: { revokedAt: null, role: { name: { in: ['Salesperson', 'Director', 'Admin', 'Manager'] } } } },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })

  // ── Fetch all current company assignments ─────────────────────────────────
  const assignments = await prisma.companyAssignment.findMany({
    where: { unassignedAt: null },
    select: {
      userId:    true,
      companyId: true,
    },
  })

  // Build set of assigned company IDs
  const assignedCompanyIds = new Set(assignments.map(a => a.companyId))

  // ── Fetch all companies with outstanding balance + top items ──────────────
  const companies = await prisma.company.findMany({
    where: {
      id: { in: [...assignedCompanyIds] },
    },
    select: {
      id:                  true,
      name:                true,
      qneCustomerCode:     true,
      outstandingBalance:  true,
      outstandingUpdatedAt: true,
      topItems: {
        orderBy: { orderCount: 'desc' },
        take:    8,
        select: {
          itemCode:   true,
          itemName:   true,
          orderCount: true,
          totalQty:   true,
          lastOrderAt: true,
        },
      },
    },
  })

  const companyMap = new Map(companies.map(c => [c.id, c]))

  // ── Build per-salesperson portfolios ─────────────────────────────────────
  // userId → Set of companyIds
  const spCompanyMap = new Map<string, Set<string>>()
  for (const a of assignments) {
    const set = spCompanyMap.get(a.userId) ?? new Set()
    set.add(a.companyId)
    spCompanyMap.set(a.userId, set)
  }

  let lastSyncAt: Date | null = null

  const portfolios: SalespersonPortfolio[] = salespersons.map(sp => {
    const companyIds = [...(spCompanyMap.get(sp.id) ?? [])]
    let totalOutstanding = 0

    const clients: ClientRow[] = companyIds
      .map(cid => {
        const co = companyMap.get(cid)
        if (!co) return null

        const bal = co.outstandingBalance ? Number(co.outstandingBalance) : null
        if (bal !== null) totalOutstanding += bal

        // Track most recent sync time globally
        if (co.outstandingUpdatedAt) {
          if (!lastSyncAt || co.outstandingUpdatedAt > lastSyncAt) {
            lastSyncAt = co.outstandingUpdatedAt
          }
        }

        return {
          companyId:          co.id,
          companyName:        co.name,
          qneCustomerCode:    co.qneCustomerCode,
          outstandingBalance: bal,
          balanceUpdatedAt:   co.outstandingUpdatedAt?.toISOString() ?? null,
          topItems:           co.topItems.map(i => ({
            itemCode:   i.itemCode,
            itemName:   i.itemName,
            orderCount: i.orderCount,
            totalQty:   Number(i.totalQty),
            lastOrderAt: i.lastOrderAt.toISOString(),
          })),
        } satisfies ClientRow
      })
      .filter((c): c is ClientRow => c !== null)
      // Sort: highest outstanding first
      .sort((a, b) => (b.outstandingBalance ?? 0) - (a.outstandingBalance ?? 0))

    return {
      userId:           sp.id,
      name:             sp.name,
      email:            sp.email,
      clientCount:      clients.length,
      totalOutstanding,
      clients,
    }
  })
    // Only include salespersons with clients
    .filter(sp => sp.clientCount > 0)
    // Sort by total outstanding descending
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding)

  // Count unassigned companies
  const allCompanyCount = await prisma.company.count()
  const unassignedCount = allCompanyCount - assignedCompanyIds.size

  return NextResponse.json({
    salespersons: portfolios,
    lastSyncAt:   lastSyncAt ? (lastSyncAt as Date).toISOString() : null,
    unassignedCount,
  } satisfies TeamPortfolioResponse)
}
