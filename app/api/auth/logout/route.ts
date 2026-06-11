import { deleteSession, getOptionalSession } from '@/lib/session'
import { redirect } from 'next/navigation'

export async function POST() {
  // Read role BEFORE deleting the session cookie
  const session = await getOptionalSession()
  const isB2BClient = session?.role === 'B2B Client'

  await deleteSession()

  // B2B clients return to the shop product page (not the CRM login)
  redirect(isB2BClient ? '/shop/products' : '/login')
}
