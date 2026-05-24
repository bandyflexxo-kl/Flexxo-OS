'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'

const ContactSchema = z.object({
  companyId: z.string().min(1, { error: 'Company is required.' }),
  name: z.string().min(1, { error: 'Name is required.' }),
  position: z.string().optional(),
  department: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  influenceLevel: z.string().optional(),
  isDecisionMaker: z.string().optional(),
})

type ContactState = { errors?: Record<string, string>; message?: string } | undefined

export async function createContactAction(state: ContactState, formData: FormData): Promise<ContactState> {
  const session = await verifySession()

  const parsed = ContactSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors
    return { errors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? ''])) }
  }

  const d = parsed.data

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const contact = await prisma.contact.create({
    data: {
      companyId: d.companyId,
      name: d.name,
      position: d.position || null,
      department: d.department || null,
      email: d.email || null,
      phone: d.phone || null,
      whatsapp: d.whatsapp || null,
      influenceLevel: d.influenceLevel || null,
      isDecisionMaker: d.isDecisionMaker === '1',
      createdById: session.userId,
    },
  })

  redirect(`/contacts/${contact.id}`)
}
