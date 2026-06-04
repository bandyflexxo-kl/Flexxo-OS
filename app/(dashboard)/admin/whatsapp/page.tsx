import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import WhatsAppSessions from '@/components/admin/WhatsAppSessions'

export default async function WhatsAppAdminPage() {
  const session = await verifySession()
  if (!isPrivilegedRole(session.role)) redirect('/')

  // Fetch all active internal users (not B2B clients)
  const users = await prisma.user.findMany({
    where: {
      isActive:  true,
      userRoles: {
        some: {
          revokedAt: null,
          role: { name: { notIn: ['B2B Client'] } },
        },
      },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title="WhatsApp Sessions" />
      <main className="flex-1 p-6 max-w-3xl space-y-6">
        <div className="flex items-start justify-between">
          <p className="text-sm text-gray-500">
            Each salesperson scans once — messages are then sent from their personal number.
          </p>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline shrink-0">← Admin</Link>
        </div>
        <WhatsAppSessions users={users} />
      </main>
    </div>
  )
}
