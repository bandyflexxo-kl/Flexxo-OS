'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { createShopSession } from '@/lib/session'
import { sendGenericEmail } from '@/lib/email'
import { sendPushToManagers } from '@/lib/webpush'

// ── T6-5: Login rate limiter ───────────────────────────────────────────────
// Simple in-memory store keyed by IP. Works on single-process dev server.
// On Vercel (multi-instance), each instance has its own store — provides
// partial protection. A Redis-backed limiter is the upgrade path.
//
// Rule: 5 attempts within 60 s → 60-second lockout for that IP.

const MAX_ATTEMPTS  = 5
const WINDOW_MS     = 60_000  // 60 seconds
const LOCKOUT_MS    = 60_000  // 60 seconds

interface RateBucket {
  attempts:   number
  windowStart: number
  lockedUntil: number | null
}

const rateLimitStore = new Map<string, RateBucket>()

async function getClientIp(): Promise<string> {
  // Server action → use next/headers to read forwarded IP
  // In Next.js 15+, headers() returns a Promise
  try {
    const hdrs = await headers()
    return (
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      hdrs.get('x-real-ip') ??
      'unknown'
    )
  } catch {
    return 'unknown'
  }
}

function checkRateLimit(ip: string): { allowed: boolean; secondsLeft: number } {
  const now    = Date.now()
  const bucket = rateLimitStore.get(ip)

  if (!bucket) {
    rateLimitStore.set(ip, { attempts: 1, windowStart: now, lockedUntil: null })
    return { allowed: true, secondsLeft: 0 }
  }

  // Still locked out?
  if (bucket.lockedUntil && now < bucket.lockedUntil) {
    return { allowed: false, secondsLeft: Math.ceil((bucket.lockedUntil - now) / 1000) }
  }

  // New window?
  if (now - bucket.windowStart > WINDOW_MS) {
    rateLimitStore.set(ip, { attempts: 1, windowStart: now, lockedUntil: null })
    return { allowed: true, secondsLeft: 0 }
  }

  // Increment within window
  bucket.attempts += 1
  if (bucket.attempts > MAX_ATTEMPTS) {
    bucket.lockedUntil = now + LOCKOUT_MS
    return { allowed: false, secondsLeft: Math.ceil(LOCKOUT_MS / 1000) }
  }

  return { allowed: true, secondsLeft: 0 }
}

function resetRateLimit(ip: string) {
  rateLimitStore.delete(ip)
}

// ── Login ─────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email:     z.string().email({ message: 'Please enter a valid email.' }),
  password:  z.string().min(1, { message: 'Password is required.' }),
  returnUrl: z.string().optional(),
})

export type LoginState = {
  errors?: { email?: string; password?: string }
  message?: string
} | undefined

export async function shopLoginAction(state: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await getClientIp()
  const { allowed, secondsLeft } = checkRateLimit(ip)

  if (!allowed) {
    return {
      message: `Too many failed attempts. Please wait ${secondsLeft} second${secondsLeft === 1 ? '' : 's'} before trying again.`,
    }
  }

  const parsed = LoginSchema.safeParse({
    email:     formData.get('email'),
    password:  formData.get('password'),
    // formData.get() returns null when field is absent; Zod z.string().optional()
    // accepts string|undefined but NOT null → convert null → undefined so Zod passes.
    returnUrl: formData.get('returnUrl') ?? undefined,
  })

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors
    return { errors: { email: fe.email?.[0], password: fe.password?.[0] } }
  }

  const { email, password, returnUrl } = parsed.data

  const user = await prisma.user.findUnique({
    where:   { email },
    include: { userRoles: { include: { role: true } } },
  })

  if (!user || !user.isActive) return { message: 'Invalid email or password.' }

  const role = user.userRoles.find(r => !r.revokedAt)?.role?.name ?? ''
  if (role !== 'B2B Client') return { message: 'Shop access not available for this account.' }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return { message: 'Invalid email or password.' }

  // Successful login → clear rate limit for this IP
  resetRateLimit(ip)

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  await createShopSession({
    userId:             user.id,
    name:               user.name,
    email:              user.email,
    role,
    mustChangePassword: user.mustChangePassword,
    customerCompanyId:  user.customerCompanyId ?? undefined,
    expiresAt:          new Date(),
  })

  // After login, B2B clients ALWAYS land on their dashboard.
  // Only exception: /shop/cart — preserve checkout flow so cart items aren't lost.
  // Everything else (products page, login page, etc.) is overridden to dashboard.
  const safeReturn = (returnUrl && returnUrl.startsWith('/shop/cart'))
    ? returnUrl
    : '/shop/dashboard'
  redirect(safeReturn)
}

// ── Request Business Account ───────────────────────────────────────────────

const AccountRequestSchema = z.object({
  fullName:    z.string().min(2,  { message: 'Please enter your full name.' }),
  companyName: z.string().min(2,  { message: 'Please enter your company name.' }),
  email:       z.string().email({ message: 'Please enter a valid email address.' }),
  phone:       z.string().optional(),
  message:     z.string().max(500).optional(),
})

export type AccountRequestState = {
  success?:  boolean
  errors?:   { fullName?: string; companyName?: string; email?: string; phone?: string }
  message?:  string
} | undefined

export async function requestAccountAction(
  state: AccountRequestState,
  formData: FormData,
): Promise<AccountRequestState> {
  const parsed = AccountRequestSchema.safeParse({
    fullName:    formData.get('fullName'),
    companyName: formData.get('companyName'),
    email:       formData.get('email'),
    phone:       formData.get('phone') || undefined,
    message:     formData.get('message') || undefined,
  })

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors
    return {
      errors: {
        fullName:    fe.fullName?.[0],
        companyName: fe.companyName?.[0],
        email:       fe.email?.[0],
        phone:       fe.phone?.[0],
      },
    }
  }

  const { fullName, companyName, email, phone, message } = parsed.data

  // T4-4(a): Save to database immediately (T5-5(d) equivalent)
  await prisma.accountRequest.create({
    data: { fullName, companyName, email, phone, message },
  })

  // T4-4(a2): Push notification to all Admins/Managers — fire-and-forget
  sendPushToManagers({
    title: 'New Account Request',
    body:  `${companyName} — ${fullName}`,
    url:   '/admin/account-requests',
  }).catch(() => undefined)

  // T4-4(b): Notify Flexxo team — fire-and-forget (never block on email)
  try {
    await sendGenericEmail({
      to:      process.env.ADMIN_EMAIL ?? 'admin@flexxo.com.my',
      subject: `New Account Request — ${companyName}`,
      text:    `New B2B Account Request\nName: ${fullName}\nCompany: ${companyName}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ''}${message ? `\nMessage: ${message}` : ''}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="color:#16a34a">New B2B Account Request</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;font-weight:bold;color:#374151">Name</td><td style="padding:8px">${fullName}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#374151">Company</td><td style="padding:8px">${companyName}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;color:#374151">Email</td><td style="padding:8px"><a href="mailto:${email}">${email}</a></td></tr>
            ${phone ? `<tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#374151">Phone</td><td style="padding:8px">${phone}</td></tr>` : ''}
            ${message ? `<tr><td style="padding:8px;font-weight:bold;color:#374151">Message</td><td style="padding:8px">${message}</td></tr>` : ''}
          </table>
          <p style="color:#6b7280;font-size:13px;margin-top:16px">
            Manage requests in the admin portal: /admin/account-requests
          </p>
        </div>
      `,
    })
  } catch (err) {
    console.error('[AccountRequest] Notification email failed (non-fatal):', err)
    // T5-5(e): Email failure does NOT fail the request — it was already saved to DB above
  }

  return { success: true }
}
