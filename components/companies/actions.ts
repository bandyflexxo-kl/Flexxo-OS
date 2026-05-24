'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { normalizeName } from '@/lib/normalize'
import { similarity } from '@/lib/similarity'
import { sendIntroEmail } from '@/lib/email'

const CompanySchema = z.object({
  name: z.string().min(1, { error: 'Company name is required.' }),
  regNumber: z.string().optional(),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  generalEmail: z.string().optional(),
  mainPhone: z.string().optional(),
  website: z.string().optional(),
  leadSource: z.string().optional(),
  leadTemperature: z.string().optional(),
  assignedUserId: z.string().optional(),
  initialStageId: z.string().optional(),
  remarks: z.string().optional(),
  confirmDupe: z.string().optional(),
})

type CompanyState = {
  errors?: Record<string, string>
  message?: string
  duplicateWarning?: string
} | undefined

export async function createCompanyAction(state: CompanyState, formData: FormData): Promise<CompanyState> {
  const session = await verifySession()

  const parsed = CompanySchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors
    return { errors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? ''])) }
  }

  const d = parsed.data
  const nameNormalized = normalizeName(d.name)
  const confirmDupe = d.confirmDupe === '1'

  // Duplicate detection
  if (!confirmDupe) {
    const existing = await prisma.company.findMany({
      where: { mergedIntoId: null },
      select: { id: true, name: true, nameNormalized: true },
    })

    for (const c of existing) {
      const score = similarity(nameNormalized, c.nameNormalized)
      if (score > 0.8) {
        // Log to queue
        return { duplicateWarning: c.name }
      }
    }
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const company = await prisma.company.create({
    data: {
      name: d.name,
      nameNormalized,
      regNumber: d.regNumber || null,
      industry: d.industry || null,
      companySize: d.companySize || null,
      generalEmail: d.generalEmail || null,
      mainPhone: d.mainPhone || null,
      website: d.website || null,
      leadSource: d.leadSource || null,
      leadTemperature: d.leadTemperature || null,
      status: 'Lead',
      createdById: session.userId,
      updatedAt: new Date(),
    },
  })

  // Assign salesperson
  if (d.assignedUserId) {
    await prisma.companyAssignment.create({
      data: { companyId: company.id, userId: d.assignedUserId, isPrimary: true, roleInAccount: 'Primary' },
    })
  }

  // Initial pipeline stage
  if (d.initialStageId) {
    await prisma.pipelineStageHistory.create({
      data: { companyId: company.id, stageId: d.initialStageId, changedById: session.userId },
    })
  }

  // Remarks activity
  if (d.remarks) {
    await prisma.activity.create({
      data: {
        companyId: company.id,
        userId: session.userId,
        activityType: 'Note',
        subject: 'Initial remarks',
        body: d.remarks,
        completedAt: new Date(),
      },
    })
  }

  // Send intro email
  if (d.generalEmail) {
    try {
      const salesperson = d.assignedUserId
        ? await prisma.user.findUnique({ where: { id: d.assignedUserId } })
        : null
      await sendIntroEmail({
        to: d.generalEmail,
        salespersonName: salesperson?.name ?? session.name,
      })
      await prisma.activity.create({
        data: {
          companyId: company.id,
          userId: session.userId,
          activityType: 'Email',
          direction: 'Outbound',
          subject: 'Intro email sent',
          outcome: 'Sent',
          completedAt: new Date(),
        },
      })
    } catch {
      // Email failure is non-fatal; company is still saved
    }
  }

  redirect(`/companies/${company.id}`)
}
