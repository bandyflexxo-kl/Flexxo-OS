'use server'

import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
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

// A2: a request can carry 1–3 contacts; only Full Name is required per contact
// (matching the CMS contact form). The first contact's email becomes the request
// email / future portal login.
const RequestContactSchema = z.object({
  fullName:        z.string().trim().min(2, 'Contact name is required.'),
  position:        z.string().trim().max(120).optional().or(z.literal('')),
  department:      z.string().trim().max(120).optional().or(z.literal('')),
  email:           z.string().trim().email('Enter a valid email.').optional().or(z.literal('')),
  phone:           z.string().trim().max(40).optional().or(z.literal('')),
  whatsapp:        z.string().trim().max(40).optional().or(z.literal('')),
  influenceLevel:  z.string().trim().max(40).optional().or(z.literal('')),
  isDecisionMaker: z.boolean().optional(),
})

const AccountRequestSchema = z.object({
  companyName: z.string().trim().min(2, { message: 'Please enter your company name.' }),
  message:     z.string().max(500).optional(),
  contacts:    z.array(RequestContactSchema).min(1, 'Add at least one contact.').max(3, 'Up to 3 contacts only.'),
})

export type AccountRequestState = {
  success?:  boolean
  errors?:   { companyName?: string; contacts?: string }
  message?:  string
} | undefined

export async function requestAccountAction(
  state: AccountRequestState,
  formData: FormData,
): Promise<AccountRequestState> {
  let contactsRaw: unknown = []
  try { contactsRaw = JSON.parse(String(formData.get('contacts') ?? '[]')) } catch { contactsRaw = [] }

  const parsed = AccountRequestSchema.safeParse({
    companyName: formData.get('companyName'),
    message:     formData.get('message') || undefined,
    contacts:    contactsRaw,
  })

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors
    return { errors: { companyName: fe.companyName?.[0], contacts: fe.contacts?.[0] } }
  }

  const { companyName, message, contacts } = parsed.data
  const primary = contacts[0]
  if (!primary.email) {
    return { errors: { contacts: 'The first contact needs an email — it becomes the portal login.' } }
  }

  // Save to DB immediately. Top-level fullName/email/phone mirror the primary
  // contact (back-compat); the full list lives in `contacts`.
  await prisma.accountRequest.create({
    data: {
      fullName:    primary.fullName,
      companyName,
      email:       primary.email,
      phone:       primary.phone || null,
      message:     message ?? null,
      contacts:    contacts as unknown as Prisma.InputJsonValue,
    },
  })

  // Push notification to all Admins/Managers — fire-and-forget
  sendPushToManagers({
    title: 'New Account Request',
    body:  `${companyName} — ${primary.fullName}${contacts.length > 1 ? ` (+${contacts.length - 1} more)` : ''}`,
    url:   '/admin/account-requests',
  }).catch(() => undefined)

  const contactsText = contacts
    .map((c, i) => `  ${i + 1}. ${c.fullName}${c.position ? ` (${c.position})` : ''}${c.email ? ` — ${c.email}` : ''}${c.phone ? ` — ${c.phone}` : ''}`)
    .join('\n')
  const contactsHtml = contacts
    .map((c, i) => `<tr${i % 2 ? ' style="background:#f9fafb"' : ''}><td style="padding:8px;font-weight:bold;color:#374151">Contact ${i + 1}</td><td style="padding:8px">${c.fullName}${c.position ? ` · ${c.position}` : ''}${c.department ? ` · ${c.department}` : ''}${c.email ? `<br><a href="mailto:${c.email}">${c.email}</a>` : ''}${c.phone ? `<br>☎ ${c.phone}` : ''}${c.whatsapp ? `<br>WA ${c.whatsapp}` : ''}${c.isDecisionMaker ? ' <strong>(Decision Maker)</strong>' : ''}</td></tr>`)
    .join('')

  // Notify Flexxo team — fire-and-forget (never block on email)
  try {
    await sendGenericEmail({
      to:      process.env.ADMIN_EMAIL ?? 'admin@flexxo.com.my',
      subject: `New Account Request — ${companyName}`,
      text:    `New B2B Account Request\nCompany: ${companyName}\nContacts:\n${contactsText}${message ? `\nMessage: ${message}` : ''}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="color:#16a34a">New B2B Account Request</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;font-weight:bold;color:#374151">Company</td><td style="padding:8px">${companyName}</td></tr>
            ${contactsHtml}
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
