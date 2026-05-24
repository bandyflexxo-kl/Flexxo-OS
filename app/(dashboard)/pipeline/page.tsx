import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import KanbanBoard from '@/components/pipeline/KanbanBoard'

export default async function PipelinePage() {
  await verifySession()

  const stages = await prisma.pipelineStageDefinition.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  // Get all companies in their current pipeline stage
  const currentHistories = await prisma.pipelineStageHistory.findMany({
    where: { exitedAt: null },
    include: {
      company: {
        include: {
          contacts: { where: { isDecisionMaker: true, isActive: true }, take: 1 },
          assignments: { where: { isPrimary: true, unassignedAt: null }, include: { user: true }, take: 1 },
        },
      },
      stage: true,
    },
    orderBy: { enteredAt: 'desc' },
  })

  const columnMap = stages.map((stage) => ({
    stage,
    cards: currentHistories
      .filter((h) => h.stageId === stage.id)
      .map((h) => ({
        historyId: h.id,
        companyId: h.company.id,
        companyName: h.company.name,
        leadTemperature: h.company.leadTemperature,
        status: h.company.status,
        contact: h.company.contacts[0] ?? null,
        assignee: h.company.assignments[0]?.user ?? null,
        daysInStage: Math.floor((Date.now() - new Date(h.enteredAt).getTime()) / 86400000),
      })),
  }))

  return (
    <div>
      <Topbar title="Pipeline Board" />
      <div className="p-8 overflow-x-auto">
        <KanbanBoard columns={columnMap} stages={stages} />
      </div>
    </div>
  )
}
