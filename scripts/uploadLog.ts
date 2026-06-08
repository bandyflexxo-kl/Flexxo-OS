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
Date: ${new Date().toLocaleDateString('en-MY', { year: 'numeric', month: 'long', day: 'numeric' })}
Build: Smart Order (Text Paste + Photo → Auto Quote)
Commit: b9e07cc

---

## What was built

**Feature: Smart Order — salesperson only, CRM QuotationBuilder**

Eliminates manual line-item entry when a client sends a WhatsApp list or photo.
Before: 15–30 min typing per 38-item quote. After: ~2 min confirm + click.

### Files created
| File | Purpose |
|---|---|
| lib/smartOrder.ts | Item list parser + token-Jaccard fuzzy catalogue matcher |
| app/api/smart-order/parse-text/route.ts | CRM-auth POST: text → MatchedLine[] |
| app/api/smart-order/scan-image/route.ts | CRM-auth POST: photo → Claude Vision → MatchedLine[] |
| components/SmartOrderModal.tsx | Review UI with confidence badges, dropdown alternatives, bulk-add |
| scripts/testSmartOrder.ts | Test script: match 38-item list + create draft quotation |

### Files modified
| File | Change |
|---|---|
| components/quotations/QuotationBuilder.tsx | Added 3rd tab "✨ Smart Add" → renders SmartOrderModal |
| lib/smartOrder.ts | Matching quality fixes: stop words expanded, min 2-token intersection rule, single-token boost |

---

## Matching results on 38-item client test list (expanded to 57 lines with variants)

| Tier | Count | % |
|---|---|---|
| ✅ Auto-matched (≥55% token overlap) | 21 | 37% |
| ⚠ Review match (28–55%) | 30 | 53% |
| ❌ Not found (<28%) | 6 | 10% |

**Not found items** (salesperson enters free-text price):
- Mechanical Pencils Lead (product exists in DB as PILOT PPL but score too low)
- Light Duty Scissors (no scissors products visible in catalogue)
- Loytape 48mm (only 18mm variant exists)
- Staples No10 (catalogue has ASTAR NO.10 but model# matching low)
- Puncher DP480 / DP700 (model numbers don't match catalogue)

**Draft quotation created:** QT-2026-0002
- Company: 43 FLORIST (first alphabetical — test only)
- Subtotal: MYR 951.84
- Open at: http://localhost:3000/quotations/5b451bce-cdd0-4564-b1e8-d6928bfe586e

---

## Quality improvements made during testing

1. **Stop word expansion**: Added "light", "duty", "heavy", "size", "colour" etc. to stop words.
   - Before: "Light Duty Scissors" → matched "STROBE LIGHT" (false positive)
   - After: "Light Duty Scissors" → no match (correctly flagged for manual entry)

2. **Minimum intersection rule**: Multi-token queries (3+ tokens) now require ≥2 token hits.
   - Prevents single-word coincidences scoring as medium confidence

3. **Single-token boost**: Single-word queries (Calculator, Eraser) now score ≥0.35 if token appears in product name.
   - Before: Calculator → ❌ not found (score 0.25)
   - After: Calculator → ⚠ review (shows CANON AS-120 II as top option)

---

## How to use Smart Order

1. Open any quotation in CRM (localhost:3000)
2. Scroll to "Add Item" section
3. Click **✨ Smart Add** tab
4. Either paste a text list OR upload a WhatsApp photo
5. Review matched items (green = auto, yellow = pick, red = enter manually)
6. Click "Add X items to Quote"

---

## Constraints applied
- Principle 10: NO writes to QNE — quotation is CRM-only draft
- Principle 5: NOT deployed to Vercel — localhost only until approved
- Photo scanning requires ANTHROPIC_API_KEY in .env.local

---

## Next most worthy step

**Phase 2A — Auto-Send on Approval**
- When Bandy clicks Approve, automatically send quotation by email + WhatsApp (from salesperson's Baileys number)
- Eliminates the manual "Send to Customer" click after every approval
- Files to change: app/api/quotations/[id]/approve/route.ts (wire existing send + WhatsApp logic)
- Estimated effort: 1 day
- No new infrastructure — Baileys bridge already built, send logic already exists
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
