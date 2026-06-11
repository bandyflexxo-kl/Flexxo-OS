import { deleteSession, deleteShopSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export async function POST() {
  // Detect which context triggered logout (shop or CRM) via Referer header
  const hdrs = await headers()
  const referer = hdrs.get('referer') ?? ''
  const isShopLogout = referer.includes('/shop')

  // Delete both cookies — belt-and-suspenders so neither session lingers.
  // This is intentional: if the user explicitly logs out, clear everything.
  await deleteSession()       // CRM cookie (crm_session)
  await deleteShopSession()   // Shop cookie (shop_session)

  // Redirect to the appropriate login page
  redirect(isShopLogout ? '/shop/products' : '/login')
}
