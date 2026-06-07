import { verifySession }   from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'
import { redirect }         from 'next/navigation'
import QneSandboxClient     from './QneSandboxClient'

export const metadata = { title: 'QNE Sandbox — Flexxo' }

export default async function QneSandboxPage() {
  const session = await verifySession().catch(() => null)
  if (!session || !isPrivilegedRole(session.role)) redirect('/login')
  return <QneSandboxClient />
}
