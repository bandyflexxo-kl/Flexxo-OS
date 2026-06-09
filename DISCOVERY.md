# Flexxo Sales OS — Codebase Discovery
Generated: 10 June 2026

## Project Structure

This is a **Next.js 15 App Router** project (not a `src/` layout).
Key directories:
```
app/                    ← Next.js App Router pages
  (dashboard)/          ← CRM: companies, contacts, pipeline, quotations, admin
  shop/                 ← B2B portal: products, cart, orders, account
  api/                  ← All API routes
components/             ← Shared components
  shop/                 ← HeroSection, ProductCard, ProductsClientPage, ShopNav, etc.
  admin/                ← Admin panels, tables
  layout/               ← Sidebar, Topbar, NotificationBell
  ui/                   ← Generic UI primitives
constants/              ← zIndex.ts (Z export)
lib/                    ← Prisma, session, email, QNE clients, pricing
prisma/                 ← schema.prisma, migrations, seed
scripts/                ← One-off data scripts (runSync, uploadLog, etc.)
public/                 ← Static assets (flexxo-logo.png, etc.)
```

## Key Shop Components

| File | Purpose |
|------|---------|
| `components/shop/HeroSection.tsx` | Full-width hero: tagline, CTA buttons, trust stats. Server component. Uses `next/image` with `priority`. Entry animation via `animate-fade-in-up`. |
| `components/shop/ProductCard.tsx` | Individual product card. `next/image fill` + `shop-photo-container`. 3-state add-to-cart. |
| `components/shop/ProductsClientPage.tsx` | Client component. Module-level product cache (5-min TTL). Category sidebar + mobile pills. Live search with autocomplete dropdown. |
| `components/shop/ShopNav.tsx` | Top navigation: logo, cart icon, login/account. |
| `components/shop/ShopBottomNav.tsx` | Mobile bottom tab bar (Shop / Cart / Account). |
| `components/shop/StickyCartBar.tsx` | Mobile sticky add-to-cart bar on product detail. |
| `components/shop/PromoBanner.tsx` | Dismissible promo banner above nav. |
| `components/shop/FlexxoSpinner.tsx` | Branded loading spinner (green arc). |

## Z-Index Constants

Already exists at `constants/zIndex.ts` (export `Z`):
```typescript
Z.heroContent    = 10
Z.promoBanner    = 20
Z.stickyNav      = 30
Z.bottomNav      = 40
Z.searchDropdown = 50
Z.tooltip        = 55
Z.stickyCart     = 60
Z.whatsappBtn    = 70
Z.offlineBanner  = 80
Z.drawer         = 100
Z.modalBackdrop  = 200
Z.modal          = 210
Z.toast          = 300
Z.overlay        = 400
```
No hardcoded `z-[N]` or `z-index:` values found anywhere else.

## CSS (app/globals.css)

- Dark mode: **intentionally disabled**. No `@media (prefers-color-scheme: dark)` block. Body always uses `background: #ffffff`.
- `@utility shop-photo-container` — `aspect-ratio: 1/1`, `contain: layout`, `position: relative`, `overflow: hidden`. Used by all product cards.
- `@keyframes fadeInUp` — transform only (no opacity from-state). No black-block risk.
- `animate-fade-in-up`, `animate-fade-in`, `reveal-hidden`, `reveal-visible` utilities.

## QNE Integration (lib/)

| File | Purpose |
|------|---------|
| `lib/qneClient.ts` | Auth (POST /Users/Login for token only), `qneGet<T>()` helper |
| `lib/qneSync.ts` | Customer import from QNE → staging table |
| `lib/qnePriceSync.ts` | Invoice price sync → `products.qneLastSalePrice` |
| `lib/qneFinancial.ts` | Aging summary, customer balance |
| `lib/qnePortfolio.ts` | Agent order summaries |

All data-reading functions use `qneGet<T>()` which issues only GET requests.
The `POST /Users/Login` is authentication only — no business data written to QNE.

## Image Handling

- **All images use `next/image`** — no raw `<img>` tags found in shop components.
- Product photos: `<Image fill unoptimized sizes="...">` inside `shop-photo-container` (1:1 aspect ratio).
- Hero logo: `<Image width={160} height={48} priority>`.
- Proxy endpoint: `/api/portal/photo/[id]` streams from Google Drive.

## Build Status

- TypeScript: 0 errors (after `as typeof prefill` → `as PrefillData` fix)
- Vercel: ✅ Ready (commit f47d2b1, 59s build time, deployed 10 June 2026)
- `vercel-build` script: `prisma generate && next build` (no `migrate deploy` — safe for Vercel)
