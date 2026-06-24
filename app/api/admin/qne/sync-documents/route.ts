import { verifySession }             from '@/lib/session'
import { isPrivilegedRole }           from '@/lib/authorization'
import { syncQneQuotations }          from '@/lib/qneQuotationSync'
import { syncQneSalesOrders }         from '@/lib/qneSalesOrderSync'
import { syncQneDeliveryOrders }      from '@/lib/qneDeliveryOrderSync'
import { syncQneInvoices }            from '@/lib/qneInvoiceSync'
import { QneUnavailableError }        from '@/lib/qneClient'
import { createJob, setProgress, finishJob, failJob } from '@/lib/syncJobStore'

const DEFAULT_FROM_MONTHS = 12

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' },           { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const body       = await request.json().catch(() => ({})) as Record<string, unknown>
  const fromMonths = typeof body.fromMonths === 'number' ? body.fromMonths : DEFAULT_FROM_MONTHS
  const fromDate   = new Date()
  fromDate.setMonth(fromDate.getMonth() - fromMonths)
  const fromDateStr = fromDate.toISOString().substring(0, 10)

  const jobId = createJob('documents', 'QNE Documents')
  setProgress(jobId, 'Fetching Quotations, SOs, DOs & Invoices in parallel…')

  void (async () => {
    try {
      const [quotations, salesOrders, deliveryOrders, invoices] = await Promise.all([
        syncQneQuotations(fromDateStr).catch(err => ({ ok: false as const, quotationsFetched: 0, quotationsUpserted: 0, itemsUpserted: 0, companiesLinked: 0, errors: [String(err)] })),
        syncQneSalesOrders(fromDateStr).catch(err => ({ ok: false as const, docsFetched: 0, docsUpserted: 0, itemsUpserted: 0, companiesLinked: 0, errors: [String(err)] })),
        syncQneDeliveryOrders(fromDateStr).catch(err => ({ ok: false as const, docsFetched: 0, docsUpserted: 0, itemsUpserted: 0, companiesLinked: 0, errors: [String(err)] })),
        syncQneInvoices(fromDateStr).catch(err => ({ ok: false as const, invoicesFetched: 0, invoicesUpserted: 0, itemsUpserted: 0, companiesLinked: 0, errors: [String(err)] })),
      ])

      const summary = [
        `${quotations.quotationsFetched} QT`,
        `${salesOrders.docsFetched} SO`,
        `${deliveryOrders.docsFetched} DO`,
        `${invoices.invoicesFetched} INV`,
      ].join(' · ')

      finishJob(jobId, summary)
    } catch (err) {
      if (err instanceof QneUnavailableError) {
        failJob(jobId, 'QNE unreachable — is Radmin VPN (Flexxokl) connected?')
      } else {
        failJob(jobId, err instanceof Error ? err.message : String(err))
      }
    }
  })()

  return Response.json({ ok: true, jobId })
}
