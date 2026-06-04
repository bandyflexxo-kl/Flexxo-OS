import 'server-only'

// ── Baileys bridge client ─────────────────────────────────────────────────────
//
// Required env vars:
//   WHATSAPP_BRIDGE_URL  e.g. https://flexxo-wa-bridge.railway.app
//   BRIDGE_SECRET        shared secret (same value set in bridge .env)

const BRIDGE_URL    = (process.env.WHATSAPP_BRIDGE_URL ?? '').replace(/\/$/, '')
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? ''

function bridgeHeaders() {
  return {
    'Authorization': `Bearer ${BRIDGE_SECRET}`,
    'Content-Type':  'application/json',
  }
}

export function isBridgeConfigured(): boolean {
  return Boolean(BRIDGE_URL && BRIDGE_SECRET)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type BridgeSessionState = {
  status:  'disconnected' | 'connecting' | 'connected'
  phone:   string | null
  qr:      string | null   // base64 PNG data URL
}

export type BridgeSendResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string }

// ── API calls ─────────────────────────────────────────────────────────────────

/** Get session status for one CRM user. */
export async function getSessionStatus(userId: string): Promise<BridgeSessionState> {
  if (!isBridgeConfigured()) {
    return { status: 'disconnected', phone: null, qr: null }
  }
  try {
    const res = await fetch(`${BRIDGE_URL}/sessions/${userId}`, {
      headers: bridgeHeaders(),
      cache:   'no-store',
    })
    if (!res.ok) return { status: 'disconnected', phone: null, qr: null }
    return await res.json() as BridgeSessionState
  } catch {
    return { status: 'disconnected', phone: null, qr: null }
  }
}

/** Start a session (triggers QR generation). */
export async function startSession(userId: string): Promise<BridgeSessionState> {
  if (!isBridgeConfigured()) {
    return { status: 'disconnected', phone: null, qr: null }
  }
  const res = await fetch(`${BRIDGE_URL}/sessions/${userId}/connect`, {
    method:  'POST',
    headers: bridgeHeaders(),
  })
  if (!res.ok) throw new Error(`Bridge error ${res.status}`)
  return await res.json() as BridgeSessionState
}

/** Disconnect and wipe a session. */
export async function disconnectUserSession(userId: string): Promise<void> {
  if (!isBridgeConfigured()) return
  await fetch(`${BRIDGE_URL}/sessions/${userId}`, {
    method:  'DELETE',
    headers: bridgeHeaders(),
  })
}

/**
 * Send a WhatsApp message from a salesperson's session.
 * Fire-and-forget safe — never throws.
 */
export async function sendWhatsApp(
  fromUserId: string,
  toPhone:    string,
  message:    string,
): Promise<BridgeSendResult> {
  if (!isBridgeConfigured()) {
    return { ok: false, error: 'Bridge not configured' }
  }
  try {
    const res = await fetch(`${BRIDGE_URL}/send`, {
      method:  'POST',
      headers: bridgeHeaders(),
      body:    JSON.stringify({ userId: fromUserId, toPhone, message }),
    })
    const body = await res.json() as BridgeSendResult
    return body
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[wa-bridge] sendWhatsApp error:', msg)
    return { ok: false, error: msg }
  }
}
