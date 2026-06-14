import { verifySession } from '@/lib/session'
import { triggerQneCustomerSync } from '@/lib/qneSync'

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session)                 return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' },    { status: 403 })

  try {
    const result = await triggerQneCustomerSync({
      triggeredById: session.userId,
      syncMethod:    'api_pull',
    })
    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    )
  }
}
