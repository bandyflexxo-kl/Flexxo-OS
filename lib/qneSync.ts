import { prisma } from './prisma'

const QNE_API_URL  = process.env.QNE_API_URL  ?? 'http://26.255.19.220:82/api'
const QNE_DB_CODE  = process.env.QNE_DB_CODE  ?? 'FKLSB'
const QNE_USERNAME = process.env.QNE_USERNAME ?? 'SALES 6'
const QNE_PASSWORD = process.env.QNE_PASSWORD ?? '12345'

interface QneCustomer {
  companyCode:    string
  companyName:    string | null
  address1:       string | null
  address2:       string | null
  address3:       string | null
  address4:       string | null
  contactPerson:  string | null
  phoneNo1:       string | null
  phoneNo2:       string | null
  email:          string | null
  term:           string | null
  currency:       string | null
  businessNature: string | null
  category:       string | null
  salesPerson:    string | null
  [key: string]:  unknown
}

interface QneAgent {
  staffCode: string
  name:      string | null
  [key: string]: unknown
}

async function qneLogin(): Promise<string> {
  const res = await fetch(`${QNE_API_URL}/Users/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dbCode: QNE_DB_CODE, userName: QNE_USERNAME, password: QNE_PASSWORD }),
  })
  if (!res.ok) throw new Error(`QNE login failed: HTTP ${res.status}`)
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new Error('QNE login: no token in response')
  return body.token
}

async function fetchAllQneCustomers(token: string): Promise<QneCustomer[]> {
  const res = await fetch(`${QNE_API_URL}/Customers`, {
    headers: {
      DbCode:        QNE_DB_CODE,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new Error(`QNE /Customers failed: HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data)
    ? (data as QneCustomer[])
    : ((data as { data: QneCustomer[] }).data ?? [])
}

async function fetchAgentsByStaffCode(token: string): Promise<Map<string, QneAgent>> {
  const res = await fetch(`${QNE_API_URL}/Agents`, {
    headers: {
      DbCode:        QNE_DB_CODE,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) return new Map()
  const data = await res.json()
  const agents: QneAgent[] = Array.isArray(data)
    ? (data as QneAgent[])
    : ((data as { data: QneAgent[] }).data ?? [])
  return new Map(agents.filter(a => a.staffCode).map(a => [a.staffCode, a]))
}

export async function triggerQneCustomerSync(params: {
  triggeredById: string
  syncMethod: 'file_upload' | 'manual_export' | 'api_pull'
}): Promise<{
  syncLogId: string
  received:  number
  staged:    number
  skipped:   number
  failed:    number
}> {
  const syncLog = await prisma.qneSyncLog.create({
    data: {
      syncType:      'customer',
      syncMethod:    params.syncMethod,
      status:        'started',
      triggeredById: params.triggeredById,
    },
  })

  try {
    const token = await qneLogin()
    const [customers, agentsByStaffCode] = await Promise.all([
      fetchAllQneCustomers(token),
      fetchAgentsByStaffCode(token),
    ])
    const received = customers.length

    await prisma.qneSyncLog.update({
      where: { id: syncLog.id },
      data:  { recordsReceived: received },
    })

    // Don't re-stage customers that are already awaiting review.
    const existingPending = await prisma.qneCustomerStaging.findMany({
      where:  { stagingStatus: 'pending_review' },
      select: { qneCustomerCode: true },
    })
    const pendingCodes = new Set(existingPending.map(r => r.qneCustomerCode))
    const toInsert = customers.filter(c => !pendingCodes.has(c.companyCode))
    const skipped  = received - toInsert.length

    const BATCH_SIZE = 200
    let staged = 0
    let failed = 0

    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE)
      try {
        const result = await prisma.qneCustomerStaging.createMany({
          data: batch.map(c => {
            const agent = c.salesPerson ? agentsByStaffCode.get(c.salesPerson) : undefined
            return {
              syncLogId:       syncLog.id,
              qneCustomerCode: c.companyCode,
              rawName:         c.companyName ?? null,
              rawAddress:      [c.address1, c.address2, c.address3, c.address4]
                                 .filter(Boolean).join(', ') || null,
              rawContact:      c.contactPerson ?? null,
              rawPhone:        [c.phoneNo1, c.phoneNo2].filter(Boolean).join(' / ') || null,
              rawEmail:        c.email         ?? null,
              rawPaymentTerm:  c.term          ?? null,
              rawCurrency:     c.currency      ?? null,
              rawIndustry:     c.businessNature ?? c.category ?? null,
              rawSalesPerson:  agent?.name ?? c.salesPerson ?? null,
              stagingStatus:   'pending_review',
            }
          }),
        })
        staged += result.count
      } catch {
        failed += batch.length
      }
    }

    const finalStatus = staged === 0 && failed > 0 ? 'failed' : 'completed'

    await prisma.qneSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status:         finalStatus,
        recordsStaged:  staged,
        recordsFailed:  failed,
        recordsSkipped: skipped,
        completedAt:    new Date(),
      },
    })

    return { syncLogId: syncLog.id, received, staged, skipped, failed }
  } catch (err) {
    await prisma.qneSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status:       'failed',
        errorSummary: err instanceof Error ? err.message : String(err),
        completedAt:  new Date(),
      },
    })
    throw err
  }
}

export async function triggerQneItemSync(params: {
  triggeredById: string
}): Promise<{ syncLogId: string }> {
  throw new Error('QNE item sync not yet implemented (Phase 1C)')
}
