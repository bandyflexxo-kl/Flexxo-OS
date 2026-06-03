import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { fetchQneFinancialData, QneUnavailableError } from '@/lib/qneFinancial'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const company = await prisma.company.findUnique({
    where:  { id },
    select: { id: true, qneCustomerCode: true },
  })
  if (!company) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!company.qneCustomerCode) {
    return Response.json({ error: 'This company is not linked to a QNE customer.' }, { status: 404 })
  }

  const denied = await assertCompanyAccess(id, session)
  if (denied) return denied

  try {
    const data = await fetchQneFinancialData(company.qneCustomerCode)
    return Response.json(data)
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      return Response.json(
        { error: 'qne_unavailable', message: 'QNE is unreachable. Ensure Radmin VPN is connected and try again.' },
        { status: 503 },
      )
    }
    console.error('QNE financial fetch error:', err)
    return Response.json({ error: 'Failed to fetch QNE data.' }, { status: 500 })
  }
}
