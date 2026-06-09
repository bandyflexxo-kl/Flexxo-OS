# Flexxo Sales OS — Stage 1 Global Safety Setup
Date: 10 June 2026

## Checklist

| Task | Status | Notes |
|------|--------|-------|
| G-1: zIndex constants | ✅ Already complete | `constants/zIndex.ts` — 16 named layers, exported as `Z`. Zero hardcoded `z-[N]` or `z-index:` values found elsewhere. |
| G-2: CSS image containers | ✅ Added | `.product-card-image` (4/3) and `.hero-banner-image` (16/5) added to `app/globals.css`. Explicit `background-color` on both. |
| G-3: Dark mode bleed removed | ✅ Already done | No `@media (prefers-color-scheme: dark)` in globals.css. `body { background: #ffffff }` hardcoded. Animation uses transform-only (no opacity:0 from-state). Comment documents why. |
| G-4: lib/qne.ts read-only | ✅ Created | `lib/qne.ts` — facade with 4 read-only functions. Zero write method calls verified. Wraps `qneGet<T>()` from qneClient. |
| G-5: Build clean | ✅ 0 errors | TypeScript: 0 errors. Vercel: ✅ Ready (commit f47d2b1, 59s). |

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `DISCOVERY.md` | Created | Codebase map: structure, key components, z-index registry, CSS utilities, QNE integration |
| `app/globals.css` | Modified | Added `.product-card-image` (4:3) + `.hero-banner-image` (16:5) with explicit background colours |
| `lib/qne.ts` | Created | Read-only QNE facade: `getCustomerSummary`, `getCreditSummary`, `getAgentSummary`, `getInvoiceSummary` |
| `app/(dashboard)/admin/customer-accounts/page.tsx` | Modified (committed) | Fixed TypeScript `never` narrowing: `as typeof prefill` → explicit `PrefillData` type alias |

## G-1 Detail — zIndex Registry

```typescript
// constants/zIndex.ts
export const Z = {
  heroContent:    10,
  promoBanner:    20,
  stickyNav:      30,
  bottomNav:      40,
  searchDropdown: 50,
  tooltip:        55,
  stickyCart:     60,
  whatsappBtn:    70,
  offlineBanner:  80,
  drawer:         100,
  modalBackdrop:  200,
  modal:          210,
  toast:          300,
  overlay:        400,
}
```

Grep results (outside constants/zIndex.ts):
- `grep -r "z-\[" components/ app/` → **0 results**
- `grep -r "z-index:" components/ app/` → **1 comment line** (WhatsAppButton.tsx line 11 — comment only, not code)

## G-3 Detail — Dark Mode Prevention

`app/globals.css` contains no `@media (prefers-color-scheme: dark)` block.
`body` is always `background: #ffffff`.

`@keyframes fadeInUp` uses transform-only:
```css
from { transform: translateY(20px); }
to   { transform: translateY(0);    }
```
No `opacity: 0` in from-state → no black-block risk on Windows dark mode.

## G-4 Detail — QNE Read-Only Verification

```bash
grep -n "method.*POST|method.*PUT|method.*PATCH|method.*DELETE" lib/qne.ts
# → returns only the comment line (line 20), zero actual method calls
```

The `qneLogin()` in `qneClient.ts` uses `POST /Users/Login` for authentication only (fetches a bearer token). No business data is written to QNE.

## Deployment

All changes + 9 prior commits pushed to `origin/main` on 10 June 2026.
Vercel auto-deployed: https://flexxo-euj5xzflu-bandyflexxo-kls-projects.vercel.app ✅ Ready (59s)
