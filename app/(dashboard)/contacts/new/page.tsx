import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import ContactForm from '@/components/companies/ContactForm'

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>
}) {
  await verifySession()
  const { companyId } = await searchParams

  const companies = await prisma.company.findMany({
    where: { mergedIntoId: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const defaultCompany = companyId ? companies.find((c) => c.id === companyId) : undefined

  return (
    <div>
      <Topbar title="Add New Contact" />
      <div className="p-8 max-w-xl">
        <ContactForm companies={companies} defaultCompanyId={companyId} />
      </div>
    </div>
  )
}
