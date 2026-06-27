# Morning Briefing — Implementation Spec

**Status:** Design-ready. Not built.
**Author:** Drafted session 10 (27 Jun 2026)
**Goal:** Complete the "I land abroad and my system tells me what needs me" vision. This is the **proactive** layer — the one missing piece. The reactive layer (agents, Telegram approvals, intent routing) is already live.

---

## 1. Why this is the only missing piece

The 3-agent system (Sales / Admin / Operation) + Telegram webhook already gives you:
- **Pull:** ask the agent anything in free text → `intentRouter` → agent answers
- **Act:** inline buttons (`aqt:` / `rqt:` / `aacct:` / `racct:` / `bkd:`) approve/reject/book from your phone
- **Reactive push:** `notifyByRole()` pings when a quotation is submitted, etc.

What's missing: nothing **wakes up on a schedule and tells you the state of the business** before you ask. The Morning Briefing is that cron. Once it lands in Telegram, the **existing reply loop** handles everything after — you tap a button or voice-reply and the agents execute. So this spec is *only* the briefing builder + cron; we reuse the entire action path.

---

## 2. Reuse map (do NOT rebuild these)

| Need | Existing function | File |
|------|-------------------|------|
| Push to Telegram by role | `notifyByRole(roles, html, buttons?)` | `lib/telegramNotify.ts` |
| Pending quotations + account requests | `listPendingApprovals()` | `lib/agents/adminAgentTools.ts` |
| Inactive clients | `getInactiveClients(days, salesperson?)` | `lib/agents/salesAgentTools.ts` |
| Inline button types | `TelegramInlineButton[][]` | `lib/telegramBot.ts` |
| HTML escape / send | `esc()`, `sendHtml()` | `lib/telegramBot.ts` |
| Approve/reject callbacks | `aqt:{ref}` `rqt:{ref}` `aacct:{shortId}` `racct:{shortId}` | `app/api/webhooks/telegram/route.ts` |
| Cron auth pattern | `Bearer ${CRON_SECRET}` check | `app/api/cron/daily-digest/route.ts` |

**Key consequence:** the briefing's "Approvals" section can render the *same inline buttons* the Admin Agent uses. Tapping Approve in the briefing flows through the existing callback handler — zero new action code.

---

## 3. Briefing content — 4 sections, all read-only

Each section is built from data already in the DB (QNE aging is synced into `company.*` fields; no live VPN call needed, so it works from Vercel cron).

### Section A — Approvals waiting (action buttons)
Source: `listPendingApprovals()`.
- Pending quotations (`status: 'pending_review'`) → each gets `[✅ Approve][❌ Reject]` buttons (`aqt:`/`rqt:`)
- Pending account requests (`telegramAccountRequest status: 'pending'`) → `[✅][❌]` (`aacct:`/`racct:`)
- If both zero: "No approvals waiting ✅"

### Section B — Money / AR (attention)
Source: `prisma.company` where `overdueAmount > 0`, synced (`outstandingUpdatedAt != null`).
```
top 5 by overdueAmount desc:
  - {name}: RM {overdueAmount} overdue (RM {outstandingBalance} total)
totals: RM {sum overdue} overdue across {n} clients
```
No button (collecting payment is a human/finance action) — but the name is tappable later via free-text ("chase Acme's AR").

### Section C — Quiet accounts (attention)
Source: `getInactiveClients(60)` — top 5 longest-quiet assigned clients.
```
{name} — last order {n} days ago ({assignedTo})
```

### Section D — Ops stuck (attention)
Source: `prisma.order` where `status: 'Packed'` AND no `deliveryBooking`.
```
{n} orders packed & waiting for delivery booking
  - {referenceNo} — {company} → [🚚 Book delivery] (bkd:)
```

If **all four sections** are empty → send a single "🌤️ All clear — nothing needs you this morning." (don't skip silently; the absence of a briefing is ambiguous when travelling).

---

## 4. Files

### New: `lib/briefing/morningBriefing.ts`
```ts
export type BriefingData = {
  approvals:  { quotations: ...; accountRequests: ... }
  ar:         { top: {...}[]; totalOverdue: number; clientCount: number }
  quiet:      {...}[]
  opsStuck:   {...}[]
  isAllClear: boolean
}

export async function buildMorningBriefing(): Promise<BriefingData>
export function renderBriefingHtml(d: BriefingData): { html: string; buttons: TelegramInlineButton[][] }
```
- `buildMorningBriefing()` runs the 4 queries (reuse functions above where they fit; write lean queries for B & D).
- `renderBriefingHtml()` returns Telegram HTML + the inline-button matrix (Approve/Reject/Book rows).

### New: `app/api/cron/morning-briefing/route.ts`
- Copy the auth guard from `daily-digest/route.ts` (`Bearer ${CRON_SECRET}`).
- `const data = await buildMorningBriefing()`
- `const { html, buttons } = renderBriefingHtml(data)`
- `await notifyByRole(['Director', 'Admin'], html, buttons)`
- Return `{ ok: true, sections: {...counts} }`.

### Modify: `vercel.json`
Add a cron. KL is UTC+8. For a **07:30 MYT** briefing → **23:30 UTC**:
```json
{ "path": "/api/cron/morning-briefing", "schedule": "30 23 * * *" }
```
(Separate time from the existing `daily-digest` at `0 0` to avoid a thundering herd.)

> ⚠️ **Vercel plan note:** Hobby plan caps cron frequency/count. Confirm the plan allows a 2nd daily cron; if not, fold the briefing into the existing `daily-digest` route as an extra step.

---

## 5. Example Telegram output

```
☀️ Good morning, Bandy — Flexxo briefing for Fri 27 Jun

🔴 2 APPROVALS WAITING
• QT-2026-0188 · Acme Corp · RM 12,400 (JUSTINE)
   [✅ Approve] [❌ Reject]
• New account: Sunrise Hotel Sdn Bhd (BANDY)
   [✅ Approve] [❌ Reject]

💰 AR — RM 18,200 overdue across 3 clients
• Tan Sri Holdings — RM 8,000 overdue (RM 11,500 total)
• Berjaya F&B — RM 6,200 overdue
• Maju Print — RM 4,000 overdue

😴 QUIET ACCOUNTS
• Oriental Law — last order 87 days ago (TIMOTHY)
• KL Steel — last order 64 days ago (BANDY)

📦 1 ORDER STUCK
• ORD-2026-0042 · Sime Properties — packed, no delivery
   [🚚 Book delivery]

Reply to act — e.g. "approve Acme", "chase Tan Sri's AR",
or tap a button above.
```

---

## 6. The reply loop (already built — no work)

After the briefing lands:
- **Button tap** → existing `callback_query` handler in `app/api/webhooks/telegram/route.ts` (`aqt`/`rqt`/`aacct`/`racct`/`bkd`) → executes via Admin/Operation agent tools.
- **Free-text reply** ("chase Tan Sri's AR", "what does Acme usually buy") → `intentRouter.classifyIntent()` → routes to Sales/Admin/Operation agent.

This is why the briefing is the whole job: it's the alarm clock for a machine that already knows how to act.

---

## 7. Open decisions (need your call before build)

1. **Recipients:** `['Director', 'Admin']` for v1? Or Directors only (so salespeople aren't pinged with company-wide AR)?
2. **Time:** 07:30 MYT fixed? While you travel, do you want it at **KL time** (your business runs on KL) or **your local time** (needs a per-user `timezone` field — v2)?
3. **AR threshold:** show all overdue, or only > RM X to avoid noise?
4. **Quiet threshold:** 60 days, or your preferred cutoff?
5. **Vercel plan:** does it allow a 2nd daily cron, or fold into `daily-digest`?

---

## 8. Build estimate

| Piece | Effort |
|-------|--------|
| `buildMorningBriefing()` + lean AR/ops queries | ~1 file, reuses existing helpers |
| `renderBriefingHtml()` + button matrix | small |
| cron route (copy daily-digest guard) | trivial |
| vercel.json entry | 1 line |
| Local test via `curl` with `CRON_SECRET` | — |

No schema changes for v1. No new env vars (Telegram + CRON_SECRET already set). Per-user timezone (decision 2) is the only thing that would add a migration, and it's deferrable to v2.
