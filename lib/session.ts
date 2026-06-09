import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

export type SessionPayload = {
  userId:            string
  name:              string
  email:             string
  role:              string
  mustChangePassword: boolean
  customerCompanyId?: string   // set for B2B Client portal users
  expiresAt:         Date
}

const secretKey = process.env.SESSION_SECRET ?? process.env.NEXTAUTH_SECRET
const encodedKey = new TextEncoder().encode(secretKey)

/**
 * Session lifetime by role.
 * - B2B Client:  7 days   — clients come back weekly to check orders
 * - Internal:   24 hours  — one full work day; sliding-window renewal in
 *                           middleware keeps active users from being logged out
 */
export function sessionDurationMs(role: string): number {
  return role === 'B2B Client'
    ? 7 * 24 * 60 * 60 * 1000   // 7 days
    : 24 * 60 * 60 * 1000        // 24 hours
}

/** Human-readable JWT expiry string for jose */
function jwtExpiry(role: string): string {
  return role === 'B2B Client' ? '7d' : '24h'
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(jwtExpiry(payload.role))
    .sign(encodedKey)
}

export async function decrypt(session: string | undefined = ''): Promise<SessionPayload | null> {
  if (!session) return null
  try {
    const { payload } = await jwtVerify(session, encodedKey, { algorithms: ['HS256'] })
    return payload as unknown as SessionPayload
  } catch {
    // Covers ExpiredTokenError, JWSInvalid, etc.
    return null
  }
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const durationMs = sessionDurationMs(payload.role)
  const expiresAt  = new Date(Date.now() + durationMs)
  const token      = await encrypt({ ...payload, expiresAt })
  const cookieStore = await cookies()
  cookieStore.set('session', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    expires:  expiresAt,
    sameSite: 'lax',
    path:     '/',
  })
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete('session')
}

export const verifySession = cache(async (): Promise<SessionPayload> => {
  const cookieStore = await cookies()
  const cookie = cookieStore.get('session')?.value
  const session = await decrypt(cookie)
  if (!session?.userId) {
    redirect('/login')
  }
  return session
})

export async function getOptionalSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const cookie = cookieStore.get('session')?.value
  return decrypt(cookie)
}
