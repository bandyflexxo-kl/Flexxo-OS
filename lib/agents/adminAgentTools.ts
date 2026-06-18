/**
 * lib/agents/adminAgentTools.ts
 * Prisma + business logic tool implementations for the Admin AI Agent.
 */
import { prisma }             from '@/lib/prisma'
import { sendQuotationEmail } from '@/lib/quotationEmail'
import { sendPushToUser }     from '@/lib/webpush'
import { sendHtml, esc }      from '@/lib/telegramBot'

export type ToolResult = Record<string, unknown>

export interface ApproverCtx {
  userId: string
  name:   string
}

// ── list_pending_approvals ────────────────────────────────────────────────────

export async function listPendingApprovals(): Promise<ToolResult> {
  const [quotations, accountRequests] = await Promise.all([
    prisma.quotation.findMany({
      where:   { status: 'pending_review' },
      include: {
        company:   { select: { name: true } },
        createdBy: { select: { name: true } },
        items:     { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
      take:    20,
    }),
    prisma.telegramAccountRequest.findMany({
      where:   { status: 'pending' },
      include: { requestedBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take:    20,
    }),
  ])

  return {
    pendingQuotations: quotations.map(q => ({
      quotationId: q.id,
      referenceNo: q.referenceNo,
      company:     q.company.name,
      createdBy:   q.createdBy.name,
      totalAmount: q.totalAmount?.toString() ?? '0',
      currency:    q.currency,
      itemCount:   q.items.length,
      createdAt:   q.createdAt.toISOString(),
    })),
    pendingAccountRequests: accountRequests.map(r => ({
      shortId:     r.id.slice(0, 6),
      companyName: r.companyName,
      picName:     r.picName,
      picPhone:    r.picPhone,
      requestedBy: r.requestedBy.name,
      createdAt:   r.createdAt.toISOString(),
    })),
    summary: {
      quotations:      quotations.length,
      accountRequests: accountRequests.length,
    },
  }
}

// ── approve_quotation ─────────────────────────────────────────────────────────

export async function approveQuotation(
  quotationRef: string,
  approver:     ApproverCtx,
): Promise<ToolResult> {
  const quotation = await prisma.quotation.findFirst({
    where: {
      OR: [
        { referenceNo: quotationRef },
        { id: quotationRef },
      ],
    },
    include: {
      company:   { select: { name: true, generalEmail: true } },
      contact:   { select: { name: true, email: true } },
      createdBy: { select: { name: true, id: true } },
      items:     { select: { id: true } },
    },
  })
  if (!quotation) return { error: `Quotation "${quotationRef}" not found.` }
  if (quotation.status !== 'pending_review') {
    return { error: `${quotation.referenceNo ?? quotationRef} is "${quotation.status}" — only pending_review quotations can be approved.` }
  }

  const recipientEmail = quotation.contact?.email ?? quotation.company.generalEmail

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${approver.userId}, true)`

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data:  { status: 'sent', sentAt: new Date(), approvedById: approver.userId },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: quotation.id,
        fromStatus:  'pending_review',
        toStatus:    'sent',
        changedById: approver.userId,
        notes:       'Approved and auto-sent via Admin AI Agent',
      },
    })
    if (recipientEmail) {
      await tx.activity.create({
        data: {
          companyId:    quotation.companyId,
          activityType: 'email',
          direction:    'outbound',
          subject:      `Quotation ${quotation.referenceNo} approved and sent to customer`,
          body:         `Approved by ${approver.name} (Admin Agent). Email sent to ${recipientEmail}.`,
          userId:       approver.userId,
        },
      })
    }
  })

  if (recipientEmail && quotation.items.length > 0) {
    sendQuotationEmail({
      to:              recipientEmail,
      contactName:     quotation.contact?.name ?? null,
      salespersonName: quotation.createdBy.name,
      companyName:     quotation.company.name,
      referenceNo:     quotation.referenceNo,
      currency:        quotation.currency,
      totalAmount:     quotation.totalAmount?.toString() ?? '0',
      expiresAt:       quotation.expiresAt?.toISOString() ?? null,
      quotationId:     quotation.id,
    }).catch(err => console.error('[admin-agent] quotation email failed:', err))
  }

  if (quotation.createdBy.id) {
    sendPushToUser(quotation.createdBy.id, {
      title: '✅ Quote Approved & Sent',
      body:  `${quotation.referenceNo ?? 'Your quotation'} was approved by ${approver.name} and emailed to the client.`,
      url:   `/quotations/${quotation.id}`,
    }).catch(() => undefined)
  }

  return {
    approved:    true,
    referenceNo: quotation.referenceNo,
    company:     quotation.company.name,
    emailSent:   !!(recipientEmail && quotation.items.length > 0),
    message:     `✅ ${quotation.referenceNo ?? quotationRef} approved and sent to client${recipientEmail ? ` at ${recipientEmail}` : ''}.`,
  }
}

// ── reject_quotation ──────────────────────────────────────────────────────────

export async function rejectQuotation(
  quotationRef: string,
  reason:       string,
  approver:     ApproverCtx,
): Promise<ToolResult> {
  const quotation = await prisma.quotation.findFirst({
    where: {
      OR: [
        { referenceNo: quotationRef },
        { id: quotationRef },
      ],
    },
    include: {
      company:   { select: { name: true } },
      createdBy: { select: { name: true, id: true } },
    },
  })
  if (!quotation) return { error: `Quotation "${quotationRef}" not found.` }
  if (quotation.status !== 'pending_review') {
    return { error: `${quotation.referenceNo ?? quotationRef} is "${quotation.status}" — only pending_review quotations can be rejected.` }
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${approver.userId}, true)`

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data:  { status: 'rejected' },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: quotation.id,
        fromStatus:  'pending_review',
        toStatus:    'rejected',
        changedById: approver.userId,
        notes:       reason ? `Rejected by ${approver.name}: ${reason}` : `Rejected by ${approver.name}`,
      },
    })
  })

  if (quotation.createdBy.id) {
    sendPushToUser(quotation.createdBy.id, {
      title: '❌ Quote Rejected',
      body:  `${quotation.referenceNo ?? 'Your quotation'} for ${quotation.company.name} was rejected${reason ? ': ' + reason : ' by ' + approver.name + '.'}`,
      url:   `/quotations/${quotation.id}`,
    }).catch(() => undefined)
  }

  return {
    rejected:    true,
    referenceNo: quotation.referenceNo,
    company:     quotation.company.name,
    reason,
    message:     `❌ ${quotation.referenceNo ?? quotationRef} rejected. Salesperson notified.`,
  }
}

// ── approve_account_request ───────────────────────────────────────────────────

export async function approveAccountRequest(
  shortId:  string,
  approver: ApproverCtx,
): Promise<ToolResult> {
  const candidates = await prisma.telegramAccountRequest.findMany({
    where:   { status: 'pending' },
    include: { requestedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const req = candidates.find(r => r.id.toLowerCase().startsWith(shortId.toLowerCase()))
  if (!req) return { error: `Account request "${shortId}" not found or already processed.` }

  const normalised = req.companyName.trim().toLowerCase().replace(/\s+/g, ' ')
  const existing   = await prisma.company.findFirst({ where: { nameNormalized: normalised } })
  if (existing) {
    return { error: `${req.companyName} already exists in CRM (ID: ${existing.id.slice(0, 8)}). Handle manually.` }
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${approver.userId}, true)`

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

  await prisma.companyAssignment.create({
    data: {
      companyId:     company.id,
      userId:        req.requestedBy.id,
      roleInAccount: 'Owner',
      isPrimary:     true,
    },
  })

  await prisma.activity.create({
    data: {
      companyId:    company.id,
      userId:       req.requestedBy.id,
      activityType: 'Note',
      direction:    'Internal',
      subject:      'Account opened via Telegram name card scan',
      body:         `Approved by ${approver.name} (Admin Agent). PIC: ${req.picName} (${req.picPhone}).`,
    },
  })

  await prisma.telegramAccountRequest.update({
    where: { id: req.id },
    data:  { status: 'approved', createdCompanyId: company.id },
  })

  if (req.salespersonChatId) {
    sendHtml(Number(req.salespersonChatId), `✅ <b>Account Approved!</b>\n\n<b>${esc(req.companyName)}</b> has been created in the CRM.\nApproved by ${esc(approver.name)}.\n\nGo to Flexxo OS → Companies to view it.`)
      .catch(() => undefined)
  }

  return {
    approved:    true,
    companyName: req.companyName,
    companyId:   company.id,
    assignedTo:  req.requestedBy.name,
    message:     `✅ Account created: ${req.companyName}. Assigned to ${req.requestedBy.name ?? 'salesperson'}.`,
  }
}

// ── reject_account_request ────────────────────────────────────────────────────

export async function rejectAccountRequest(
  shortId: string,
  reason:  string,
): Promise<ToolResult> {
  const candidates = await prisma.telegramAccountRequest.findMany({
    where:   { status: 'pending' },
    include: { requestedBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const req = candidates.find(r => r.id.toLowerCase().startsWith(shortId.toLowerCase()))
  if (!req) return { error: `Account request "${shortId}" not found or already processed.` }

  await prisma.telegramAccountRequest.update({
    where: { id: req.id },
    data:  { status: 'rejected' },
  })

  if (req.salespersonChatId) {
    sendHtml(Number(req.salespersonChatId), `❌ <b>Account Request Rejected</b>\n\n<b>${esc(req.companyName)}</b> was not approved.${reason ? `\nReason: ${esc(reason)}` : ''}`)
      .catch(() => undefined)
  }

  return {
    rejected:    true,
    companyName: req.companyName,
    reason,
    message:     `❌ Rejected: ${req.companyName}. Salesperson notified.`,
  }
}
