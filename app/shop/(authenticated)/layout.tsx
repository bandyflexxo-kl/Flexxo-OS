import { getOptionalSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import CartMerger from '@/components/shop/CartMerger'

/**
 * Auth guard for shop pages that require login (cart, quotations).
 * Redirects to login with returnUrl so user comes back after signing in.
 * Also mounts CartMerger to merge any guest localStorage cart into DB cart.
 */
export default async function ShopAuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalSession()

  if (!session || session.role !== 'B2B Client') {
    // Preserve the current URL as returnUrl so user returns after login
    const headersList = await headers()
    const referer     = headersList.get('referer') ?? ''
    const currentPath = referer
      ? new URL(referer).pathname + new URL(referer).search
      : '/shop/cart'
    const safeReturn  = currentPath.startsWith('/shop/') ? currentPath : '/shop/cart'
    redirect(`/shop/login?returnUrl=${encodeURIComponent(safeReturn)}`)
  }

  return (
    <>
      {/* Merges guest cart into DB cart on first authenticated page visit */}
      <CartMerger />
      {children}
    </>
  )
}
