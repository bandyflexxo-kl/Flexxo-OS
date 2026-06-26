import { verifySession }    from '@/lib/session'
import Sidebar             from '@/components/layout/Sidebar'
import DashboardProviders  from '@/components/admin/DashboardProviders'
import { redirect }        from 'next/navigation'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession()

  if (session.mustChangePassword) {
    redirect('/change-password')
  }

  return (
    <DashboardProviders role={session.role}>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar role={session.role} />
        {/* pt-14: clearance for the fixed mobile topbar; removed at lg+ where topbar is hidden */}
        <main className="flex-1 flex flex-col overflow-auto pt-14 lg:pt-0">{children}</main>
      </div>
    </DashboardProviders>
  )
}
