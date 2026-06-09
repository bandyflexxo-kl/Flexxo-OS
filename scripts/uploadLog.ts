/**
 * scripts/uploadLog.ts
 * Upload an App Improvement Log entry to Google Drive as a Google Doc.
 * Usage: npx tsx scripts/uploadLog.ts
 *
 * Requires admin user to have a googleRefreshToken with drive.file scope.
 * If the current token only has drive.readonly scope, this will print
 * the log locally and instruct the user to re-authorize.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const LOG_FOLDER_ID = '14KX8_UaoFxN2lfWidcM-hWQurGK3G_ID'

const LOG_CONTENT = `# Flexxo CRM — App Improvement Log
Date: 9 June 2026
Build: B2B Shop — Account Page + QNE Last-Sale-Price Pricing
Commit: 69ba002

---

## What was built

### 1. /shop/account Page (was a 404)
B2B clients can now access their account page from the top nav "Account" link.

| Section | What it does |
|---|---|
| Profile card | Shows name, email, company, mobile, last login |
| Change password | Current + new + confirm — validated client-side + API |
| Sign out | Clean sign out button |

### 2. Forgot Password hint (login page)
"Forgot password?" link on login page → expands to contact instructions (email admin@flexxo.com.my). No self-service reset needed — passwords are admin-managed.

### 3. Bottom nav Account tab fix
Mobile bottom nav "Account" tab now links to /shop/account instead of triggering sign-out.

### 4. QNE Last-Sale-Price × 1.20 Pricing
ALL visitors (logged in B2B client or anonymous guest) now see the same price:
  **Display price = QNE last invoiced price × 1.20**

Fallback: if QNE price not yet synced, falls back to cost × margin as before.

---

## Files created
| File | Purpose |
|---|---|
| app/shop/(authenticated)/account/page.tsx | Account page (profile + change password + sign out) |
| app/api/portal/account/route.ts | GET profile, PATCH change password |
| lib/qnePriceSync.ts | syncQnePrices() — fetches last 200 invoices from QNE, extracts unit prices per item code, updates products.qne_last_sale_price |
| app/api/admin/qne/sync-prices/route.ts | POST — Admin/Manager trigger for QNE price sync |
| components/admin/QnePriceSyncPanel.tsx | Admin UI widget on /admin with Sync button + VPN reminder |

## Files modified
| File | Change |
|---|---|
| prisma/schema.prisma | Added qneLastSalePrice + qneLastSalePriceAt to Product model |
| app/api/portal/products/route.ts | QNE price × 1.20 priority; margin fallback |
| app/api/portal/products-public/route.ts | Same pricing logic |
| app/shop/login/page.tsx | Added "Forgot password?" hint section |
| components/shop/ShopBottomNav.tsx | Account tab → /shop/account instead of logout form |
| app/(dashboard)/admin/page.tsx | Added QnePriceSyncPanel |

---

## How to sync QNE prices

1. Ensure Radmin VPN (Flexxokl) is active
2. Go to /admin (CRM)
3. Click "↻ Sync Prices" in the QNE Shop Prices Sync panel
4. Prices update immediately — shop refreshes within 5 min (CDN cache TTL)

---

## Rollback
git checkout 8dbdf70 -- prisma/schema.prisma app/api/portal/products/route.ts app/api/portal/products-public/route.ts app/shop/login/page.tsx components/shop/ShopBottomNav.tsx app/(dashboard)/admin/page.tsx
# Also drop new files if needed:
# git rm app/shop/(authenticated)/account/page.tsx app/api/portal/account/route.ts lib/qnePriceSync.ts app/api/admin/qne/sync-prices/route.ts components/admin/QnePriceSyncPanel.tsx

---

## Next most worthy step

**Phase 2A — Auto-Send on Approval**
- When Bandy clicks Approve on a quotation, system auto-sends email + WhatsApp
- Eliminates the manual "Send" click after every approval
- File: app/api/quotations/[id]/approve/route.ts — wire existing sendQuotationEmail + Baileys
- Estimated: 1 day
`

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { google }  = await import('googleapis')

  const admin = await prisma.user.findFirst({
    where:  { email: 'admin@flexxo.com.my' },
    select: { googleRefreshToken: true },
  })

  if (!admin?.googleRefreshToken) {
    console.log('No Google refresh token found for admin user.')
    console.log('Please log in at /admin/settings and connect Google Drive first.')
    console.log('\n─── LOG CONTENT (copy to Drive manually) ───\n')
    console.log(LOG_CONTENT)
    await prisma.$disconnect()
    return
  }

  // Set up OAuth2 client
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/auth/google/callback`,
  )
  oauth2.setCredentials({ refresh_token: admin.googleRefreshToken })

  const drive = google.drive({ version: 'v3', auth: oauth2 })

  const fileName = `SmartOrder_${new Date().toISOString().slice(0, 10)}.md`

  try {
    const res = await drive.files.create({
      requestBody: {
        name:    fileName,
        parents: [LOG_FOLDER_ID],
        // Plain text file — readable in Drive
        mimeType: 'text/plain',
      },
      media: {
        mimeType: 'text/plain',
        body:     LOG_CONTENT,
      },
    })
    console.log(`✅ Log uploaded to Google Drive: ${fileName}`)
    console.log(`   File ID: ${res.data.id}`)
    console.log(`   View at: https://drive.google.com/file/d/${res.data.id}/view`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('insufficient') || msg.includes('scope') || msg.includes('403')) {
      console.log('⚠ Drive scope insufficient — current token has drive.readonly only.')
      console.log('  To enable log uploads: go to /admin/settings → Disconnect Google → Reconnect')
      console.log('  (The reconnect will request drive.file scope in addition to readonly)')
      console.log('\n─── LOG CONTENT (copy to Drive manually) ───\n')
      console.log(LOG_CONTENT)
    } else {
      console.error('Drive upload error:', msg)
      console.log('\n─── LOG CONTENT ───\n')
      console.log(LOG_CONTENT)
    }
  }

  await prisma.$disconnect()
}

main().catch(console.error)
