import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

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

export type QneFinancialData = {
  customer:       QneCustomerFinancials
  recentInvoices: QneInvoice[]
  fetchedAt:      string
}

// ── Raw QNE shapes ────────────────────────────────────────────────────────────

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

  return {
    customer:       customerInfo,
    recentInvoices: invoices,
    fetchedAt:      new Date().toISOString(),
  }
}

export { QneUnavailableError }
