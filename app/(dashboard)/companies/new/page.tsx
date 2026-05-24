import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import CompanyForm from '@/components/companies/CompanyForm'

export default async function NewCompanyPage() {
  await verifySession()

  const [stages, users] = await Promise.all([
    prisma.pipelineStageDefinition.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div>
      <Topbar title="Add New Company" />
      <div className="p-8 max-w-2xl">
        <CompanyForm stages={stages} users={users} />
      </div>
    </div>
  )
}
