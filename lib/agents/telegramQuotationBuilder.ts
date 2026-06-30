/**
 * lib/agents/telegramQuotationBuilder.ts
 * Parses a /quote command from Telegram, fuzzy-matches products,
 * and creates a draft Quotation in the CMS.
 *
 * Command format (sent as a single Telegram message):
 *   /quote [company name]
 *   [qty] [unit] [product name]
 *   [qty] [unit] [product name]
 *   ...
 */
import { prisma } from '@/lib/prisma'
import { RETAIL_MARKUP } from '@/lib/qnePriceSync'
import { parseItemList, matchProductsForLines } from '@/lib/smartOrder'
import { esc } from '@/lib/telegramBot'
import { notifyByRole } from '@/lib/telegramNotify'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuotationBuildResult =
  | { ok: true;  quotationId: string; refNo: string; html: string }
  | { ok: false; html: string }

// ── Main function ─────────────────────────────────────────────────────────────

export async function buildQuotationFromTelegram(
  rawText:   string,   // full message text after the /quote command
  userId:    string,   // CMS user ID (createdById)
): Promise<QuotationBuildResult> {

  const lines = rawText.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) {
    return {
      ok:   false,
      html: '⚠️ Format: <code>/quote [Company Name]</code>\nthen one item per line below it.\n\nExample:\n<code>/quote Maybank\n5 reams A4 paper\n3 pcs HP toner 85A</code>',
    }
  }

  const companyQuery = lines[0].replace(/^\/quote\s*/i, '').trim()
  const itemText     = lines.slice(1).join('\n')

  if (!companyQuery) {
    return { ok: false, html: '⚠️ Please include the company name on the first line after /quote.' }
  }

  // ── Find company ────────────────────────────────────────────────────────────
  const company = await prisma.company.findFirst({
    where: { name: { contains: companyQuery, mode: 'insensitive' } },
    select: { id: true, name: true },
  })

  if (!company) {
    return {
      ok:   false,
      html: `⚠️ No company found matching "<b>${esc(companyQuery)}</b>".\nCheck the name in Flexxo OS and try again.`,
    }
  }

  // ── Parse + match items ────────────────────────────────────────────────────
  const parsedLines  = parseItemList(itemText)
  const matchedLines = await matchProductsForLines(parsedLines)

  const highMatches   = matchedLines.filter(l => l.confidence === 'high'   && l.topMatch)
  const mediumMatches = matchedLines.filter(l => l.confidence === 'medium' && l.topMatch)
  const noMatches     = matchedLines.filter(l => l.confidence === 'none')

  const toAdd = [...highMatches, ...mediumMatches]

  if (toAdd.length === 0) {
    const unmatched = noMatches.map(l => `• ${esc(l.rawText)}`).join('\n')
    return {
      ok:   false,
      html: `⚠️ Could not match any items for <b>${esc(company.name)}</b>.\n\nUnrecognised items:\n${unmatched}\n\nTry more specific product names.`,
    }
  }

  // ── Set audit user ─────────────────────────────────────────────────────────
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, false)`

  // ── Create quotation ───────────────────────────────────────────────────────
  const year   = new Date().getFullYear()
  const count  = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
  const refNo  = `QT-${year}-${String(count + 1).padStart(4, '0')}`

  const quotation = await prisma.quotation.create({
    data: {
      companyId:     company.id,
      createdById:   userId,
      referenceNo:   refNo,
      status:        'pending_review',   // Telegram /quote = salesperson submits immediately
      currency:      'MYR',
      versionNumber: 1,
    },
  })

  // Log the implicit draft → pending_review transition
  await prisma.quotationStatusHistory.create({
    data: {
      quotationId: quotation.id,
      fromStatus:  'draft',
      toStatus:    'pending_review',
      changedById: userId,
      notes:       'Created and submitted via Telegram',
    },
  }).catch(() => undefined)

  // ── Create items ───────────────────────────────────────────────────────────
  let subtotal     = 0
  const itemLines: string[] = []

  for (let i = 0; i < toAdd.length; i++) {
    const line  = toAdd[i]
    const match = line.topMatch!
    const qty   = line.qty

    const lastSaleNum = match.sellingPrice
      ? parseFloat(match.sellingPrice) / RETAIL_MARKUP  // reverse the markup to get cost
      : null

    const unitPrice = lastSaleNum !== null ? lastSaleNum * RETAIL_MARKUP : 0
    const lineTotal = unitPrice * qty
    subtotal += lineTotal

    await prisma.quotationItem.create({
      data: {
        quotationId: quotation.id,
        productId:   match.id,
        description: match.name,
        brand:       match.brand ?? null,
        unit:        line.unit ?? match.unit ?? null,
        qty:         qty,
        unitCost:    lastSaleNum !== null ? lastSaleNum : 0,
        unitPrice:   unitPrice,
        marginPct:   lastSaleNum !== null ? (RETAIL_MARKUP - 1) : 0,
        lineTotal:   lineTotal,
        sortOrder:   i,
      },
    })

    const priceStr = unitPrice > 0 ? `RM${unitPrice.toFixed(2)}` : 'price TBC'
    const totalStr = lineTotal > 0 ? ` = RM${lineTotal.toFixed(2)}` : ''
    const flag     = line.confidence === 'medium' ? ' ⚠️' : ''
    itemLines.push(`${flag}• ${esc(match.name)} — ${qty} ${line.unit ?? match.unit ?? 'pc'} @ ${priceStr}${totalStr}`)
  }

  // Update quotation totals
  await prisma.quotation.update({
    where: { id: quotation.id },
    data:  {
      subtotal:    subtotal,
      totalAmount: subtotal,
    },
  })

  // ── Build reply HTML ───────────────────────────────────────────────────────
  const appUrl = process.env.NEXTAUTH_URL?.replace('http://localhost:3000', 'https://flexxo-os.vercel.app')
    ?? 'https://flexxo-os.vercel.app'

  const link = `${appUrl}/quotations/${quotation.id}`

  const parts: string[] = [
    `✅ <b>${esc(company.name)}</b>`,
    '',
    ...itemLines,
  ]

  if (noMatches.length > 0) {
    parts.push('')
    parts.push(`⚠️ <b>Could not match (add manually):</b>`)
    noMatches.forEach(l => parts.push(`  • ${esc(l.rawText)}`))
  }

  if (mediumMatches.length > 0) {
    parts.push('')
    parts.push(`⚠️ Items marked ⚠️ are low-confidence matches — please review in the CMS.`)
  }

  parts.push('')
  if (subtotal > 0) parts.push(`<b>Subtotal: RM${subtotal.toFixed(2)}</b>`)
  parts.push(`📋 <b>${esc(refNo)}</b> — pending review`)
  parts.push(`🔗 <a href="${link}">View in Flexxo OS</a>`)

  // ── Notify admins/directors with [Approve][Reject] buttons ─────────────────
  const salesperson = await prisma.user.findUnique({
    where:  { id: userId },
    select: { name: true },
  }).catch(() => null)

  const adminHtml = `📋 <b>New Quotation — Pending Approval</b>

<b>Ref:</b> ${esc(refNo)}
<b>Company:</b> ${esc(company.name)}
<b>From:</b> ${esc(salesperson?.name ?? 'Salesperson')}
<b>Total:</b> RM${subtotal.toFixed(2)} (${toAdd.length} item${toAdd.length !== 1 ? 's' : ''})

🔗 <a href="${link}">Review in Flexxo OS</a>`

  notifyByRole(['Admin', 'Director', 'Manager'], adminHtml, [
    [
      { text: '✅ Approve', callback_data: `aqt:${refNo}` },
      { text: '❌ Reject',  callback_data: `rqt:${refNo}` },
    ],
  ]).catch(() => undefined)

  return {
    ok:          true,
    quotationId: quotation.id,
    refNo,
    html:        parts.join('\n'),
  }
}
