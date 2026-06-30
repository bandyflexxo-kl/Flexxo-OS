/**
 * lib/qneBranchSync.ts — sync QNE branch addresses → company_addresses.
 *
 * Source: GET /api/Branches/ByCompany?companyCode={code} — each branch maps to a
 * delivery address (branchName / contactPerson / phone / address1-4). For a
 * customer with NO branches in QNE (e.g. a single-HQ company), we seed the
 * customer's main address from GET /api/Customers instead.
 *
 * Keep-edit rule: a synced row is source='qne' and refreshable; once a customer
 * edits it (the address API flips source→'manual'), the sync NEVER overwrites it.
 * QNE has no lat/lng — those stay null and are captured later at booking time.
 *
 * QNE READ-ONLY — only GET calls. Requires the Radmin VPN.
 */

import { prisma }            from '@/lib/prisma'
import { qneLogin, qneGet }  from '@/lib/qneClient'

type QneBranch = {
  id:            number | string
  branchCode:    string | null
  branchName:    string | null
  contactPerson: string | null
  phone:         string | null
  phone2:        string | null
  area:          string | null
  email:         string | null
  isDefault:     boolean
  address1:      string | null
  address2:      string | null
  address3:      string | null
  address4:      string | null
}

type QneCustomer = {
  companyCode: string
  attention:   string | null
  phone:       string | null
  address1:    string | null
  address2:    string | null
  address3:    string | null
  address4:    string | null
}

export type BranchSyncResult = {
  ok:            boolean
  companies:     number
  created:       number
  updated:       number
  skippedManual: number
  hqSeeded:      number
  errors:        string[]
}

const arr = <T>(raw: unknown): T[] => Array.isArray(raw) ? raw as T[] : ((raw as { value?: T[] })?.value ?? [])
const joinLines = (...parts: (string | null)[]) => parts.filter(Boolean).join(', ') || null

/**
 * @param companyCodes Optional QNE customer codes to limit the sync to
 *                     (e.g. ['700-A010','700-M008','700-O004']). Omit = all
 *                     companies that have a qneCustomerCode.
 */
export async function syncQneBranches(companyCodes?: string[]): Promise<BranchSyncResult> {
  const result: BranchSyncResult = { ok: true, companies: 0, created: 0, updated: 0, skippedManual: 0, hqSeeded: 0, errors: [] }

  let token: string
  try { token = await qneLogin() }
  catch (e) { result.ok = false; result.errors.push(`QNE login failed: ${e instanceof Error ? e.message : String(e)}`); return result }

  const companies = await prisma.company.findMany({
    where:  { qneCustomerCode: companyCodes?.length ? { in: companyCodes } : { not: null } },
    select: { id: true, qneCustomerCode: true, name: true },
  })

  // Customer master (for the HQ fallback) — fetched once, mapped by code.
  let custByCode = new Map<string, QneCustomer>()
  try {
    const custs = arr<QneCustomer>(await qneGet<unknown>('/Customers?$top=1000', token))
    custByCode = new Map(custs.filter(c => c.companyCode).map(c => [c.companyCode, c]))
  } catch { /* HQ fallback simply won't run */ }

  for (const co of companies) {
    const code = co.qneCustomerCode!
    let branches: QneBranch[]
    try { branches = arr<QneBranch>(await qneGet<unknown>(`/Branches/ByCompany?companyCode=${encodeURIComponent(code)}`, token)) }
    catch (e) { result.errors.push(`${code}: ${e instanceof Error ? e.message : String(e)}`); continue }
    result.companies++

    for (const b of branches) {
      const branchId = String(b.id)
      const existing = await prisma.companyAddress.findFirst({ where: { companyId: co.id, qneBranchId: branchId } })
      if (existing?.source === 'manual') { result.skippedManual++; continue }

      const data = {
        addressType:   'delivery',
        label:         b.branchName ?? code,
        branchName:    b.branchName,
        contactPerson: b.contactPerson,
        phone:         b.phone ?? b.phone2 ?? null,
        line1:         b.address1,
        line2:         joinLines(b.address2, b.address3, b.address4),
        state:         b.area ?? null,
        qneBranchId:   branchId,
        qneBranchCode: b.branchCode,
        source:        'qne',
        isDefault:     !!b.isDefault,
        isActive:      true,
      }
      if (existing) { await prisma.companyAddress.update({ where: { id: existing.id }, data }); result.updated++ }
      else          { await prisma.companyAddress.create({ data: { companyId: co.id, ...data } }); result.created++ }
    }

    // No branches in QNE → seed the customer's main HQ address once.
    if (branches.length === 0) {
      const existingCount = await prisma.companyAddress.count({ where: { companyId: co.id } })
      const c = custByCode.get(code)
      if (existingCount === 0 && c && (c.address1 || c.address2)) {
        await prisma.companyAddress.create({
          data: {
            companyId:     co.id,
            addressType:   'delivery',
            label:         'HQ',
            branchName:    co.name,
            contactPerson: c.attention ?? null,
            phone:         c.phone ?? null,
            line1:         c.address1,
            line2:         joinLines(c.address2, c.address3, c.address4),
            source:        'qne',
            isDefault:     true,
            isActive:      true,
          },
        })
        result.hqSeeded++
      }
    }
  }

  result.ok = result.errors.length === 0
  return result
}
