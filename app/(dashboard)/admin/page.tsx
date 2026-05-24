import { verifySession } from '@/lib/session'
import Topbar from '@/components/layout/Topbar'

export default async function AdminPage() {
  const session = await verifySession()

  return (
    <div>
      <Topbar title="Admin" />
      <div className="p-8 max-w-xl">
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <p className="text-xs text-gray-400">Logged in as</p>
            <p className="text-sm font-medium text-gray-900">{session.name}</p>
            <p className="text-sm text-gray-500">{session.email}</p>
            <p className="text-xs text-gray-400 mt-0.5">Role: {session.role}</p>
          </div>
          <hr />
          <p className="text-sm text-gray-400">User management, role assignments, and system settings coming in a future phase.</p>
        </div>
      </div>
    </div>
  )
}
