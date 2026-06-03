import { sendGenericEmail } from '@/lib/email'
import { getNotificationsForUser, type NotificationItem } from '@/lib/notifications'

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://flexxo-os.vercel.app'

function groupByType(items: NotificationItem[]) {
  return {
    overdue:   items.filter(i => i.type === 'overdue_followup'),
    dueToday:  items.filter(i => i.type === 'due_today'),
    approved:  items.filter(i => i.type === 'approved_quote'),
    draft:     items.filter(i => i.type === 'draft_quote'),
    pending:   items.filter(i => i.type === 'pending_approval'),
    inactive:  items.filter(i => i.type === 'inactive_account'),
  }
}

function itemRow(item: NotificationItem): string {
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
        <a href="${APP_URL}${item.url}" style="color:#1d4ed8;text-decoration:none;font-weight:600;font-size:14px;">${item.title}</a>
        <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">${item.body}</p>
      </td>
    </tr>`
}

function section(emoji: string, heading: string, items: NotificationItem[], color: string): string {
  if (items.length === 0) return ''
  return `
    <div style="margin-bottom:24px;">
      <h3 style="margin:0 0 12px;font-size:13px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">
        ${emoji} ${heading} (${items.length})
      </h3>
      <table style="width:100%;border-collapse:collapse;">
        ${items.map(itemRow).join('')}
      </table>
    </div>`
}

function itemText(item: NotificationItem): string {
  return `  • ${item.title}\n    ${item.body}\n    ${APP_URL}${item.url}`
}

export async function buildAndSendDigest(user: {
  id:    string
  name:  string
  email: string
  role:  string
}): Promise<boolean> {
  // Skip placeholder emails
  if (user.email.endsWith('@flexxo.internal')) return false

  const result = await getNotificationsForUser(user.id, user.role)
  if (result.count === 0) return false   // nothing to report

  const g = groupByType(result.items)

  const today = new Date().toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  })

  const subject = `Your Sales Actions — ${result.count} item${result.count !== 1 ? 's' : ''} · ${today}`

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <div style="background:#1d4ed8;padding:20px 28px;border-radius:8px 8px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:20px;">Flexxo CRM · Daily Actions</h1>
    <p style="color:#bfdbfe;margin:4px 0 0;font-size:14px;">${today}</p>
  </div>
  <div style="background:#f9fafb;padding:24px 28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
    <p style="margin:0 0 20px;font-size:15px;">Hi ${user.name}, here's what needs your attention today:</p>

    ${section('🔴', 'Overdue Follow-ups', g.overdue, '#dc2626')}
    ${section('📋', 'Due Today', g.dueToday, '#d97706')}
    ${section('✉', 'Ready to Send', g.approved, '#7c3aed')}
    ${section('📝', 'Draft Quotes', g.draft, '#2563eb')}
    ${section('⏳', 'Pending Your Approval', g.pending, '#d97706')}
    ${section('😴', 'No Activity in 30+ Days', g.inactive, '#6b7280')}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;">
      <a href="${APP_URL}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">
        Open Flexxo CRM →
      </a>
    </div>

    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      You'll only receive this email when there are actions needed. Have a great day!
    </p>
  </div>
</div>`

  const lines: string[] = [`Hi ${user.name}, here are your sales actions for ${today}:\n`]
  if (g.overdue.length)  lines.push(`🔴 OVERDUE FOLLOW-UPS (${g.overdue.length})\n${g.overdue.map(itemText).join('\n')}`)
  if (g.dueToday.length) lines.push(`📋 DUE TODAY (${g.dueToday.length})\n${g.dueToday.map(itemText).join('\n')}`)
  if (g.approved.length) lines.push(`✉ READY TO SEND (${g.approved.length})\n${g.approved.map(itemText).join('\n')}`)
  if (g.draft.length)    lines.push(`📝 DRAFT QUOTES (${g.draft.length})\n${g.draft.map(itemText).join('\n')}`)
  if (g.pending.length)  lines.push(`⏳ PENDING APPROVAL (${g.pending.length})\n${g.pending.map(itemText).join('\n')}`)
  if (g.inactive.length) lines.push(`😴 INACTIVE ACCOUNTS (${g.inactive.length})\n${g.inactive.map(itemText).join('\n')}`)
  lines.push(`\nOpen CRM: ${APP_URL}`)

  await sendGenericEmail({ to: user.email, subject, text: lines.join('\n\n'), html })
  return true
}
