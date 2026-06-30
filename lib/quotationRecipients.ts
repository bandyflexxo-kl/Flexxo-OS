import { prisma } from '@/lib/prisma'

/**
 * lib/quotationRecipients.ts
 *
 * Single source of truth for WHICH email addresses a quotation may be sent to:
 * the company's registered (general) email + every active contact that has an
 * email. The same list powers the recipient multi-select in the UI and the
 * server-side allow-list that a send/resend request is validated against (so a
 * caller can never inject an arbitrary address).
 */

export type QuotationRecipient = {
  email:     string
  label:     string                 // display name shown next to the checkbox
  kind:      'company' | 'contact'
  isDefault: boolean                // pre-checked in the UI (the prior single recipient)
}

/**
 * All selectable recipients for a quotation, deduped by email (case-insensitive).
 * `isDefault` marks the quotation's linked contact email — or the company email
 * when there's no linked contact — so the UI pre-checks the historical default.
 */
export async function getQuotationRecipients(quotationId: string): Promise<QuotationRecipient[]> {
  const q = await prisma.quotation.findUnique({
    where:  { id: quotationId },
    select: {
      contact: { select: { email: true } },
      company: {
        select: {
          generalEmail: true,
          contacts: {
            where:   { isActive: true, email: { not: null } },
            select:  { name: true, position: true, email: true },
            orderBy: { name: 'asc' },
          },
        },
      },
    },
  })
  if (!q) return []

  const defaultEmail = (q.contact?.email ?? q.company.generalEmail ?? '').trim().toLowerCase()
  const seen = new Set<string>()
  const out:  QuotationRecipient[] = []

  const push = (email: string | null | undefined, label: string, kind: 'company' | 'contact') => {
    const e = email?.trim()
    if (!e) return
    const key = e.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ email: e, label, kind, isDefault: key === defaultEmail })
  }

  push(q.company.generalEmail, 'Company email', 'company')
  for (const c of q.company.contacts) {
    push(c.email, c.position ? `${c.name} · ${c.position}` : c.name, 'contact')
  }

  // Linked contact had no email → make sure SOMETHING is pre-checked.
  if (out.length && !out.some(r => r.isDefault)) out[0].isDefault = true
  return out
}

/**
 * Resolve the final recipient list for a send/resend.
 * - `requested` is what the UI asked for; only emails in the allow-list survive
 *   (prevents arbitrary-address injection).
 * - When nothing valid was requested, falls back to the default-marked
 *   recipients — preserving the original single-recipient behaviour.
 * Returns lower-cased-deduped, original-cased emails.
 */
export function resolveRecipients(
  all:       QuotationRecipient[],
  requested: string[] | undefined,
): string[] {
  const byKey = new Map(all.map(r => [r.email.toLowerCase(), r.email]))

  if (requested?.length) {
    const picked = new Map<string, string>()
    for (const r of requested) {
      const hit = byKey.get(r.trim().toLowerCase())
      if (hit) picked.set(hit.toLowerCase(), hit)
    }
    if (picked.size) return [...picked.values()]
  }

  return all.filter(r => r.isDefault).map(r => r.email)
}
