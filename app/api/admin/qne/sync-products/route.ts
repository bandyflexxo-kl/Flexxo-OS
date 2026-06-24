import { verifySession }         from '@/lib/session'
import { isPrivilegedRole }       from '@/lib/authorization'
import { syncQneProducts }        from '@/lib/qneProductSync'
import { syncQneStock }           from '@/lib/qneStockSync'
import { invalidateProductsCache } from '@/lib/products-api'
import { QneUnavailableError }    from '@/lib/qneClient'
import { createJob, setProgress, finishJob, failJob } from '@/lib/syncJobStore'

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' },           { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const body      = await request.json().catch(() => ({})) as Record<string, unknown>
  const skipStock = body.skipStock === true

  const jobId = createJob('products', 'Products & Stock')

  void (async () => {
    try {
      const productResult = await syncQneProducts(msg => setProgress(jobId, msg))

      let stockSummary = ''
      if (!skipStock) {
        setProgress(jobId, 'Syncing stock quantities…')
        const stockResult = await syncQneStock(msg => setProgress(jobId, msg))
        stockSummary = ` · ${stockResult.productsUpdated} stock updated`
        if (stockResult.errors.length > 0) stockSummary += ` · ${stockResult.errors.length} stock errors`
      }

      setProgress(jobId, 'Invalidating cache…')
      await invalidateProductsCache()

      const summary = [
        `${productResult.fetched} fetched`,
        `${productResult.updated} updated`,
        productResult.deactivated > 0 ? `${productResult.deactivated} deactivated` : null,
        productResult.errors > 0      ? `${productResult.errors} errors`           : null,
      ].filter(Boolean).join(' · ') + stockSummary

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
