import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess, isPrivilegedRole } from '@/lib/authorization'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isPrivilegedRole(session.role)) {
    return Response.json({ error: 'Only Managers and Admins can view QNE delivery orders.' }, { status: 403 })
  }

  const { id } = await params

  const order = await prisma.order.findUnique({
    where:  { id },
    select: { companyId: true, qneDoRef: true },
  })
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!order.qneDoRef) {
    return Response.json({ error: 'No QNE delivery order reference set on this order.' }, { status: 404 })
  }

  const denied = await assertCompanyAccess(order.companyId, session)
  if (denied) return denied

  try {
    const token = await qneLogin()
    const data  = await qneGet<unknown>(`/DeliveryOrders/${encodeURIComponent(order.qneDoRef)}`, token)
    return Response.json(data)
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      return Response.json(
        { error: 'qne_unavailable', message: 'QNE is unreachable. Ensure Radmin VPN is connected.' },
        { status: 503 },
      )
    }
    return Response.json({ error: 'Failed to fetch delivery order from QNE.' }, { status: 500 })
  }
}
