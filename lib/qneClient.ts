/**
 * Shared QNE API client — authentication + base fetch helpers.
 * Used by lib/qneSync.ts, lib/qneFinancial.ts, and any other QNE integrations.
 */

export const QNE_API_URL = process.env.QNE_API_URL ?? 'http://26.255.19.220:82/api'
export const QNE_DB_CODE = process.env.QNE_DB_CODE ?? 'FKLSB'

const QNE_USERNAME = process.env.QNE_USERNAME ?? 'SALES 6'
const QNE_PASSWORD = process.env.QNE_PASSWORD ?? '12345'

// Request timeouts — without these, a connected-but-stalled VPN makes fetch()
// hang indefinitely, leaving the caller (e.g. a Suspense-wrapped dashboard card)
// stuck forever. A timeout converts a hang into a prompt QneUnavailableError so
// callers can fall back. Login is tiny (short timeout); GETs default generous so
// large sync list-fetches still complete, with a shorter override for the
// latency-sensitive dashboard.
const QNE_LOGIN_TIMEOUT_MS   = 10_000
const QNE_GET_TIMEOUT_MS     = 30_000

/** Fetches a fresh bearer token from QNE. Token is not cached — call once per operation. */
export async function qneLogin(): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${QNE_API_URL}/Users/Login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dbCode: QNE_DB_CODE, userName: QNE_USERNAME, password: QNE_PASSWORD }),
      signal:  AbortSignal.timeout(QNE_LOGIN_TIMEOUT_MS),
    })
  } catch (err) {
    throw new QneUnavailableError(`QNE unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new Error(`QNE login failed: HTTP ${res.status}`)
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new Error('QNE login: no token in response')
  return body.token
}

/** Standard headers required on every authenticated QNE request. */
export function qneHeaders(token: string): Record<string, string> {
  return {
    DbCode:        QNE_DB_CODE,
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Typed GET helper — throws QneUnavailableError if the network is unreachable
 * or the request times out, or a plain Error for non-OK HTTP responses.
 *
 * @param timeoutMs  Per-request timeout. Defaults to 30s (safe for large sync
 *                   list-fetches). Latency-sensitive callers (e.g. the client
 *                   dashboard) should pass a shorter value so a slow VPN fails
 *                   fast and falls back instead of hanging.
 */
export async function qneGet<T>(path: string, token: string, timeoutMs: number = QNE_GET_TIMEOUT_MS): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${QNE_API_URL}${path}`, {
      headers: qneHeaders(token),
      signal:  AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new QneUnavailableError(`QNE unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new Error(`QNE ${path} returned HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * Typed POST helper for QNE writes. Throws QneUnavailableError if the host is
 * unreachable (VPN off), or an Error carrying QNE's business message on non-OK.
 * NOTE: QNE writes must be gated (tender.qne_writes_enabled) and double-approved.
 */
export async function qnePost<T>(path: string, token: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${QNE_API_URL}${path}`, {
      method:  'POST',
      headers: { ...qneHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (err) {
    throw new QneUnavailableError(`QNE unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }
  const text = await res.text()
  if (!res.ok) {
    // QNE returns { code, message } on validation errors — surface the message.
    let msg = `QNE ${path} returned HTTP ${res.status}`
    try { const j = JSON.parse(text); if (j?.message) msg = `QNE: ${j.message}` } catch { /* keep default */ }
    throw new Error(msg)
  }
  return (text ? JSON.parse(text) : null) as T
}

/** Thrown when the QNE host is unreachable (VPN not active). */
export class QneUnavailableError extends Error {
  readonly code = 'QNE_UNAVAILABLE' as const
  constructor(message: string) {
    super(message)
    this.name = 'QneUnavailableError'
  }
}
