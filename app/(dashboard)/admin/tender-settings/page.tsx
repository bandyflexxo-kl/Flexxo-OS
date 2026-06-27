import { redirect }            from 'next/navigation'
import { verifySession }        from '@/lib/session'
import { canEditTenderSettings } from '@/lib/tenderAccess'
import { getTenderSettings }    from '@/lib/tenderSettings'
import Topbar                   from '@/components/layout/Topbar'
import TenderSettingsForm       from '@/components/tenders/TenderSettingsForm'

export const dynamic = 'force-dynamic'

export default async function TenderSettingsPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  if (!canEditTenderSettings(session.role)) redirect('/tenders')

  const settings = await getTenderSettings()

  return (
    <div>
      <Topbar title="Tender Settings" />
      <div className="p-6">
        <TenderSettingsForm initial={settings} />
      </div>
    </div>
  )
}
