import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

// ── Response types ────────────────────────────────────────────────────────────

export type QneAgingBucket = {
  current:   number
  days30:    number
  days60:    number
  days90:    number
  over90:    number
}

export type QneAgingSummary = {
  totalOutstanding: number
  overdueAmount:    number
  aging:            QneAgingBucket
}

export type QneCustomerFinancials = {
  creditLimit:  number | null
  paymentTerm:  string | null
  currency:     string
}

export type QneInvoice = {
  invoiceNo:   string
  invoiceDate: string
  dueDate:     string | null
  amount:      number
  balance:     number
  status:      string
}

export type QneFinancialData = {
  aging:          QneAgingSummary
  customer:       QneCustomerFinancials
  recentInvoices: QneInvoice[]
  fetchedAt:      string
}

// ── Raw QNE shapes (permissive — QNE field names vary) ────────────────────────

type RawAgingRow = Record<string, unknown>
type RawCustomer = Record<string, unknown>
type RawInvoice  = Record<string, unknown>

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v)
}

function parseAgingRow(row: RawAgingRow): { outstanding: number; aging: QneAgingBucket } {
  // QNE AgingSummary returns one row per customer with fields like:
  // outstandingBalance / totalBalance / balance
  // current / current_amt / currentAmt
  // overDue30 / aging30 / days1to30
  const outstanding = num(row['outstandingBalance'] ?? row['totalBalance'] ?? row['balance'] ?? row['Outstanding'])
  return {
    outstanding,
    aging: {
      current: num(row['current'] ?? row['currentAmt'] ?? row['Current'] ?? row['Current_Amt']),
      days30:  num(row['overDue30'] ?? row['aging30'] ?? row['Days1to30'] ?? row['day30'] ?? row['Month1']),
      days60:  num(row['overDue60'] ?? row['aging60'] ?? row['Days31to60'] ?? row['day60'] ?? row['Month2']),
      days90:  num(row['overDue90'] ?? row['aging90'] ?? row['Days61to90'] ?? row['day90'] ?? row['Month3']),
      over90:  num(row['overDue90Plus'] ?? row['agingOver90'] ?? row['DaysOver90'] ?? row['day90Plus'] ?? row['Month4']),
    },
  }
}

function parseCustomer(c: RawCustomer): QneCustomerFinancials {
  return {
    creditLimit: c['creditLimit'] != null ? num(c['creditLimit']) : null,
    paymentTerm: str(c['term'] ?? c['paymentTerm'] ?? c['Terms']),
    currency:    str(c['currency'] ?? c['Currency']) ?? 'MYR',
  }
}

function parseInvoice(inv: RawInvoice): QneInvoice {
  return {
    invoiceNo:   str(inv['invoiceNo'] ?? inv['docNo'] ?? inv['DocNo'] ?? inv['InvoiceNo']) ?? '—',
    invoiceDate: str(inv['invoiceDate'] ?? inv['docDate'] ?? inv['DocDate'] ?? inv['InvoiceDate']) ?? '',
    dueDate:     str(inv['dueDate'] ?? inv['DueDate'] ?? inv['due_date']),
    amount:      num(inv['amount'] ?? inv['totalAmount'] ?? inv['Amount'] ?? inv['TotalAmount']),
    balance:     num(inv['balance'] ?? inv['outstandingBalance'] ?? inv['Balance']),
    status:      str(inv['status'] ?? inv['paymentStatus'] ?? inv['Status']) ?? 'Unknown',
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches live financial data for a customer from QNE.
 * Throws QneUnavailableError if QNE (Radmin VPN) is not reachable.
 */
export async function fetchQneFinancialData(qneCustomerCode: string): Promise<QneFinancialData> {
  const token = await qneLogin().catch(err => {
    throw new QneUnavailableError(`Cannot reach QNE: ${err instanceof Error ? err.message : String(err)}`)
  })

  const [agingRaw, customerRaw, invoicesRaw] = await Promise.allSettled([
    qneGet<unknown>(`/Customers/AgingSummary?customerCode=${encodeURIComponent(qneCustomerCode)}`, token),
    qneGet<unknown>(`/Customers/${encodeURIComponent(qneCustomerCode)}`, token),
    qneGet<unknown>(`/SalesInvoices?customerCode=${encodeURIComponent(qneCustomerCode)}&$top=10&$orderby=invoiceDate desc`, token),
  ])

  // Parse aging
  let agingSummary: QneAgingSummary = {
    totalOutstanding: 0,
    overdueAmount:    0,
    aging:            { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 },
  }
  if (agingRaw.status === 'fulfilled') {
    const raw   = agingRaw.value
    const rows: RawAgingRow[] = Array.isArray(raw) ? (raw as RawAgingRow[]) : (raw as { value?: RawAgingRow[] })?.value ?? []
    const row   = rows.find(r => {
      const code = String(r['customerCode'] ?? r['companyCode'] ?? r['CustomerCode'] ?? r['CompanyCode'] ?? '')
      return code === qneCustomerCode
    }) ?? rows[0]
    if (row) {
      const parsed       = parseAgingRow(row)
      const overdueAmt   = parsed.aging.days30 + parsed.aging.days60 + parsed.aging.days90 + parsed.aging.over90
      agingSummary = {
        totalOutstanding: parsed.outstanding,
        overdueAmount:    overdueAmt,
        aging:            parsed.aging,
      }
    }
  }

  // Parse customer detail
  let customerInfo: QneCustomerFinancials = { creditLimit: null, paymentTerm: null, currency: 'MYR' }
  if (customerRaw.status === 'fulfilled') {
    const raw = customerRaw.value
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      customerInfo = parseCustomer(raw as RawCustomer)
    }
  }

  // Parse invoices
  let invoices: QneInvoice[] = []
  if (invoicesRaw.status === 'fulfilled') {
    const raw = invoicesRaw.value
    const list: RawInvoice[] = Array.isArray(raw) ? (raw as RawInvoice[]) : (raw as { value?: RawInvoice[] })?.value ?? []
    invoices = list.slice(0, 10).map(parseInvoice)
  }

  return {
    aging:          agingSummary,
    customer:       customerInfo,
    recentInvoices: invoices,
    fetchedAt:      new Date().toISOString(),
  }
}

export { QneUnavailableError }
