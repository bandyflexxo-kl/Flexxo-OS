import { verifySession } from '@/lib/session'
import Sidebar from '@/components/layout/Sidebar'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession()

  if (session.mustChangePassword) {
    redirect('/change-password')
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-auto">{children}</main>
    </div>
  )
}
