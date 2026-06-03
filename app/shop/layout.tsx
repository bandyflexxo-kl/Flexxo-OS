import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import ShopNav from '@/components/shop/ShopNav'

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

  return (
    <div className="min-h-screen bg-gray-50">
      <ShopNav
        companyName={company?.name ?? null}
        dbCartCount={isB2B ? (dbCartCount ?? 0) : null}
      />
      <main className="max-w-6xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  )
}
