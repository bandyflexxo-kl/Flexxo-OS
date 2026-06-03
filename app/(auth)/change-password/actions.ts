'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { verifySession, createSession } from '@/lib/session'

const Schema = z.object({
  password:        z.string().min(8, { error: 'Password must be at least 8 characters.' }),
  confirmPassword: z.string().min(1, { error: 'Please confirm your password.' }),
})

type State = { errors?: { password?: string; confirmPassword?: string }; message?: string } | undefined

export async function changePasswordAction(state: State, formData: FormData): Promise<State> {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')

  const parsed = Schema.safeParse({
    password:        formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors
    return { errors: { password: fe.password?.[0], confirmPassword: fe.confirmPassword?.[0] } }
  }

  const { password, confirmPassword } = parsed.data

  if (password !== confirmPassword) {
    return { errors: { confirmPassword: 'Passwords do not match.' } }
  }

  const hash = await bcrypt.hash(password, 12)

  await prisma.user.update({
    where: { id: session.userId },
    data:  { passwordHash: hash, mustChangePassword: false },
  })

  // Re-issue session with mustChangePassword: false
  await createSession({ ...session, mustChangePassword: false, expiresAt: new Date() })

  redirect('/')
}
