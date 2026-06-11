import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import UsersTable from '@/components/admin/UsersTable'

export default async function AdminUsersPage() {
  const session = await verifySession()
  if (session.role !== 'Admin') {
    return (
      <div>
        <Topbar title="Users" />
        <div className="p-4 sm:p-6 lg:p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  const [rawUsers, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id:                true,
        name:              true,
        email:             true,
        mobileNo:          true,
        isActive:          true,
        mustChangePassword: true,
        lastLoginAt:       true,
        userRoles: {
          where:   { revokedAt: null },
          orderBy: { grantedAt: 'desc' },
          take:    1,
          select:  { role: { select: { name: true } } },
        },
      },
    }),
    prisma.role.findMany({ orderBy: { name: 'asc' } }),
  ])

  const users = rawUsers.map(u => ({
    id:                 u.id,
    name:               u.name,
    email:              u.email,
    mobileNo:           u.mobileNo,
    isActive:           u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt:        u.lastLoginAt?.toISOString() ?? null,
    role:               u.userRoles[0]?.role?.name ?? 'Viewer',
  }))

  const needsPassword = users.filter(u => u.email.endsWith('@flexxo.internal') && u.mustChangePassword === false && u.lastLoginAt === null).length
  const neverLoggedIn = users.filter(u => u.lastLoginAt === null).length

  return (
    <div>
      <Topbar
        title="User Management"
        actions={
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Admin
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900">{users.length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Total users</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-orange-600">{neverLoggedIn}</p>
            <p className="text-sm text-gray-500 mt-0.5">Never logged in</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-blue-600">{users.filter(u => u.isActive).length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Active accounts</p>
          </div>
        </div>

        {needsPassword > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
            <strong>{needsPassword} salesperson account{needsPassword !== 1 ? 's' : ''}</strong> still have placeholder passwords.
            Use the <strong>Set Password</strong> button below to assign real passwords so they can log in.
          </div>
        )}

        <UsersTable users={users} roles={roles} currentUserId={session.userId} />
      </div>
    </div>
  )
}
