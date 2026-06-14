'use client'

/**
 * WhatsAppButton — T4-9 (revised)
 * Floating WhatsApp contact button — bottom-right, above bottom nav.
 *
 * Visibility: B2B logged-in clients ONLY. Guests never see it.
 * Phone: the client's dedicated salesperson (account manager) mobile number,
 *        passed from the shop layout. Falls back to NEXT_PUBLIC_WHATSAPP_PHONE
 *        when the assigned salesperson has no mobile number on file.
 *
 * z-index: Z.whatsappBtn (70) — above sticky nav (30) and bottom nav (40),
 * below modals (200) and toasts (300). (G-1 compliant)
 *
 * Must NOT overlap StickyCartBar (bottom-14) on product detail pages.
 * Positioned at bottom-20 sm:bottom-6 to clear both the bottom nav (56px)
 * and the StickyCartBar (60px) on mobile.
 */

import { Z } from '@/constants/zIndex'

/** Normalise a Malaysian phone for wa.me: digits only, leading 0 → 60. */
function toWaNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0'))  return '6' + digits
  if (digits.startsWith('60')) return digits
  return digits
}

export default function WhatsAppButton({
  phone,
  salespersonName,
}: {
  /** Salesperson mobile number — button renders nothing when null/empty. */
  phone:            string | null
  salespersonName?: string | null
}) {
  if (!phone || !phone.trim()) return null

  const firstName = salespersonName?.split(' ')[0]
  const message   = encodeURIComponent(
    firstName
      ? `Hi ${firstName}, I'd like to enquire about your products.`
      : "Hi Flexxo! I'd like to enquire about your products."
  )
  const waUrl = `https://wa.me/${toWaNumber(phone)}?text=${message}`

  return (
    <a
      href={waUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={firstName ? `Chat with ${firstName} on WhatsApp` : 'Chat with Flexxo on WhatsApp'}
      className="fixed right-4 bottom-20 sm:bottom-6 flex items-center justify-center w-13 h-13 rounded-full shadow-lg transition-transform hover:scale-110 active:scale-95"
      style={{
        zIndex:          Z.whatsappBtn,
        backgroundColor: '#25D366',   /* WhatsApp green — explicit, never inherited */
        width:           '52px',
        height:          '52px',
      }}
    >
      {/* WhatsApp SVG icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="white"
        className="w-6 h-6"
        aria-hidden="true"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    </a>
  )
}
