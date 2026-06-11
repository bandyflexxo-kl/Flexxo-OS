import { unstable_cache }                      from 'next/cache'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'
import { getRedis }                              from '@/lib/redis'

// ── Response types ────────────────────────────────────────────────────────────

export type QneCustomerFinancials = {
  creditLimit:      number | null   // Not available via SALES 6 — always null
  paymentTerm:      string | null   // e.g. "30 DAYS", "C.O.D."
  currency:         string
  currentBalance:   number          // Outstanding balance from QNE
}

export type QneInvoice = {
  invoiceNo:   string
  invoiceDate: string
  dueDate:     string | null        // Calculated from invoiceDate + term
  amount:      number
  isCancelled: boolean
}

/** Aging breakdown — how old the outstanding amounts are */
export type QneAgingSummary = {
  current:       number   // Not yet due
  overdue30:     number   // 1–30 days overdue
  overdue60:     number   // 31–60 days overdue
  overdue90:     number   // 61–90 days overdue
  overdueAbove90: number  // 90+ days overdue
  totalOutstanding: number
  creditLimit:   number | null
}

export type QneFinancialData = {
  customer:       QneCustomerFinancials
  recentInvoices: QneInvoice[]
  aging:          QneAgingSummary | null   // null if aging endpoint unavailable
  fetchedAt:      string
}

// ── Raw QNE shapes ────────────────────────────────────────────────────────────

type RawAgingSummary = {
  customerId?:       string | null
  customerCode?:     string | null
  companyCode?:      string | null
  currentBalance?:   number | null
  overdue30?:        number | null
  overdue60?:        number | null
  overdue90?:        number | null
  overdueAbove90?:   number | null
  totalOutstanding?: number | null
  creditLimit?:      number | null
  [key: string]:     unknown
}

type RawCustomer = {
  id:             string
  companyCode:    string
  term?:          string | null
  currency?:      string | null
  currentBalance?: number | null
  [key: string]:  unknown
}

type RawInvoice = {
  invoiceCode?:  string | null
  invoiceDate?:  string | null
  totalAmount?:  number | null
  isCancelled?:  boolean
  term?:         string | null      // payment term on invoice e.g. "30 DAYS"
  customer?:     string             // companyCode of the customer
  [key: string]: unknown
}

/** Parse "30 DAYS" or "60 DAYS" → add N days to a date string */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function calcDueDate(invoiceDate: string | null | undefined, term: string | null | undefined): string | null {
  if (!invoiceDate || !term) return null
  const match = /(\d+)\s*DAYS?/i.exec(term)
  if (!match) return null
  return addDays(invoiceDate, parseInt(match[1], 10))
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches live financial data for a customer from QNE.
 * Throws QneUnavailableError if QNE (Radmin VPN) is not reachable.
 *
 * Data sources:
 *  - Outstanding balance + payment term: GET /Customers (filter by companyCode)
 *  - Invoice history:                    GET /SalesInvoices (filter by customer field)
 */
export async function fetchQneFinancialData(qneCustomerCode: string): Promise<QneFinancialData> {
  const token = await qneLogin().catch(err => {
    throw new QneUnavailableError(`Cannot reach QNE: ${err instanceof Error ? err.message : String(err)}`)
  })

  // ── 1. Fetch customer details (balance + term) ────────────────────────────
  let customerInfo: QneCustomerFinancials = {
    creditLimit:    null,
    paymentTerm:    null,
    currency:       'MYR',
    currentBalance: 0,
  }

  try {
    // Fetch ALL customers and find matching one by companyCode
    // QNE doesn't support filtering by companyCode on the list endpoint
    const raw = await qneGet<unknown>('/Customers', token)
    const all: RawCustomer[] = Array.isArray(raw)
      ? (raw as RawCustomer[])
      : ((raw as { value?: RawCustomer[] })?.value ?? [])

    const match = all.find(c => c.companyCode === qneCustomerCode)
    if (match) {
      customerInfo = {
        creditLimit:    null, // Not available via SALES 6 account
        paymentTerm:    match.term ?? null,
        currency:       String(match.currency ?? 'MYR'),
        currentBalance: Number(match.currentBalance ?? 0),
      }
    }
  } catch {
    // Non-fatal — continue without customer detail
  }

  // ── 2. Fetch recent invoices ──────────────────────────────────────────────
  let invoices: QneInvoice[] = []

  try {
    // Fetch recent invoices globally then filter client-side by customer code.
    // QNE's filter params on /SalesInvoices are not consistent — we fetch
    // recent invoices and filter by the 'customer' field (= companyCode).
    const raw = await qneGet<unknown>(`/SalesInvoices?$top=200&$orderby=invoiceDate desc`, token)
    const all: RawInvoice[] = Array.isArray(raw)
      ? (raw as RawInvoice[])
      : ((raw as { value?: RawInvoice[] })?.value ?? [])

    const customerInvoices = all
      .filter(inv => inv.customer === qneCustomerCode && !inv.isCancelled)
      .slice(0, 10)

    invoices = customerInvoices.map(inv => ({
      invoiceNo:   inv.invoiceCode ?? '—',
      invoiceDate: inv.invoiceDate ?? '',
      dueDate:     calcDueDate(inv.invoiceDate, inv.term),
      amount:      Number(inv.totalAmount ?? 0),
      isCancelled: Boolean(inv.isCancelled),
    }))
  } catch {
    // Non-fatal — show empty invoice list
  }

  // ── 3. Fetch aging summary ────────────────────────────────────────────────
  let aging: QneAgingSummary | null = null

  try {
    const raw = await qneGet<unknown>('/Customers/AgingSummary', token)
    const all: RawAgingSummary[] = Array.isArray(raw)
      ? (raw as RawAgingSummary[])
      : ((raw as { value?: RawAgingSummary[] })?.value ?? [])

    // Match by companyCode or customerCode field (QNE field name varies by build)
    const match = all.find(
      r => r.companyCode === qneCustomerCode || r.customerCode === qneCustomerCode
    )
    if (match) {
      aging = {
        current:          Number(match.currentBalance   ?? 0),
        overdue30:        Number(match.overdue30         ?? 0),
        overdue60:        Number(match.overdue60         ?? 0),
        overdue90:        Number(match.overdue90         ?? 0),
        overdueAbove90:   Number(match.overdueAbove90    ?? 0),
        totalOutstanding: Number(match.totalOutstanding  ?? 0),
        creditLimit:      match.creditLimit != null ? Number(match.creditLimit) : null,
      }
    }
  } catch {
    // Non-fatal — aging section simply won't render
  }

  return {
    customer:       customerInfo,
    recentInvoices: invoices,
    aging,
    fetchedAt:      new Date().toISOString(),
  }
}

// ── Two-layer cache: Redis (4h) → unstable_cache fallback ────────────────────
//
// Layer 1 — Upstash Redis (4h TTL):
//   Persists across server restarts, shared across Vercel instances.
//   Key: `qne-fin:v1:{qneCustomerCode}`
//   Configured via UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
//   Falls back to Layer 2 when env vars are absent (local dev without Redis).
//
// Layer 2 — Next.js unstable_cache (4h TTL):
//   In-process cache, cleared on dev server restart.
//   Used as fallback when Redis is not configured.
//
// Error behaviour: errors are NOT cached — next request retries QNE live.
// Dashboard falls back to the DB-stored balance when QNE is unreachable.
//
// To force-invalidate a client's cache:
//   Redis: await getRedis()?.del(`qne-fin:v1:${qneCustomerCode}`)
//   unstable_cache: revalidateTag(`qne-fin-${qneCustomerCode}`)

const QNE_FIN_TTL = 4 * 60 * 60  // 4 hours in seconds

export async function fetchQneFinancialDataCached(qneCustomerCode: string): Promise<QneFinancialData> {
  const redis = getRedis()
  const key   = `qne-fin:v1:${qneCustomerCode}`

  // Layer 1: Redis
  if (redis) {
    const cached = await redis.get<QneFinancialData>(key).catch(() => null)
    if (cached) return cached

    const fresh = await fetchQneFinancialData(qneCustomerCode)
    await redis.set(key, fresh, { ex: QNE_FIN_TTL }).catch(() => undefined)
    return fresh
  }

  // Layer 2: unstable_cache (fallback when Redis not configured)
  return unstable_cache(
    () => fetchQneFinancialData(qneCustomerCode),
    [`qne-fin-${qneCustomerCode}`],
    { revalidate: QNE_FIN_TTL, tags: [`qne-fin-${qneCustomerCode}`] }
  )()
}

/** Invalidate a client's QNE financial cache (call after payment confirmed, etc.) */
export async function invalidateQneFinancialCache(qneCustomerCode: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redis.del(`qne-fin:v1:${qneCustomerCode}`).catch(() => undefined)
  }
}

export { QneUnavailableError }
