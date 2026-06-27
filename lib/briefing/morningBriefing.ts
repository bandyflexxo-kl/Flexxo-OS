/**
 * lib/briefing/morningBriefing.ts
 * Proactive daily briefing — the one piece of the "agent fleet" that runs on a
 * schedule instead of waiting to be asked. Aggregates the 4 things a Director
 * needs to see each morning, then renders them as a Telegram message whose
 * inline buttons reuse the existing webhook callbacks (aqt/rqt/aacct/racct).
 *
 * All queries are READ-ONLY and hit the local DB only (QNE aging is already
 * synced into company.* fields) — so this runs from a Vercel cron with no VPN.
 *
 * Built by: app/api/cron/morning-briefing/route.ts
 * Spec:     docs/morning-briefing-spec.md
 */
import { prisma }                       from '@/lib/prisma'
import { esc }                          from '@/lib/telegramBot'
import type { TelegramInlineButton }    from '@/lib/telegramBot'

// ── Shapes ──────────────────────────────────────────────────────────────────

export type BriefingData = {
  approvals: {
    quotations:      { referenceNo: string; company: string; amount: string; createdBy: string }[]
    accountRequests: { shortId: string; companyName: string; picName: string; requestedBy: string }[]
  }
  ar: {
    top:          { name: string; overdue: number; outstanding: number }[]
    totalOverdue: number
    clientCount:  number
  }
  quiet:    { name: string; daysSince: number; assignedTo: string }[]
  opsStuck: { referenceNo: string; company: string }[]
  isAllClear: boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const QUIET_DAYS  = 60   // a client that last ordered > this is "quiet"
const TOP_AR      = 5
const TOP_QUIET   = 5
const MAX_BUTTONS = 8    // cap approval button rows so the keyboard stays sane

function rm(n: number): string {
  return `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dec(d: { toNumber: () => number } | null | undefined): number {
  return d ? d.toNumber() : 0
}

// ── Builder ─────────────────────────────────────────────────────────────────

export async function buildMorningBriefing(): Promise<BriefingData> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - QUIET_DAYS)

  const [pendingQuotations, pendingRequests, overdueCompanies, quietCandidates, stuckOrders] =
    await Promise.all([
      // A — pending quotations
      prisma.quotation.findMany({
        where:   { status: 'pending_review' },
        select:  {
          referenceNo: true,
          totalAmount: true,
          currency:    true,
          company:     { select: { name: true } },
          createdBy:   { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take:    MAX_BUTTONS,
      }),
      // A — pending account requests
      prisma.telegramAccountRequest.findMany({
        where:   { status: 'pending' },
        select:  { id: true, companyName: true, picName: true, requestedBy: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take:    MAX_BUTTONS,
      }),
      // B — AR: every client with a synced overdue balance
      prisma.company.findMany({
        where:   { overdueAmount: { gt: 0 }, outstandingUpdatedAt: { not: null } },
        select:  { name: true, overdueAmount: true, outstandingBalance: true },
        orderBy: { overdueAmount: 'desc' },
      }),
      // C — quiet accounts: companies with a real order history that went cold
      prisma.company.findMany({
        where:  { qneCustomerCode: { not: null } },
        select: {
          name:        true,
          qneInvoices: { orderBy: { docDate: 'desc' }, take: 1, select: { docDate: true } },
          assignments: { where: { unassignedAt: null }, take: 1, select: { user: { select: { name: true } } } },
        },
      }),
      // D — orders packed but not yet booked for delivery
      prisma.order.findMany({
        where:   { status: 'Packed', deliveryBooking: { is: null } },
        select:  { id: true, referenceNo: true, company: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take:    10,
      }),
    ])

  // A
  const quotations = pendingQuotations.map(q => ({
    referenceNo: q.referenceNo ?? '—',
    company:     q.company.name,
    amount:      rm(dec(q.totalAmount)),
    createdBy:   q.createdBy.name,
  }))
  const accountRequests = pendingRequests.map(r => ({
    shortId:     r.id.slice(0, 6),
    companyName: r.companyName,
    picName:     r.picName,
    requestedBy: r.requestedBy.name,
  }))

  // B
  const totalOverdue = overdueCompanies.reduce((s, c) => s + dec(c.overdueAmount), 0)
  const arTop = overdueCompanies.slice(0, TOP_AR).map(c => ({
    name:        c.name,
    overdue:     dec(c.overdueAmount),
    outstanding: dec(c.outstandingBalance),
  }))

  // C — only clients that ordered before but not within QUIET_DAYS (never-ordered
  //     leads are excluded as noise; they're a different workflow)
  const quiet = quietCandidates
    .map(c => {
      const last = c.qneInvoices[0]?.docDate
      if (!last || last >= cutoff) return null
      return {
        name:       c.name,
        daysSince:  Math.round((Date.now() - last.getTime()) / 86_400_000),
        assignedTo: c.assignments[0]?.user.name ?? 'Unassigned',
      }
    })
    .filter((x): x is { name: string; daysSince: number; assignedTo: string } => x !== null)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, TOP_QUIET)

  // D
  const opsStuck = stuckOrders.map(o => ({
    referenceNo: o.referenceNo ?? o.id.slice(0, 8),
    company:     o.company.name,
  }))

  const isAllClear =
    quotations.length === 0 &&
    accountRequests.length === 0 &&
    arTop.length === 0 &&
    quiet.length === 0 &&
    opsStuck.length === 0

  return {
    approvals: { quotations, accountRequests },
    ar:        { top: arTop, totalOverdue, clientCount: overdueCompanies.length },
    quiet,
    opsStuck,
    isAllClear,
  }
}

// ── Renderer ────────────────────────────────────────────────────────────────

export function renderBriefingHtml(d: BriefingData): { html: string; buttons: TelegramInlineButton[][] } {
  const today = new Date().toLocaleDateString('en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur',
  })

  if (d.isAllClear) {
    return {
      html: `🌤️ <b>Good morning</b> — Flexxo briefing for ${today}\n\nAll clear. Nothing needs you this morning. ✅`,
      buttons: [],
    }
  }

  const lines: string[]                  = [`☀️ <b>Good morning</b> — Flexxo briefing for ${today}`]
  const buttons: TelegramInlineButton[][] = []

  // A — Approvals
  const approvalCount = d.approvals.quotations.length + d.approvals.accountRequests.length
  if (approvalCount > 0) {
    lines.push('', `🔴 <b>${approvalCount} APPROVAL${approvalCount > 1 ? 'S' : ''} WAITING</b>`)
    for (const q of d.approvals.quotations) {
      lines.push(`• ${esc(q.referenceNo)} · ${esc(q.company)} · ${esc(q.amount)} (${esc(q.createdBy)})`)
      buttons.push([
        { text: `✅ ${q.referenceNo}`, callback_data: `aqt:${q.referenceNo}` },
        { text: '❌ Reject',           callback_data: `rqt:${q.referenceNo}` },
      ])
    }
    for (const r of d.approvals.accountRequests) {
      lines.push(`• New account: ${esc(r.companyName)} — PIC ${esc(r.picName)} (${esc(r.requestedBy)})`)
      buttons.push([
        { text: `✅ ${r.companyName.slice(0, 18)}`, callback_data: `aacct:${r.shortId}` },
        { text: '❌ Reject',                        callback_data: `racct:${r.shortId}` },
      ])
    }
  } else {
    lines.push('', '✅ No approvals waiting')
  }

  // B — AR
  if (d.ar.top.length > 0) {
    lines.push('', `💰 <b>AR — ${esc(rm(d.ar.totalOverdue))} overdue across ${d.ar.clientCount} client${d.ar.clientCount > 1 ? 's' : ''}</b>`)
    for (const c of d.ar.top) {
      lines.push(`• ${esc(c.name)} — ${esc(rm(c.overdue))} overdue (${esc(rm(c.outstanding))} total)`)
    }
  }

  // C — Quiet accounts
  if (d.quiet.length > 0) {
    lines.push('', '😴 <b>QUIET ACCOUNTS</b>')
    for (const q of d.quiet) {
      lines.push(`• ${esc(q.name)} — last order ${q.daysSince} days ago (${esc(q.assignedTo)})`)
    }
  }

  // D — Ops stuck
  if (d.opsStuck.length > 0) {
    lines.push('', `📦 <b>${d.opsStuck.length} ORDER${d.opsStuck.length > 1 ? 'S' : ''} STUCK</b>`)
    for (const o of d.opsStuck) {
      lines.push(`• ${esc(o.referenceNo)} · ${esc(o.company)} — packed, no delivery`)
    }
  }

  lines.push('', '<i>Reply to act — e.g. "approve ' +
    (d.approvals.quotations[0]?.referenceNo ?? 'QT-…') +
    '", "chase ' + (d.ar.top[0]?.name?.split(' ')[0] ?? 'client') +
    ' AR", or tap a button above.</i>')

  return { html: lines.join('\n'), buttons }
}
