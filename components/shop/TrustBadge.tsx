/**
 * TrustBadge — social proof strip with security/trust signals.
 * Shown on product detail page and cart/checkout.
 *
 * Condition 13: visible on product detail AND cart/checkout.
 */

const BADGES = [
  {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.104-.541-4.083-1.487-5.808L12 2.964z"/>
      </svg>
    ),
    label: 'Verified B2B Supplier',
    sub:   'Registered in Malaysia',
  },
  {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
      </svg>
    ),
    label: 'Secure Ordering',
    sub:   'Your data is protected',
  },
  {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/>
      </svg>
    ),
    label: 'KL Delivery Available',
    sub:   'Same-day or next-day',
  },
  {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.091v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/>
      </svg>
    ),
    label: 'Dedicated Sales Rep',
    sub:   'Human support always',
  },
] as const

export default function TrustBadge({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-3">
        {BADGES.map(b => (
          <div key={b.label} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="text-green-500">{b.icon}</span>
            <span>{b.label}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="border border-gray-100 rounded-xl bg-gray-50/50 p-4">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Why Flexxo?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {BADGES.map(b => (
          <div key={b.label} className="flex items-start gap-2.5">
            <span className="text-green-500 mt-0.5 shrink-0">{b.icon}</span>
            <div>
              <p className="text-xs font-semibold text-gray-700">{b.label}</p>
              <p className="text-[11px] text-gray-400">{b.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
