import { verifySession }            from '@/lib/session'
import { isPrivilegedRole }          from '@/lib/authorization'
import { syncQnePrices }             from '@/lib/qnePriceSync'
import { QneUnavailableError }       from '@/lib/qneClient'
import { invalidateProductsCache }   from '@/lib/products-api'
import { createJob, setProgress, finishJob, failJob } from '@/lib/syncJobStore'

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const jobId = createJob('prices', 'Shop Prices')
  setProgress(jobId, 'Logging in to QNE…')

  void (async () => {
    try {
      setProgress(jobId, 'Fetching prices from QNE…')
      const result = await syncQnePrices(msg => setProgress(jobId, msg))

      setProgress(jobId, 'Invalidating product cache…')
      await invalidateProductsCache().catch(() => undefined)

      if (result.productsUpdated === 0 && result.errors.length > 0) {
        // All pages failed — surface the first error so admin knows what broke
        finishJob(jobId, `0 prices updated · fetch failed: ${result.errors[0]}`)
      } else {
        const errPart = result.errors.length > 0 ? ` · ${result.errors.length} page error(s): ${result.errors[0]}` : ''
        finishJob(jobId, `${result.productsUpdated} prices updated · ${result.skipped} skipped${errPart}`)
      }
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
