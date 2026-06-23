import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets:  ['latin'],
  variable: '--font-jakarta',
  display:  'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s — Flexxo',
    default:  'Flexxo — Your 1-Stop Office Partner',
  },
  description: 'Flexxo supplies stationery, pantry, hygiene, furniture and office essentials to businesses across Malaysia. Browse 3,700+ products and request a B2B quotation today.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
