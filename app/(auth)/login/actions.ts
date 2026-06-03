'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'

const LoginSchema = z.object({
  email: z.string().email({ error: 'Please enter a valid email.' }),
  password: z.string().min(1, { error: 'Password is required.' }),
})

type LoginState = {
  errors?: { email?: string; password?: string }
  message?: string
} | undefined

export async function loginAction(state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    return {
      errors: {
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      },
    }
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({
    where: { email },
    include: { userRoles: { include: { role: true } } },
  })

  if (!user || !user.isActive) {
    return { message: 'Invalid email or password.' }
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return { message: 'Invalid email or password.' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  const role = user.userRoles[0]?.role?.name ?? 'Viewer'
  await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    role,
    mustChangePassword: user.mustChangePassword,
    expiresAt: new Date(),
  })

  redirect('/')
}
