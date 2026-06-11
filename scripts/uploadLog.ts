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
Build: B2B Account Request Review Flow
Commit: 30665a7

---

## What was built

### Complete B2B Account Request Review Flow

When a customer submits "Request Business Account" on the shop login page,
admins now have a full review workflow — nothing gets lost.

### What was built

**1. /admin/account-requests page**
- Status tabs: Pending / Contacted / Converted / Rejected
- Per-request actions:
  - ✓ Mark Contacted — moves to Contacted tab
  - Create Account → — opens /admin/customer-accounts pre-filled with name, email, company from the request
  - ✓ Mark Converted — marks the request closed
  - ✕ Reject — with optional internal note, confirm dialog
  - ↩ Reopen — move rejected back to pending
  - + Add note — internal notes editable inline at any time

**2. Notification Bell**
- Pending account requests now appear in the 🔔 bell for Admin/Manager users
- Shows: '🆕 Account Request: [Company Name]' per request
- Included in urgent count (red badge)

**3. Push notification on submit**
- When customer submits a request, push notification fires to all subscribed Admin/Manager browsers immediately

**4. Admin home page (/admin)**
- Amber action banner: "X account requests awaiting review →"
- New nav card: 🆕 Account Requests (with pending count badge)

**5. Customer Accounts prefill**
- "Create Account →" from request passes name, email, company as URL params
- /admin/customer-accounts opens with form pre-filled and modal auto-opened
- Company hint shown: "Requested company: [name] — find and select it above"

---

## Files created
| File | Purpose |
|---|---|
| app/(dashboard)/admin/account-requests/page.tsx | Review UI — status tabs, request cards, actions |
| app/api/admin/account-requests/route.ts | GET list |
| app/api/admin/account-requests/[id]/route.ts | PATCH status/notes |

## Files modified
| File | Change |
|---|---|
| lib/notifications.ts | Added account_request type — surfaced in bell for Admin/Manager |
| components/layout/NotificationBell.tsx | 🆕 emoji + 'Account Request' label |
| app/shop/login/actions.ts | Fire sendPushToManagers() on new request |
| app/(dashboard)/admin/page.tsx | Amber banner + nav card with count |
| app/(dashboard)/admin/customer-accounts/page.tsx | Accept ?prefill= query param |
| components/admin/CustomerAccountsTable.tsx | Accept prefill prop, auto-open form, hint |

---

## Flow (end to end)
1. Customer fills "Request Business Account" → DB saved + push fires + email sent
2. Admin sees 🔔 badge → click → "🆕 Account Request: Tech Co" → click → /admin/account-requests
3. Review: click "✓ Mark Contacted" (call the company)
4. Click "Create Account →" → /admin/customer-accounts opens pre-filled → pick company from CRM → set password → Create
5. Back to /admin/account-requests → "✓ Mark Converted"

---

## Rollback
git checkout 69ba002 -- lib/notifications.ts components/layout/NotificationBell.tsx app/shop/login/actions.ts app/(dashboard)/admin/page.tsx app/(dashboard)/admin/customer-accounts/page.tsx components/admin/CustomerAccountsTable.tsx
# Drop new files: git rm app/(dashboard)/admin/account-requests/page.tsx app/api/admin/account-requests/route.ts "app/api/admin/account-requests/[id]/route.ts"

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
