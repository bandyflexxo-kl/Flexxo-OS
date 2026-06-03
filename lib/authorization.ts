import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { SessionPayload } from '@/lib/session'

/** Roles that see all data — no company-scope restriction. */
const PRIVILEGED_ROLES = ['Admin', 'Manager'] as const

export function isPrivilegedRole(role: string): boolean {
  return (PRIVILEGED_ROLES as readonly string[]).includes(role)
}

/**
 * Returns a Prisma WHERE fragment scoping a company query to the current user.
 * Admin / Manager → {} (no restriction, sees everything)
 * Salesperson     → filters to companies with an active assignment to this user
 */
export function companyOwnerFilter(session: SessionPayload):
  | Record<string, never>
  | { assignments: { some: { userId: string; unassignedAt: null } } }
{
  if (isPrivilegedRole(session.role)) return {}
  return {
    assignments: {
      some: { userId: session.userId, unassignedAt: null },
    },
  }
}

/** Returns true if the session belongs to a B2B portal customer. */
export function isPortalUser(session: SessionPayload): boolean {
  return session.role === 'B2B Client'
}

/**
 * For portal API routes: ensures the authenticated customer belongs to
 * the requested company. Returns a 403 NextResponse or null.
 */
export function assertPortalCompanyAccess(
  companyId: string,
  session:   SessionPayload,
): NextResponse | null {
  if (isPrivilegedRole(session.role)) return null
  if (session.customerCompanyId === companyId) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * Checks whether the current user may access a specific company.
 * Admin / Manager → always allowed (returns null).
 * Salesperson     → queries company_assignments; returns a 403 NextResponse
 *                   if no active assignment exists.
 *
 * Usage in API routes:
 *   const denied = await assertCompanyAccess(companyId, session)
 *   if (denied) return denied
 */
export async function assertCompanyAccess(
  companyId: string,
  session:   SessionPayload,
): Promise<NextResponse | null> {
  if (isPrivilegedRole(session.role)) return null

  const assignment = await prisma.companyAssignment.findFirst({
    where:  { companyId, userId: session.userId, unassignedAt: null },
    select: { id: true },
  })

  if (!assignment) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
