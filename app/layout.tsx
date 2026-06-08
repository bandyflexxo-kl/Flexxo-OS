import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    template: '%s — Flexxo',
    default:  'Flexxo — Your 1-Stop Office Partner',
  },
  description: 'Flexxo supplies stationery, pantry, hygiene, furniture and office essentials to businesses across Malaysia. Browse 3,700+ products and request a B2B quotation today.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
