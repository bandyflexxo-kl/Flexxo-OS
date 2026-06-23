import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'

function CoverageBar({ pct }: { pct: number }) {
  const color = pct === 0 ? 'bg-red-400' : pct < 30 ? 'bg-orange-400' : pct < 70 ? 'bg-amber-400' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
        <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums w-8 text-right ${
        pct === 0 ? 'text-red-600' : pct < 30 ? 'text-orange-600' : pct < 70 ? 'text-amber-700' : 'text-green-700'
      }`}>
        {pct}%
      </span>
    </div>
  )
}

export default async function PhotoCoveragePage() {
  const session = await verifySession()
  if (!['Admin', 'Director'].includes(session.role)) {
    return (
      <div>
        <Topbar title="Photo Coverage" />
        <div className="p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  const products = await prisma.product.findMany({
    where:  { isActive: true },
    select: {
      brand:              true,
      googleDrivePhotoId: true,
      category:           { select: { name: true, parentCategory: { select: { name: true } } } },
    },
  })

  const total     = products.length
  const withPhoto = products.filter(p => p.googleDrivePhotoId).length
  const globalPct = total > 0 ? Math.round((withPhoto / total) * 100) : 0

  // ── By brand ──────────────────────────────────────────────────────────────
  type BrandEntry = { total: number; withPhoto: number }
  const brandMap = new Map<string, BrandEntry>()
  for (const p of products) {
    const brand = p.brand?.trim() || '(No Brand)'
    const entry = brandMap.get(brand) ?? { total: 0, withPhoto: 0 }
    entry.total++
    if (p.googleDrivePhotoId) entry.withPhoto++
    brandMap.set(brand, entry)
  }

  const byBrand = [...brandMap.entries()]
    .map(([brand, e]) => ({ brand, total: e.total, withPhoto: e.withPhoto, pct: Math.round((e.withPhoto / e.total) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total)  // worst coverage first, then most products

  // ── By category ───────────────────────────────────────────────────────────
  type CatEntry = { total: number; withPhoto: number; parent: string | null }
  const catMap = new Map<string, CatEntry>()
  for (const p of products) {
    const catName = p.category.name
    const parent  = p.category.parentCategory?.name ?? null
    const entry   = catMap.get(catName) ?? { total: 0, withPhoto: 0, parent }
    entry.total++
    if (p.googleDrivePhotoId) entry.withPhoto++
    catMap.set(catName, entry)
  }

  const byCategory = [...catMap.entries()]
    .map(([cat, e]) => ({ cat, parent: e.parent, total: e.total, withPhoto: e.withPhoto, pct: Math.round((e.withPhoto / e.total) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total)

  // Priority focus: brands with ≥10 products and <50% coverage — biggest opportunity
  const focusBrands = byBrand.filter(b => b.total >= 10 && b.pct < 50)

  return (
    <div>
      <Topbar
        title="Photo Coverage"
        actions={<Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Admin</Link>}
      />
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl space-y-8">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900">{total.toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-0.5">Total active products</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-green-600">{withPhoto.toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-0.5">With photos</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-red-500">{(total - withPhoto).toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-0.5">Missing photos</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-blue-600">{globalPct}%</p>
            <p className="text-sm text-gray-500 mt-0.5">Overall coverage</p>
          </div>
        </div>

        {/* ── Quick action banner ── */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="text-sm">
            <p className="font-semibold text-blue-800">To improve coverage:</p>
            <p className="text-blue-700 mt-0.5">
              Upload photos to Google Drive named after QNE item codes (e.g. <code className="bg-blue-100 px-1 rounded font-mono">HP85A.jpg</code>),
              then go to <strong>Product Catalog → Scan All Photos</strong>. Token Jaccard matching now finds partial name matches too.
            </p>
          </div>
          <Link
            href="/admin/products"
            className="shrink-0 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Catalog →
          </Link>
        </div>

        {/* ── Priority focus ── */}
        {focusBrands.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-800 mb-3">
              Priority: brands with ≥10 products &amp; &lt;50% coverage
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {focusBrands.slice(0, 12).map(b => (
                <div key={b.brand} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-gray-800 truncate" title={b.brand}>{b.brand}</p>
                  <CoverageBar pct={b.pct} />
                  <p className="text-xs text-gray-400">{b.withPhoto} / {b.total} products</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── By brand table ── */}
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3">Coverage by Brand ({byBrand.length} brands)</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Brand</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-20">Total</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-20">Photos</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-20">Missing</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600 w-40">Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byBrand.map(b => (
                  <tr key={b.brand} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{b.brand}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{b.total}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 tabular-nums">{b.withPhoto}</td>
                    <td className="px-4 py-2.5 text-right text-red-500 tabular-nums">{b.total - b.withPhoto}</td>
                    <td className="px-4 py-2.5">
                      <CoverageBar pct={b.pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── By category table ── */}
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3">Coverage by Category ({byCategory.length} categories)</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600">Parent</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-20">Total</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-20">Photos</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-20">Missing</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600 w-40">Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byCategory.map(c => (
                  <tr key={c.cat} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{c.cat}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{c.parent ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{c.total}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 tabular-nums">{c.withPhoto}</td>
                    <td className="px-4 py-2.5 text-right text-red-500 tabular-nums">{c.total - c.withPhoto}</td>
                    <td className="px-4 py-2.5">
                      <CoverageBar pct={c.pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
