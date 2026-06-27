import type { Metadata } from 'next'
import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import ShopNav from '@/components/shop/ShopNav'
import ShopBottomNav from '@/components/shop/ShopBottomNav'
import PromoBanner from '@/components/shop/PromoBanner'
import OfflineBanner from '@/components/shop/OfflineBanner'
import WhatsAppButton from '@/components/shop/WhatsAppButton'
import NavigationProgress from '@/components/shop/NavigationProgress'

// T4-7: Override root metadata with shop-specific copy (never "Internal Sales CMS")
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
  const session = await getOptionalShopSession()
  const isB2B   = session?.role === 'B2B Client'

  // Only fetch heavy data for authenticated B2B clients
  const [company, dbCartCount] = isB2B && session?.customerCompanyId
    ? await Promise.all([
        prisma.company.findUnique({
          where:  { id: session.customerCompanyId },
          select: {
            name: true,
            // Dedicated salesperson — drives the floating WhatsApp button
            assignments: {
              where:   { unassignedAt: null },
              orderBy: { isPrimary: 'desc' },
              take:    1,
              select:  { user: { select: { name: true, mobileNo: true } } },
            },
          },
        }),
        prisma.quotationItem.count({
          where: { quotation: { status: 'cart', createdById: session.userId } },
        }),
      ])
    : [null, null]

  const companyName  = company?.name ?? null
  const cartCount    = isB2B ? (dbCartCount ?? 0) : null
  const salesperson  = company?.assignments[0]?.user ?? null
  // Salesperson's own number first; company-wide number as fallback so a
  // logged-in client always has a contact channel.
  const waPhone = salesperson?.mobileNo ?? process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Green progress bar — appears at very top during every route transition */}
      <NavigationProgress />
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
      {/* T4-9: Floating WhatsApp button — logged-in B2B clients only,
          linked to their dedicated salesperson's number */}
      {isB2B && (
        <WhatsAppButton
          phone={waPhone}
          salespersonName={salesperson?.name ?? null}
        />
      )}
    </div>
  )
}
