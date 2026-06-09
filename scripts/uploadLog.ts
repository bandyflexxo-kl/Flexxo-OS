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
Build: Market Price Scout — AI-powered cheapest source finder
Commit: 8dbdf70

---

## What was built

**Feature: Market Price Scout** — visible at /market-scout in the sidebar (all CRM roles).

Paste a list of products NOT in your QNE catalogue → AI searches Malaysian retail platforms and returns cheapest prices from official/reliable stores only.

### Files created
| File | Purpose |
|---|---|
| lib/marketScout.ts | scoutProduct() — Claude API with web_search_20250305 tool; searches 8 Malaysian platforms |
| app/api/market-scout/route.ts | POST endpoint — Server-Sent Events stream, yields per-product results as they complete |
| app/(dashboard)/market-scout/page.tsx | UI — paste input, real-time progress, per-product result cards, sourcing tips panel |

### Files modified
| File | Change |
|---|---|
| components/layout/Sidebar.tsx | Added "Market Scout" nav item with search icon (all roles) |

---

## How it works

1. Go to /market-scout in the sidebar
2. Paste product list (one per line, max 20)
3. Click "Scout X items"
4. AI uses web search to find prices on:
   - Shopee Malaysia — Official Stores only
   - Lazada Malaysia — LazMall only
   - Lotus's Malaysia
   - Mr. DIY Malaysia
   - Popular Bookstore Malaysia
   - AEON Malaysia
   - Watsons Malaysia
   - Amazon Malaysia
5. Results appear one by one as Claude searches (~10–20s per product)
6. Each result shows: platform, store name, price (MYR), unit, stock status, direct link
7. Cheapest in-stock option highlighted in green

### Sourcing tips panel
Expand "Other ways to find cheapest sources" for:
1688.com, Alibaba.com, MyHD, Carousell Business, PriceArea.com.my, Shopee Wholesale, Brand Direct, Hatten Trade

---

## Constraints
- Uses existing ANTHROPIC_API_KEY (no new subscription)
- No QNE interaction (Principle 10)
- Max 20 products per search run

---

## Rollback
git checkout a11996d -- lib/marketScout.ts app/api/market-scout/route.ts components/layout/Sidebar.tsx

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
