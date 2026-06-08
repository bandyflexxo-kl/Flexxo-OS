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
Build: Smart Order v2 — Stock-First + Order-Frequency Brand Priority
Commit: c40fde6

---

## What changed

**lib/smartOrder.ts** — matching engine updated with business priority rules

Bandy's rule: quote what we have in stock first; if no stock, quote most-ordered brand; only then fall back to best name-match.

### Files modified
| File | Change |
|---|---|
| lib/smartOrder.ts | Added isVisible + orderFreq to CatalogueProduct; fetchCatalogue() now loads order frequency via quotationItem.groupBy; 1.35x score boost for stocked items + 0.004×orderFreq bonus |

### Files created
| File | Purpose |
|---|---|
| scripts/checkCatalogue.ts | Audit: catalogue size, APLUS counts, top-15 ordered products |

---

## Matching results comparison

| Version | Auto ✅ | Review ⚠ | Not Found ❌ |
|---|---|---|---|
| v1 initial | 21 | 27 | 9 |
| v2 quality fixes (stop words + min intersection) | 21 | 27 | 9 |
| v3 single-token boost | 21 | 30 | 6 |
| v4 stock+frequency priority (this build) | **29** | **22** | 6 |

**8 items moved from Review → Auto** by preferring stocked (isVisibleToCustomers=true) products.

### Scoring logic
- Raw Jaccard score from token overlap (unchanged)
- adjustedScore = rawScore × 1.35 (if isVisible=true) + min(orderFreq,20) × 0.004
- Confidence tier uses adjustedScore; display capped at 1.00
- Only applied to candidates with rawScore ≥ 0.15

### Not found (6 items — same as before, salesperson enters free-text):
- Mechanical Pencils Lead
- Light Duty Scissors (no scissors in visible catalogue)
- Loytape 48mm (only 18mm variant stocked)
- Staples No10 (ASTAR NO.10 exists but score 0.28, below threshold)
- Puncher DP480 / DP700 (model codes don't match)

### Draft quotation created
**QT-2026-0003** — 43 FLORIST (test), MYR 1,488.69
http://localhost:3000/quotations/b754565e-bb20-4d92-a5ff-3566e4b42bd3

---

## Rollback
To revert matching engine only: git checkout bf2b954 lib/smartOrder.ts

---

## Next most worthy step

**Phase 2A — Auto-Send on Approval**
- When Bandy clicks Approve, automatically email + WhatsApp quotation (from salesperson's Baileys number)
- Eliminates the manual "Send to Customer" click after every approval
- File to change: app/api/quotations/[id]/approve/route.ts
- Estimated effort: 1 day — existing send logic just needs wiring into approve route
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
