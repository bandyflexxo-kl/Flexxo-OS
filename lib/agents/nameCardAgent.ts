/**
 * lib/agents/nameCardAgent.ts
 *
 * Handles the Telegram name-card → account-opening flow:
 *
 *  1. Salesperson sends a name-card photo
 *     → Claude Vision extracts up to 7 fields
 *     → Redis session stores what was found
 *     → Bot lists missing fields and asks salesperson to fill them in
 *
 *  2. Salesperson sends follow-up text
 *     → Claude Haiku parses the reply, fills in remaining gaps
 *     → Once all 7 fields are present, bot asks for YES confirmation
 *
 *  3. Salesperson replies YES
 *     → TelegramAccountRequest saved to DB
 *     → All Telegram-linked Admins/Directors notified
 *
 *  4. Admin replies "approve <shortId>"
 *     → Company + Contact + Address + Assignment created
 *     → Salesperson notified
 *
 *  Admin can also reply "reject <shortId>" to decline.
 */

import Anthropic           from '@anthropic-ai/sdk'
import { prisma }          from '@/lib/prisma'
import { getRedis }        from '@/lib/redis'
import { sendHtml, esc }   from '@/lib/telegramBot'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountData {
  companyName?: string
  address?:     string
  ssmNumber?:   string  // company registration / SSM
  tinNumber?:   string  // income-tax number
  picName?:     string  // person in charge
  picPhone?:    string
  picEmail?:    string
}

interface AccountSession {
  step:               'collecting' | 'confirming'
  data:               AccountData
  salespersonUserId:  string
  salespersonName:    string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED: (keyof AccountData)[] = [
  'companyName', 'address', 'ssmNumber', 'tinNumber', 'picName', 'picPhone', 'picEmail',
]

const LABELS: Record<keyof AccountData, string> = {
  companyName: 'Company Name',
  address:     'Address',
  ssmNumber:   'SSM / Company Reg No.',
  tinNumber:   'TIN Number',
  picName:     'Person in Charge (Name)',
  picPhone:    'Person in Charge (Phone)',
  picEmail:    'Person in Charge (Email)',
}

const SESSION_TTL_SECS = 30 * 60  // 30 minutes

// ── Redis session ──────────────────────────────────────────────────────────────

function sessionKey(chatId: number): string {
  return `tg:acct_session:${chatId}`
}

async function getSession(chatId: number): Promise<AccountSession | null> {
  const redis = getRedis()
  if (!redis) return null
  return redis.get<AccountSession>(sessionKey(chatId))
}

async function setSession(chatId: number, session: AccountSession): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.set(sessionKey(chatId), session, { ex: SESSION_TTL_SECS })
}

export async function clearSession(chatId: number): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(sessionKey(chatId))
}

export async function hasActiveSession(chatId: number): Promise<boolean> {
  return (await getSession(chatId)) !== null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function missing(data: AccountData): (keyof AccountData)[] {
  return REQUIRED.filter(f => !data[f])
}

function summaryHtml(data: AccountData): string {
  return REQUIRED.map(f => {
    const val = data[f]
    return `• ${LABELS[f]}: ${val ? `<b>${esc(val)}</b>` : '<i>—</i>'}`
  }).join('\n')
}

// ── Claude: extract from photo ─────────────────────────────────────────────────

export async function extractFromPhoto(
  buffer:   Buffer,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<AccountData> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const resp = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role:    'user',
      content: [
        {
          type:   'image',
          source: {
            type:       'base64',
            media_type: mimeType,
            data:       buffer.toString('base64'),
          },
        },
        {
          type: 'text',
          text: `This is a business name card from Malaysia. Extract every available field and return a JSON object (null for anything not found):

{
  "companyName": "full registered company name",
  "address":     "full address — combine all lines into one string",
  "ssmNumber":   "SSM or company registration number (e.g. 202301234567 or 123456-X)",
  "tinNumber":   "tax identification number / TIN (e.g. C12345678900)",
  "picName":     "the person's full name printed on the card",
  "picPhone":    "mobile or office phone number (prefer mobile)",
  "picEmail":    "email address"
}

Return ONLY the JSON object, no extra text.`,
        },
      ],
    }],
  })

  const raw = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '{}'
  try {
    const obj = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '')) as Record<string, string | null>
    const data: AccountData = {}
    for (const f of REQUIRED) {
      const v = obj[f]
      if (v && typeof v === 'string' && v.trim()) {
        (data as Record<string, string>)[f] = v.trim()
      }
    }
    return data
  } catch {
    return {}
  }
}

// ── Claude: parse user text for missing fields ────────────────────────────────

async function parseReply(
  gaps:     (keyof AccountData)[],
  userText: string,
): Promise<Partial<AccountData>> {
  if (gaps.length === 0) return {}

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const fieldList = gaps.map(f => `"${f}" = ${LABELS[f]}`).join(', ')

  const resp = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role:    'user',
      content: `I need to fill in these fields: ${fieldList}.

The user replied: "${userText}"

Return a JSON object containing only the fields that were clearly provided. Omit anything not mentioned.
Return ONLY the JSON.`,
    }],
  })

  const raw = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '{}'
  try {
    const obj = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '')) as Record<string, string>
    const result: Partial<AccountData> = {}
    for (const f of gaps) {
      if (obj[f] && typeof obj[f] === 'string') {
        (result as Record<string, string>)[f] = obj[f]
      }
    }
    return result
  } catch {
    return {}
  }
}

// ── Notify admins ──────────────────────────────────────────────────────────────

async function notifyAdmins(reqId: string, data: AccountData, salespersonName: string): Promise<void> {
  const shortId = reqId.slice(0, 6)

  const admins = await prisma.user.findMany({
    where: {
      isActive:       true,
      telegramChatId: { not: null },
      userRoles: {
        some: {
          revokedAt: null,
          role: { name: { in: ['Admin', 'Director', 'Manager'] } },
        },
      },
    },
    select: { telegramChatId: true },
  })

  const html = `📋 <b>New Account Request</b>

<b>From:</b> ${esc(salespersonName)}
<b>Ref:</b> <code>${shortId}</code>

${summaryHtml(data)}

Reply <code>approve ${shortId}</code> to create the account.
Reply <code>reject ${shortId}</code> to decline.`

  for (const admin of admins) {
    if (admin.telegramChatId) {
      await sendHtml(Number(admin.telegramChatId), html)
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Entry point when salesperson sends a photo.
 * Returns the HTML reply to send back via Telegram.
 */
export async function handlePhotoMessage(
  chatId:    number,
  buffer:    Buffer,
  mimeType:  'image/jpeg' | 'image/png' | 'image/webp',
  userId:    string,
  userName:  string,
): Promise<string> {
  const data  = await extractFromPhoto(buffer, mimeType)
  const gaps  = missing(data)
  const found = REQUIRED.length - gaps.length

  const session: AccountSession = {
    step:              gaps.length === 0 ? 'confirming' : 'collecting',
    data,
    salespersonUserId: userId,
    salespersonName:   userName,
  }
  await setSession(chatId, session)

  let html = `📇 <b>Name card scanned</b> — ${found}/${REQUIRED.length} fields found.\n\n${summaryHtml(data)}\n\n`

  if (gaps.length === 0) {
    html += `Everything looks complete! Reply <b>YES</b> to send to admin for approval, or <b>CANCEL</b> to discard.`
  } else {
    html += `⚠️ <b>Missing (${gaps.length}):</b>\n`
    gaps.forEach((f, i) => { html += `${i + 1}. ${LABELS[f]}\n` })
    html += `\nPlease reply with the missing info.`
  }

  return html
}

/**
 * Entry point for text messages when salesperson has an active session.
 * Returns the HTML reply, or null if no active session (caller handles normally).
 */
export async function handleTextInSession(chatId: number, text: string): Promise<string | null> {
  const session = await getSession(chatId)
  if (!session) return null

  const norm = text.trim()

  // Always honour CANCEL
  if (norm.toLowerCase() === 'cancel') {
    await clearSession(chatId)
    return '❌ Account opening cancelled.'
  }

  // ── Confirming step ─────────────────────────────────────────
  if (session.step === 'confirming') {
    if (norm.toLowerCase() === 'yes') {
      const req = await prisma.telegramAccountRequest.create({
        data: {
          requestedById:     session.salespersonUserId,
          salespersonChatId: String(chatId),
          status:            'pending',
          companyName:       session.data.companyName!,
          address:           session.data.address,
          ssmNumber:         session.data.ssmNumber,
          tinNumber:         session.data.tinNumber,
          picName:           session.data.picName!,
          picPhone:          session.data.picPhone!,
          picEmail:          session.data.picEmail,
        },
      })
      await clearSession(chatId)
      await notifyAdmins(req.id, session.data, session.salespersonName)

      return `✅ <b>Request sent to admin!</b>\n\nRef: <code>${req.id.slice(0, 6)}</code>\n\nYou'll be notified here once it's approved.`
    }
    return `Please reply <b>YES</b> to send to admin for approval, or <b>CANCEL</b> to discard.`
  }

  // ── Collecting step ─────────────────────────────────────────
  const gaps    = missing(session.data)
  const parsed  = await parseReply(gaps, norm)
  const updated = { ...session.data, ...parsed }
  const still   = missing(updated)

  session.data = updated

  if (still.length === 0) {
    session.step = 'confirming'
    await setSession(chatId, session)
    return `✅ <b>All fields collected!</b>\n\n${summaryHtml(updated)}\n\nReply <b>YES</b> to send to admin for approval, or <b>CANCEL</b> to discard.`
  }

  await setSession(chatId, session)
  let html = `<b>Updated info:</b>\n\n${summaryHtml(updated)}\n\n⚠️ <b>Still missing (${still.length}):</b>\n`
  still.forEach((f, i) => { html += `${i + 1}. ${LABELS[f]}\n` })
  return html
}

/**
 * Called when an admin sends "approve <shortId>".
 */
export async function approveRequest(shortId: string, adminChatId: number): Promise<string> {
  const candidates = await prisma.telegramAccountRequest.findMany({
    where:   { status: 'pending' },
    include: { requestedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  // Match by first N chars of UUID (case-insensitive)
  const req = candidates.find(r => r.id.toLowerCase().startsWith(shortId.toLowerCase()))
  if (!req) {
    return `❌ Request <code>${esc(shortId)}</code> not found or already processed.`
  }

  const adminUser = await prisma.user.findFirst({
    where:  { telegramChatId: String(adminChatId), isActive: true },
    select: { id: true, name: true },
  })
  if (!adminUser) return '❌ Your Telegram account is not linked to a CMS user.'

  // Duplicate check
  const normalised = req.companyName.trim().toLowerCase().replace(/\s+/g, ' ')
  const existing   = await prisma.company.findFirst({ where: { nameNormalized: normalised } })
  if (existing) {
    return `⚠️ <b>${esc(req.companyName)}</b> already exists in the CMS (ID: <code>${existing.id.slice(0, 8)}</code>). Account not created — handle manually.`
  }

  // Set PostgreSQL user context for audit triggers
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${adminUser.id}, true)`

  // Create company
  const company = await prisma.company.create({
    data: {
      name:           req.companyName,
      nameNormalized: normalised,
      regNumber:      req.ssmNumber,
      tinNumber:      req.tinNumber ?? undefined,
      status:         'Lead',
      leadSource:     'Telegram Name Card',
      createdById:    req.requestedBy.id,
    },
  })

  // Create address
  if (req.address) {
    await prisma.companyAddress.create({
      data: {
        companyId:   company.id,
        addressType: 'billing',
        label:       'Main',
        line1:       req.address,
        isDefault:   true,
      },
    })
  }

  // Create PIC contact
  await prisma.contact.create({
    data: {
      companyId:       company.id,
      name:            req.picName,
      phone:           req.picPhone,
      email:           req.picEmail ?? undefined,
      isDecisionMaker: true,
      createdById:     req.requestedBy.id,
    },
  })

  // Assign to salesperson
  await prisma.companyAssignment.create({
    data: {
      companyId:     company.id,
      userId:        req.requestedBy.id,
      roleInAccount: 'Owner',
      isPrimary:     true,
    },
  })

  // Log activity
  await prisma.activity.create({
    data: {
      companyId:    company.id,
      userId:       req.requestedBy.id,
      activityType: 'Note',
      direction:    'Internal',
      subject:      'Account opened via Telegram name card scan',
      body:         `Approved by ${adminUser.name}. PIC: ${req.picName} (${req.picPhone})${req.picEmail ? ` · ${req.picEmail}` : ''}.`,
    },
  })

  // Mark approved
  await prisma.telegramAccountRequest.update({
    where: { id: req.id },
    data:  { status: 'approved', createdCompanyId: company.id },
  })

  // Notify salesperson
  await sendHtml(Number(req.salespersonChatId), `✅ <b>Account Approved!</b>

<b>${esc(req.companyName)}</b> has been created in the CMS.
Approved by ${esc(adminUser.name ?? 'Admin')}.

Go to Flexxo OS → Companies to view and manage it.`)

  return `✅ <b>Account created:</b> ${esc(req.companyName)}\nAssigned to ${esc(req.requestedBy.name ?? 'salesperson')}.`
}

/**
 * Called when an admin sends "reject <shortId>".
 */
export async function rejectRequest(shortId: string, adminChatId: number): Promise<string> {
  const candidates = await prisma.telegramAccountRequest.findMany({
    where:   { status: 'pending' },
    include: { requestedBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const req = candidates.find(r => r.id.toLowerCase().startsWith(shortId.toLowerCase()))
  if (!req) {
    return `❌ Request <code>${esc(shortId)}</code> not found or already processed.`
  }

  await prisma.telegramAccountRequest.update({
    where: { id: req.id },
    data:  { status: 'rejected' },
  })

  await sendHtml(Number(req.salespersonChatId), `❌ <b>Account Request Rejected</b>

<b>${esc(req.companyName)}</b> was not approved. Contact your admin for details.`)

  return `❌ Rejected: ${esc(req.companyName)}`
}
