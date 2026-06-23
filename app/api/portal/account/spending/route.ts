import { getOptionalShopSession } from '@/lib/session'
import { prisma }                 from '@/lib/prisma'

const COMPLETED_STATUSES = ['Delivered', 'Shipped', 'Processing', 'Confirmed', 'Approved', 'Picking', 'Packed', 'Delivering']

export async function GET() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { customerCompany: { select: { id: true } } },
  })

  if (!user?.customerCompany) {
    return Response.json({ months: buildEmptyMonths() })
  }

  // Last 6 months (beginning of the earliest month)
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const orders = await prisma.order.findMany({
    where: {
      companyId: user.customerCompany.id,
      status:    { in: COMPLETED_STATUSES },
      createdAt: { gte: sixMonthsAgo },
    },
    select: { createdAt: true, totalAmount: true },
  })

  const months = buildEmptyMonths()

  for (const order of orders) {
    const orderDate = new Date(order.createdAt)
    const monthsAgo =
      (now.getFullYear() - orderDate.getFullYear()) * 12 +
      (now.getMonth()    - orderDate.getMonth())
    if (monthsAgo >= 0 && monthsAgo <= 5) {
      months[5 - monthsAgo].amount += Number(order.totalAmount ?? 0)
    }
  }

  return Response.json({ months })
}

function buildEmptyMonths(): Array<{ month: string; amount: number }> {
  const now    = new Date()
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      month:  d.toLocaleDateString('en-MY', { month: 'short', year: '2-digit' }),
      amount: 0,
    })
  }
  return months
}
