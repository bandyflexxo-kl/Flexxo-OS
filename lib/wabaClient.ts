import 'server-only'

// ── WABA (WhatsApp Business API) — Meta Cloud API client ─────────────────────
//
// Required env vars (add to .env.local + Vercel):
//   WABA_PHONE_NUMBER_ID   — numeric Phone Number ID from Meta Business Manager
//   WABA_ACCESS_TOKEN      — permanent System User access token
//
// If either env var is missing, all sends are silently skipped (no crash).

const PHONE_NUMBER_ID  = process.env.WABA_PHONE_NUMBER_ID  ?? ''
const ACCESS_TOKEN     = process.env.WABA_ACCESS_TOKEN      ?? ''
const GRAPH_API_URL    = 'https://graph.facebook.com/v19.0'

export type WabaTemplateComponent =
  | { type: 'body';   parameters: WabaParameter[] }
  | { type: 'header'; parameters: WabaParameter[] }
  | { type: 'button'; sub_type: 'quick_reply' | 'url'; index: string; parameters: WabaParameter[] }

export type WabaParameter =
  | { type: 'text';     text: string }
  | { type: 'payload';  payload: string }
  | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: 'date_time'; date_time: { fallback_value: string } }

export type WabaSendResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string }

/**
 * Send a WhatsApp template message via Meta Cloud API.
 * Returns { ok: true, messageId } on success, { ok: false, error } on failure.
 * Never throws — safe to fire-and-forget.
 *
 * @param toPhone   E.164 phone number, no '+' (e.g. "601234567890")
 * @param template  Approved template name (e.g. "quotation_ready")
 * @param language  Template language code (default: "en")
 * @param components Template variable components
 */
export async function sendWabaTemplate(
  toPhone:    string,
  template:   string,
  components: WabaTemplateComponent[] = [],
  language =  'en',
): Promise<WabaSendResult> {
  // Skip silently if env vars not configured yet
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.warn('[WABA] Skipping send — WABA_PHONE_NUMBER_ID or WABA_ACCESS_TOKEN not set')
    return { ok: false, error: 'WABA not configured' }
  }

  // Normalise to E.164 without '+' (e.g. 601110951274)
  // Handles: +601110951274 / 601110951274 / 01110951274 (Malaysian local format)
  let phone = toPhone.replace(/[\s\-()]/g, '').replace(/^\+/, '')
  if (phone.startsWith('0')) phone = '6' + phone   // 01x → 601x (Malaysia)
  if (!phone) return { ok: false, error: 'Empty phone number' }
  console.log(`[WABA] Sending template "${template}" to ${phone}`)

  const payload = {
    messaging_product: 'whatsapp',
    to:                phone,
    type:              'template',
    template: {
      name:       template,
      language:   { code: language },
      components: components.length > 0 ? components : undefined,
    },
  }

  try {
    const res = await fetch(
      `${GRAPH_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(payload),
      },
    )

    const body = await res.json() as { messages?: Array<{ id: string }>; error?: { message: string } }

    if (!res.ok || body.error) {
      const msg = body.error?.message ?? `HTTP ${res.status}`
      console.error(`[WABA] Send failed to ${phone}:`, msg)
      return { ok: false, error: msg }
    }

    const messageId = body.messages?.[0]?.id ?? 'unknown'
    return { ok: true, messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[WABA] Network error sending to ${phone}:`, msg)
    return { ok: false, error: msg }
  }
}

/** Check whether WABA is configured (env vars present). */
export function isWabaConfigured(): boolean {
  return Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN)
}
