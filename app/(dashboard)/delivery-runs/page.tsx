import { verifySession } from '@/lib/session'
import { redirect }      from 'next/navigation'
import Topbar            from '@/components/layout/Topbar'
import DeliveryRunsClient from '@/components/delivery/DeliveryRunsClient'

export default async function DeliveryRunsPage() {
  const session = await verifySession()
  if (!['Admin', 'Director', 'Manager', 'SuperAdmin'].includes(session.role)) redirect('/')

  return (
    <div>
      <Topbar title="Delivery Runs — Private Partner" />
      <div className="p-4 sm:p-8 max-w-4xl space-y-6">
        <DeliveryRunsClient />
      </div>
    </div>
  )
}
