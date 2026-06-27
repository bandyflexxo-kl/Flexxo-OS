import { redirect }      from 'next/navigation'
import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { canCreateTender } from '@/lib/tenderAccess'
import Topbar            from '@/components/layout/Topbar'
import NewTenderForm     from '@/components/tenders/NewTenderForm'

export const dynamic = 'force-dynamic'

export default async function NewTenderPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  if (!canCreateTender(session.role)) redirect('/tenders')

  const [suppliers, companies] = await Promise.all([
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 1000 }),
  ])

  return (
    <div>
      <Topbar title="New Tender" />
      <div className="p-6">
        <NewTenderForm suppliers={suppliers} companies={companies} />
      </div>
    </div>
  )
}
