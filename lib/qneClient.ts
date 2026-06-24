/**
 * Shared QNE API client — authentication + base fetch helpers.
 * Used by lib/qneSync.ts, lib/qneFinancial.ts, and any other QNE integrations.
 */

export const QNE_API_URL = process.env.QNE_API_URL ?? 'http://26.255.19.220:82/api'
export const QNE_DB_CODE = process.env.QNE_DB_CODE ?? 'FKLSB'

const QNE_USERNAME = process.env.QNE_USERNAME ?? 'SALES 6'
const QNE_PASSWORD = process.env.QNE_PASSWORD ?? '12345'

/** Fetches a fresh bearer token from QNE. Token is not cached — call once per operation. */
export async function qneLogin(): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${QNE_API_URL}/Users/Login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dbCode: QNE_DB_CODE, userName: QNE_USERNAME, password: QNE_PASSWORD }),
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
 * Typed GET helper — throws QneUnavailableError if the network is unreachable,
 * or a plain Error for non-OK HTTP responses.
 */
export async function qneGet<T>(path: string, token: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${QNE_API_URL}${path}`, { headers: qneHeaders(token) })
  } catch (err) {
    throw new QneUnavailableError(`QNE unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new Error(`QNE ${path} returned HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** Thrown when the QNE host is unreachable (VPN not active). */
export class QneUnavailableError extends Error {
  readonly code = 'QNE_UNAVAILABLE' as const
  constructor(message: string) {
    super(message)
    this.name = 'QneUnavailableError'
  }
}
