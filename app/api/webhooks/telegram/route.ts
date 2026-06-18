/**
 * POST /api/webhooks/telegram
 * Unified Telegram bot webhook — NLP intent routing + inline keyboard callbacks.
 *
 * Free-text routing (no slash commands needed):
 *   "raise a quote for ABC, 10 reams A4" → Sales Agent / quotation builder
 *   "book delivery for ORD-2026-0042"    → Operation Agent
 *   "approve QT-2026-0042"              → Admin Agent (direct action)
 *   "what needs attention today?"        → Admin Agent
 *   anything else                        → Sales Agent (fallback)
 *
 * Button callbacks:
 *   aqt:{quotationRef}    → approve quotation
 *   rqt:{quotationRef}    → reject quotation (asks for reason)
 *   aacct:{shortId}       → approve account request
 *   racct:{shortId}       → reject account request
 *   bkd:{orderId12}:MC/MP/VN → book delivery
 *   cncl                  → cancel pending action
 *
 * Pending-action state (Redis):
 *   When admin taps [Reject], we store pending state + ask for a reason.
 *   Next text message from that user completes the rejection.
 *
 * Identity: resolved via users.telegram_chat_id (set in /admin/users → Edit).
 */
import { prisma }          from '@/lib/prisma'
import {
  verifyTelegramWebhook,
  downloadPhoto,
  sendHtml,
  sendHtmlWithButtons,
  sendTyping,
  answerCallbackQuery,
  editMessageText,
  markdownToTelegramHtml,
  esc,
  type TelegramUpdate,
  type TelegramCallbackQuery,
  type TelegramMessage,
}                          from '@/lib/telegramBot'
import { getRedis }        from '@/lib/redis'
import { runSalesAgent }   from '@/lib/agents/salesAgentCore'
import { runAdminAgent }   from '@/lib/agents/adminAgentCore'
import { runOperationAgent } from '@/lib/agents/operationAgentCore'
import { buildQuotationFromTelegram } from '@/lib/agents/telegramQuotationBuilder'
import { classifyIntent }  from '@/lib/agents/intentRouter'
import {
  handlePhotoMessage,
  handleTextInSession,
  hasActiveSession,
}                          from '@/lib/agents/nameCardAgent'
import {
  approveQuotation,
  rejectQuotation,
  approveAccountRequest,
  rejectAccountRequest,
  type ApproverCtx,
}                          from '@/lib/agents/adminAgentTools'
import { bookLalamoveDelivery } from '@/lib/fulfillment'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIVILEGED_ROLES = ['Admin', 'Director', 'Manager']
const PENDING_TTL_SECS = 10 * 60  // 10 minutes

type PendingAction =
  | { type: 'reject_quotation';    ref: string;     messageId?: number }
  | { type: 'reject_account';      shortId: string; messageId?: number }

// ── Static replies ────────────────────────────────────────────────────────────

const WELCOME_HTML = `👋 <b>Flexxo Sales Bot</b>

I'm your AI assistant. Just <b>type naturally</b> — no commands needed.

<b>What I can do:</b>
• Answer questions about products, clients, pricing
• Create quotation drafts ("raise a quote for ABC Trading, 10 reams A4")
• Book deliveries ("book delivery for ORD-2026-0042")
• Show pending approvals ("what needs my approval today?")
• 📸 Send a <b>name card photo</b> to open a new account

<code>/myid</code> — get your Telegram ID (give to admin to link your account)`

const NOT_LINKED_HTML = (chatId: number) =>
  `🔗 <b>Account not linked</b>

Your Telegram ID is <code>${chatId}</code>

Give this number to your admin:
<b>Flexxo OS → Admin → Users → Edit → Telegram Chat ID</b>`

// ── Redis pending-action helpers ──────────────────────────────────────────────

function pendingKey(chatId: number): string {
  return `tg:pending:${chatId}`
}

async function getPending(chatId: number): Promise<PendingAction | null> {
  const redis = getRedis()
  if (!redis) return null
  return redis.get<PendingAction>(pendingKey(chatId))
}

async function setPending(chatId: number, action: PendingAction): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.set(pendingKey(chatId), action, { ex: PENDING_TTL_SECS })
}

async function clearPending(chatId: number): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(pendingKey(chatId))
}

// ── Resolve CRM user ──────────────────────────────────────────────────────────

async function resolveCrmUser(telegramId: number) {
  return prisma.user.findFirst({
    where:  { telegramChatId: String(telegramId), isActive: true },
    select: {
      id:   true,
      name: true,
      userRoles: {
        where:  { revokedAt: null },
        select: { role: { select: { name: true } } },
        take:   1,
      },
    },
  })
}

// ── Callback query handler ────────────────────────────────────────────────────

async function handleCallbackQuery(cbq: TelegramCallbackQuery): Promise<Response> {
  const chatId    = cbq.message?.chat.id ?? cbq.from.id
  const messageId = cbq.message?.message_id
  const data      = cbq.data ?? ''

  // Ack immediately to remove loading spinner
  await answerCallbackQuery(cbq.id).catch(() => undefined)

  // Resolve admin user
  const crmUser = await resolveCrmUser(cbq.from.id)
  if (!crmUser) {
    await sendHtml(chatId, NOT_LINKED_HTML(chatId))
    return Response.json({ ok: true })
  }

  const role = crmUser.userRoles[0]?.role?.name ?? 'Salesperson'

  // ── Cancel pending action ─────────────────────────────────────────────────
  if (data === 'cncl') {
    await clearPending(chatId)
    if (messageId) {
      await editMessageText(chatId, messageId, '❌ Action cancelled.').catch(() => undefined)
    }
    return Response.json({ ok: true })
  }

  // ── Approve quotation ─────────────────────────────────────────────────────
  if (data.startsWith('aqt:') && PRIVILEGED_ROLES.includes(role)) {
    const ref      = data.slice(4)
    const approver: ApproverCtx = { userId: crmUser.id, name: crmUser.name }
    const result   = await approveQuotation(ref, approver)
    const html     = result.approved
      ? `✅ ${esc(String(result.referenceNo ?? ref))} approved and sent to client.${result.emailSent ? '' : '\n⚠️ No email sent (no items or no recipient email).'}`
      : `❌ ${esc(String(result.error ?? 'Failed'))}`
    if (messageId) {
      await editMessageText(chatId, messageId, html).catch(() => sendHtml(chatId, html))
    } else {
      await sendHtml(chatId, html)
    }
    return Response.json({ ok: true })
  }

  // ── Reject quotation (step 1: ask for reason) ─────────────────────────────
  if (data.startsWith('rqt:') && PRIVILEGED_ROLES.includes(role)) {
    const ref = data.slice(4)
    await setPending(chatId, { type: 'reject_quotation', ref, messageId })
    await sendHtmlWithButtons(chatId,
      `📝 Please reply with the <b>reason for rejecting</b> ${esc(ref)}.\n\nOr tap Cancel to abort.`,
      [[{ text: '✕ Cancel', callback_data: 'cncl' }]],
    )
    return Response.json({ ok: true })
  }

  // ── Approve account request ───────────────────────────────────────────────
  if (data.startsWith('aacct:') && PRIVILEGED_ROLES.includes(role)) {
    const shortId  = data.slice(6)
    const approver: ApproverCtx = { userId: crmUser.id, name: crmUser.name }
    const result   = await approveAccountRequest(shortId, approver)
    const html     = result.approved
      ? `✅ Account created: <b>${esc(String(result.companyName))}</b>. Assigned to ${esc(String(result.assignedTo ?? ''))}.`
      : `❌ ${esc(String(result.error ?? 'Failed'))}`
    if (messageId) {
      await editMessageText(chatId, messageId, html).catch(() => sendHtml(chatId, html))
    } else {
      await sendHtml(chatId, html)
    }
    return Response.json({ ok: true })
  }

  // ── Reject account request (step 1: ask for reason) ──────────────────────
  if (data.startsWith('racct:') && PRIVILEGED_ROLES.includes(role)) {
    const shortId = data.slice(6)
    await setPending(chatId, { type: 'reject_account', shortId, messageId })
    await sendHtmlWithButtons(chatId,
      `📝 Please reply with the reason for rejecting this account request.\n\nOr tap Cancel.`,
      [[{ text: '✕ Cancel', callback_data: 'cncl' }]],
    )
    return Response.json({ ok: true })
  }

  // ── Book delivery ─────────────────────────────────────────────────────────
  if (data.startsWith('bkd:')) {
    const parts        = data.split(':')
    const orderId12    = parts[1] ?? ''
    const svcCodeRaw   = parts[2] ?? 'MC'
    const svcMap: Record<string, string> = { MC: 'MOTORCYCLE', MP: 'MPV', VN: 'VAN' }
    const serviceType  = svcMap[svcCodeRaw] ?? 'MOTORCYCLE'

    const order = await prisma.order.findFirst({
      where: { id: { startsWith: orderId12 } },
      select: { id: true, referenceNo: true },
    })
    if (!order) {
      await sendHtml(chatId, `❌ Order not found.`)
      return Response.json({ ok: true })
    }

    if (messageId) {
      await editMessageText(chatId, messageId, `⏳ Booking <b>${serviceType}</b> delivery for ${esc(order.referenceNo ?? order.id)}…`).catch(() => undefined)
    }

    const result = await bookLalamoveDelivery(order.id, undefined)
    const html = result.ok
      ? `✅ Delivery booked (${serviceType})!\n\nTracking: ${esc(result.shareLink ?? 'N/A')}`
      : `❌ Booking failed: ${esc(result.error ?? 'Unknown error')}`
    await sendHtml(chatId, html)
    return Response.json({ ok: true })
  }

  // Unknown callback data
  await sendHtml(chatId, '⚠️ Unknown action.')
  return Response.json({ ok: true })
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(message: TelegramMessage): Promise<Response> {
  const chatId = message.chat.id
  const text   = (message.text ?? message.caption ?? '').trim()

  // Commands available before linking
  if (text === '/start' || text === '/help') {
    await sendHtml(chatId, WELCOME_HTML)
    return Response.json({ ok: true })
  }
  if (text === '/myid') {
    await sendHtml(chatId, `Your Telegram ID is: <code>${chatId}</code>\n\nGive this to your admin to link your account.`)
    return Response.json({ ok: true })
  }

  // Resolve CRM user
  const crmUser = await resolveCrmUser(chatId)
  if (!crmUser) {
    await sendHtml(chatId, NOT_LINKED_HTML(chatId))
    return Response.json({ ok: true })
  }

  const role       = crmUser.userRoles[0]?.role?.name ?? 'Salesperson'
  const isPrivileged = PRIVILEGED_ROLES.includes(role)
  const approver: ApproverCtx = { userId: crmUser.id, name: crmUser.name }

  // Block B2B Client and Warehouse
  if (role === 'B2B Client' || role === 'Warehouse') {
    await sendHtml(chatId, '⚠️ Sales Bot is only available to Flexxo salespeople and admins.')
    return Response.json({ ok: true })
  }

  await sendTyping(chatId)

  // ── 📸 Photo → name card account opening ─────────────────────────────────
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]
    try {
      const { buffer, mimeType } = await downloadPhoto(largest.file_id)
      const reply = await handlePhotoMessage(chatId, buffer, mimeType, crmUser.id, crmUser.name)
      await sendHtml(chatId, reply)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[telegram-webhook] photo error:', err)
      await sendHtml(chatId, `⚠️ Could not process the photo: ${esc(msg)}\n\nPlease try again or type the details manually.`)
    }
    return Response.json({ ok: true })
  }

  if (!text) return Response.json({ ok: true })

  // ── Pending-action state (reject flows: awaiting reason) ──────────────────
  const pending = await getPending(chatId)
  if (pending) {
    await clearPending(chatId)
    try {
      if (pending.type === 'reject_quotation') {
        const result = await rejectQuotation(pending.ref, text, approver)
        const html   = result.rejected
          ? `❌ ${esc(String(result.referenceNo ?? pending.ref))} rejected. Reason: ${esc(text)}. Salesperson notified.`
          : `⚠️ ${esc(String(result.error ?? 'Failed'))}`
        if (pending.messageId) {
          await editMessageText(chatId, pending.messageId, html).catch(() => undefined)
        }
        await sendHtml(chatId, html)
      } else if (pending.type === 'reject_account') {
        const result = await rejectAccountRequest(pending.shortId, text)
        const html   = result.rejected
          ? `❌ Account request rejected. Salesperson notified.`
          : `⚠️ ${esc(String(result.error ?? 'Failed'))}`
        if (pending.messageId) {
          await editMessageText(chatId, pending.messageId, html).catch(() => undefined)
        }
        await sendHtml(chatId, html)
      }
    } catch (err) {
      console.error('[telegram-webhook] pending action error:', err)
      await sendHtml(chatId, `⚠️ Error processing action. Please try again.`)
    }
    return Response.json({ ok: true })
  }

  // ── Active name-card session ───────────────────────────────────────────────
  if (await hasActiveSession(chatId)) {
    const reply = await handleTextInSession(chatId, text)
    if (reply !== null) {
      await sendHtml(chatId, reply)
      return Response.json({ ok: true })
    }
  }

  // ── NLP intent routing ─────────────────────────────────────────────────────
  let intent
  try {
    intent = await classifyIntent(text)
  } catch {
    intent = { type: 'general' } as const
  }

  try {
    // Quotation creation
    if (intent.type === 'quotation') {
      const companyAndItems = `${intent.companyName}\n${intent.itemsText}`
      const result = await buildQuotationFromTelegram(companyAndItems, crmUser.id)
      await sendHtml(chatId, result.html)
      return Response.json({ ok: true })
    }

    // Delivery (booking or listing) → Operation Agent
    if (intent.type === 'delivery_booking' || intent.type === 'delivery_list') {
      const reply = await runOperationAgent([], text)
      await sendHtml(chatId, markdownToTelegramHtml(reply))
      return Response.json({ ok: true })
    }

    // Text-based approval (e.g. "approve QT-2026-0042") — privileged only
    if (intent.type === 'approval' && isPrivileged) {
      const action = intent.action
      const ref    = intent.ref
      let html: string

      if (action === 'approve') {
        // Try quotation first (QT- prefix), otherwise try account request
        if (ref.toUpperCase().startsWith('QT')) {
          const result = await approveQuotation(ref, approver)
          html = result.approved
            ? `✅ ${esc(String(result.referenceNo ?? ref))} approved and sent to client.`
            : `❌ ${esc(String(result.error ?? 'Failed'))}`
        } else {
          const result = await approveAccountRequest(ref, approver)
          html = result.approved
            ? `✅ Account created: <b>${esc(String(result.companyName))}</b>.`
            : `❌ ${esc(String(result.error ?? 'Failed'))}`
        }
      } else {
        // Reject: if reason provided in intent, use it; else ask
        const reason = intent.reason ?? ''
        if (!reason) {
          if (ref.toUpperCase().startsWith('QT')) {
            await setPending(chatId, { type: 'reject_quotation', ref })
          } else {
            await setPending(chatId, { type: 'reject_account', shortId: ref })
          }
          await sendHtmlWithButtons(chatId,
            `📝 Please reply with the reason for rejecting <b>${esc(ref)}</b>.\n\nOr tap Cancel.`,
            [[{ text: '✕ Cancel', callback_data: 'cncl' }]],
          )
          return Response.json({ ok: true })
        }
        if (ref.toUpperCase().startsWith('QT')) {
          const result = await rejectQuotation(ref, reason, approver)
          html = result.rejected
            ? `❌ ${esc(String(result.referenceNo ?? ref))} rejected. Salesperson notified.`
            : `❌ ${esc(String(result.error ?? 'Failed'))}`
        } else {
          const result = await rejectAccountRequest(ref, reason)
          html = result.rejected
            ? `❌ Account request rejected. Salesperson notified.`
            : `❌ ${esc(String(result.error ?? 'Failed'))}`
        }
      }
      await sendHtml(chatId, html)
      return Response.json({ ok: true })
    }

    // Admin query → Admin Agent (privileged only)
    if (intent.type === 'admin_query' && isPrivileged) {
      const reply = await runAdminAgent([], text, approver)
      await sendHtml(chatId, markdownToTelegramHtml(reply))
      return Response.json({ ok: true })
    }

    // General → Sales Agent (fallback for everything)
    const reply = await runSalesAgent([], text)
    await sendHtml(chatId, markdownToTelegramHtml(reply))
  } catch (err) {
    console.error('[telegram-webhook] agent error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await sendHtml(chatId, `⚠️ ${esc(msg)}`)
  }

  return Response.json({ ok: true })
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!verifyTelegramWebhook(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = await request.json() as TelegramUpdate
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query)
  }

  if (update.message?.from) {
    return handleMessage(update.message)
  }

  return Response.json({ ok: true })
}
