import { verifySession }    from '@/lib/session'
import { isPrivilegedRole }  from '@/lib/authorization'
import { getJobs }           from '@/lib/syncJobStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/sync-jobs
 * Returns all recent sync jobs (running + finished within last 30 min).
 * Admin / Manager only. Used by SyncJobsIndicator + sync panels to poll progress.
 */
export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session || !isPrivilegedRole(session.role)) {
    return Response.json({ jobs: [] })
  }
  return Response.json({ jobs: getJobs() })
}
