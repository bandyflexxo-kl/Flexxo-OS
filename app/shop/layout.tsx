import type { Metadata } from 'next'
import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import ShopNav from '@/components/shop/ShopNav'
import ShopBottomNav from '@/components/shop/ShopBottomNav'
import PromoBanner from '@/components/shop/PromoBanner'
import OfflineBanner from '@/components/shop/OfflineBanner'
import WhatsAppButton from '@/components/shop/WhatsAppButton'

// T4-7: Override root metadata with shop-specific copy (never "Internal Sales CRM")
export const metadata: Metadata = {
  title: {
    template: '%s — Flexxo Shop',
    default:  'Flexxo Shop — Your 1-Stop Office Partner',
  },
  description: 'Browse 3,700+ office products — stationery, pantry, hygiene, furniture & more. Fast KL delivery for B2B corporate buyers. Request a quotation today.',
  openGraph: {
    siteName:    'Flexxo Shop',
    title:       'Flexxo Shop — Your 1-Stop Office Partner',
    description: 'Browse 3,700+ office products for Malaysian businesses. B2B pricing, fast KL delivery.',
    url:         'https://flexxo-os.vercel.app/shop',
    type:        'website',
    images: [{
      url:    'https://flexxo-os.vercel.app/flexxo-logo.png',
      width:  400,
      height: 200,
      alt:    'Flexxo — Your 1-Stop Office Partner',
    }],
  },
}

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
      {/* T6-6: Offline / connectivity banner */}
      <OfflineBanner />
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
      {/* T4-9: Floating WhatsApp contact button — every page */}
      <WhatsAppButton />
    </div>
  )
}
