'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'

const LoginSchema = z.object({
  email:     z.string().email({ error: 'Please enter a valid email.' }),
  password:  z.string().min(1, { error: 'Password is required.' }),
  returnUrl: z.string().optional(),
})

type LoginState = {
  errors?: { email?: string; password?: string }
  message?: string
} | undefined

export async function shopLoginAction(state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email:     formData.get('email'),
    password:  formData.get('password'),
    returnUrl: formData.get('returnUrl'),
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

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  await createSession({
    userId:             user.id,
    name:               user.name,
    email:              user.email,
    role,
    mustChangePassword: user.mustChangePassword,
    customerCompanyId:  user.customerCompanyId ?? undefined,
    expiresAt:          new Date(),
  })

  // Security: only allow returnUrl that starts with /shop/ (no open redirect)
  const safeReturn = returnUrl && returnUrl.startsWith('/shop/') ? returnUrl : '/shop/products'
  redirect(safeReturn)
}
