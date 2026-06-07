import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import ShopNav from '@/components/shop/ShopNav'
import ShopBottomNav from '@/components/shop/ShopBottomNav'
import PromoBanner from '@/components/shop/PromoBanner'

/**
 * Shop shell layout — always visible, no auth guard.
 * ShopNav shows different UI for guests vs logged-in B2B clients.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalSession()
  const isB2B   = session?.role === 'B2B Client'

  // Only fetch heavy data for authenticated B2B clients
  const [company, dbCartCount] = isB2B && session?.customerCompanyId
    ? await Promise.all([
        prisma.company.findUnique({
          where:  { id: session.customerCompanyId },
          select: { name: true },
        }),
        prisma.quotationItem.count({
          where: { quotation: { status: 'cart', createdById: session.userId } },
        }),
      ])
    : [null, null]

  const companyName  = company?.name ?? null
  const cartCount    = isB2B ? (dbCartCount ?? 0) : null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Condition 23: dismissible promo banner above nav */}
      <PromoBanner />
      <ShopNav
        companyName={companyName}
        dbCartCount={cartCount}
      />
      {/* pb-20 sm:pb-8 — clearance for mobile bottom nav bar */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8 pb-20 sm:pb-8">
        {children}
      </main>
      <ShopBottomNav
        isLoggedIn={isB2B}
        dbCartCount={cartCount}
      />
    </div>
  )
}
