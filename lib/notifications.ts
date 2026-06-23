import 'server-only'
import { prisma } from '@/lib/prisma'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'overdue_followup'
  | 'due_today'
  | 'approved_quote'
  | 'draft_quote'
  | 'pending_approval'
  | 'inactive_account'
  | 'account_request'
  | 'contact_edit_request'

export type NotificationItem = {
  type:      NotificationType
  title:     string
  body:      string
  url:       string
  createdAt: Date
}

export type NotificationResult = {
  items:  NotificationItem[]
  count:  number
  urgent: number   // overdue follow-ups + approved quotes waiting to be sent
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns today's start and end in Malaysia time (UTC+8), expressed as UTC Date objects */
function getMalaysiaDateBounds(): { todayStart: Date; todayEnd: Date; thirtyDaysAgo: Date } {
  const nowUtc      = Date.now()
  const myt         = new Date(nowUtc + 8 * 60 * 60 * 1000)  // shift to MYT
  const midnight    = new Date(myt)
  midnight.setUTCHours(0, 0, 0, 0)
  const tomorrowMid = new Date(midnight)
  tomorrowMid.setUTCDate(tomorrowMid.getUTCDate() + 1)

  // Convert back to UTC for Prisma queries
  const todayStart    = new Date(midnight.getTime()    - 8 * 60 * 60 * 1000)
  const todayEnd      = new Date(tomorrowMid.getTime() - 8 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(nowUtc - 30 * 24 * 60 * 60 * 1000)

  return { todayStart, todayEnd, thirtyDaysAgo }
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Fetch all actionable notifications for a user.
 * Shared by: notification bell API, email digest cron, push trigger logic.
 */
export async function getNotificationsForUser(
  userId: string,
  role:   string,
): Promise<NotificationResult> {
  const { todayStart, todayEnd, thirtyDaysAgo } = getMalaysiaDateBounds()
  const isPrivileged = role === 'Admin' || role === 'Manager'

  const items: NotificationItem[] = []

  // ── 1. Overdue follow-ups ──────────────────────────────────────────────────
  const overdueFollowUps = await prisma.activity.findMany({
    where: {
      userId,
      followUpAt: { lt: todayStart },
      OR: [
        { followUpStatus: 'Pending' },
        { followUpStatus: null },
      ],
    },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { followUpAt: 'asc' },
    take: 10,
  })

  for (const a of overdueFollowUps) {
    const daysOverdue = Math.floor((todayStart.getTime() - (a.followUpAt?.getTime() ?? 0)) / 86400000)
    items.push({
      type:      'overdue_followup',
      title:     `Overdue: ${a.company.name}`,
      body:      `${a.subject} — ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`,
      url:       `/companies/${a.company.id}?tab=activities`,
      createdAt: a.followUpAt ?? a.createdAt,
    })
  }

  // ── 2. Follow-ups due today ────────────────────────────────────────────────
  const dueTodayFollowUps = await prisma.activity.findMany({
    where: {
      userId,
      followUpAt: { gte: todayStart, lt: todayEnd },
      OR: [
        { followUpStatus: 'Pending' },
        { followUpStatus: null },
      ],
    },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { followUpAt: 'asc' },
    take: 10,
  })

  for (const a of dueTodayFollowUps) {
    items.push({
      type:      'due_today',
      title:     `Due today: ${a.company.name}`,
      body:      a.subject,
      url:       `/companies/${a.company.id}?tab=activities`,
      createdAt: a.followUpAt ?? a.createdAt,
    })
  }

  // ── 3. Approved quotations ready to send ──────────────────────────────────
  const approvedQuotes = await prisma.quotation.findMany({
    where:   { createdById: userId, status: 'approved' },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'asc' },
    take: 10,
  })

  for (const q of approvedQuotes) {
    items.push({
      type:      'approved_quote',
      title:     `Send to customer: ${q.referenceNo}`,
      body:      `${q.company.name} — ${q.currency} ${Number(q.totalAmount ?? 0).toFixed(2)} · Approved, waiting to be sent`,
      url:       `/quotations/${q.id}`,
      createdAt: q.updatedAt,
    })
  }

  // ── 4. Draft quotations pending submission ─────────────────────────────────
  const draftQuotes = await prisma.quotation.findMany({
    where:   { createdById: userId, status: 'draft' },
    include: {
      company: { select: { id: true, name: true } },
      _count:  { select: { items: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  })

  for (const q of draftQuotes) {
    if (q._count.items === 0) continue  // empty drafts are just noise
    items.push({
      type:      'draft_quote',
      title:     `Submit for approval: ${q.referenceNo}`,
      body:      `${q.company.name} — ${q._count.items} item${q._count.items !== 1 ? 's' : ''} · Draft`,
      url:       `/quotations/${q.id}`,
      createdAt: q.updatedAt,
    })
  }

  // ── 5. Quotations pending approval (Manager / Admin only) ──────────────────
  if (isPrivileged) {
    const pendingApproval = await prisma.quotation.findMany({
      where:   { status: 'pending_review' },
      include: {
        company:   { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    })

    for (const q of pendingApproval) {
      const daysWaiting = Math.floor((Date.now() - q.updatedAt.getTime()) / 86400000)
      items.push({
        type:      'pending_approval',
        title:     `Approve: ${q.referenceNo}`,
        body:      `${q.company.name} · by ${q.createdBy.name}${daysWaiting > 0 ? ` · ${daysWaiting}d waiting` : ''}`,
        url:       `/quotations/${q.id}`,
        createdAt: q.updatedAt,
      })
    }
  }

  // ── 6. Pending contact edit requests (Admin / Manager only) ─────────────
  if (isPrivileged) {
    const pendingEdits = await prisma.contactEditRequest.findMany({
      where:   { status: 'pending' },
      include: {
        contact:     { select: { id: true, name: true, companyId: true, company: { select: { id: true, name: true } } } },
        requestedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take:    10,
    })

    for (const req of pendingEdits) {
      items.push({
        type:      'contact_edit_request',
        title:     `Contact edit pending: ${req.contact.name}`,
        body:      `${req.requestedBy.name} wants to update ${req.contact.name} at ${req.contact.company.name}`,
        url:       `/companies/${req.contact.company.id}?tab=contacts`,
        createdAt: req.createdAt,
      })
    }
  }

  // ── 7. Pending account requests (Admin / Manager only) ───────────────────
  if (isPrivileged) {
    const pendingRequests = await prisma.accountRequest.findMany({
      where:   { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take:    10,
      select:  { id: true, fullName: true, companyName: true, email: true, createdAt: true },
    })

    for (const req of pendingRequests) {
      items.push({
        type:      'account_request',
        title:     `Account request: ${req.companyName}`,
        body:      `${req.fullName} — ${req.email}`,
        url:       '/admin/account-requests',
        createdAt: req.createdAt,
      })
    }
  }

  // ── 7. Inactive accounts (no activity in 30+ days) ────────────────────────
  if (!isPrivileged) {
    const inactiveCompanies = await prisma.company.findMany({
      where: {
        assignments: { some: { userId, unassignedAt: null } },
        status:      { notIn: ['Churned', 'Inactive'] },
        activities:  { none: { createdAt: { gte: thirtyDaysAgo } } },
      },
      select: { id: true, name: true, status: true },
      take: 5,
    })

    for (const c of inactiveCompanies) {
      items.push({
        type:      'inactive_account',
        title:     `No activity: ${c.name}`,
        body:      `No activity logged in 30+ days — time to check in`,
        url:       `/companies/${c.id}`,
        createdAt: thirtyDaysAgo,
      })
    }
  }

  const pendingRequestCount    = items.filter(i => i.type === 'account_request').length
  const pendingContactEdits    = items.filter(i => i.type === 'contact_edit_request').length
  const urgent = overdueFollowUps.length + approvedQuotes.length + pendingRequestCount + pendingContactEdits

  return { items, count: items.length, urgent }
}
