/**
 * GET /api/cron/morning-briefing
 * Daily Director briefing pushed to Telegram. Scheduled in vercel.json for
 * 23:30 UTC = 07:30 MYT. Auth: Bearer ${CRON_SECRET} (same as daily-digest).
 *
 * Reuses the existing Telegram action loop — the inline buttons rendered here
 * fire the webhook's aqt/rqt/aacct/racct callbacks, so no new action code.
 *
 * Spec: docs/morning-briefing-spec.md
 */
import { buildMorningBriefing, renderBriefingHtml } from '@/lib/briefing/morningBriefing'
import { notifyByRole }                             from '@/lib/telegramBot'

export async function GET(request: Request) {
  const auth     = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const data            = await buildMorningBriefing()
  const { html, buttons } = renderBriefingHtml(data)

  // Send to the 3 Directors (anyone with the Director role + a linked Telegram chat)
  await notifyByRole(['Director'], html, buttons.length > 0 ? buttons : undefined)

  return Response.json({
    ok: true,
    sections: {
      pendingQuotations:      data.approvals.quotations.length,
      pendingAccountRequests: data.approvals.accountRequests.length,
      overdueClients:         data.ar.clientCount,
      totalOverdue:           data.ar.totalOverdue,
      quietAccounts:          data.quiet.length,
      ordersStuck:            data.opsStuck.length,
      allClear:               data.isAllClear,
    },
  })
}
