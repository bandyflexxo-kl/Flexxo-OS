import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'

const MoveSchema = z.object({
  companyId: z.string(),
  toStageId: z.string(),
  fromHistoryId: z.string(),
})

export async function POST(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = MoveSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { companyId, toStageId, fromHistoryId } = parsed.data

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  await prisma.$transaction([
    prisma.pipelineStageHistory.update({
      where: { id: fromHistoryId },
      data: { exitedAt: new Date() },
    }),
    prisma.pipelineStageHistory.create({
      data: { companyId, stageId: toStageId, changedById: session.userId },
    }),
  ])

  return Response.json({ ok: true })
}
