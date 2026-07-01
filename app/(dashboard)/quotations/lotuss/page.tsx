import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/session'
import LotussMatchClient from './LotussMatchClient'

/**
 * /quotations/lotuss — Lotus's price-match tool (Salesperson / Admin / Director).
 * All data lives in the browser (localStorage) — nothing is stored in the DB.
 */
export default async function LotussMatchPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  if (!['Salesperson', 'Admin', 'Director', 'Manager', 'SuperAdmin'].includes(session.role)) redirect('/')
  return <LotussMatchClient />
}
