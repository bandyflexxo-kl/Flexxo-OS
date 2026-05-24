import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge from '@/components/ui/Badge'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession()
  const { id } = await params

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      company: true,
      activities: {
        orderBy: { createdAt: 'desc' },
        include: { user: true },
        take: 30,
      },
    },
  })

  if (!contact) notFound()

  return (
    <div>
      <Topbar title={contact.name} />
      <div className="p-8 max-w-2xl space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 grid grid-cols-2 gap-4">
          <Field label="Company">
            <Link href={`/companies/${contact.companyId}`} className="text-blue-600 hover:underline">
              {contact.company.name}
            </Link>
          </Field>
          <Field label="Position">{contact.position ?? '—'}</Field>
          <Field label="Department">{contact.department ?? '—'}</Field>
          <Field label="Email">{contact.email ?? '—'}</Field>
          <Field label="Phone">{contact.phone ?? '—'}</Field>
          <Field label="WhatsApp">{contact.whatsapp ?? '—'}</Field>
          <Field label="Influence Level">{contact.influenceLevel ?? '—'}</Field>
          <Field label="Decision Maker">
            {contact.isDecisionMaker ? <Badge color="green">Yes</Badge> : 'No'}
          </Field>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Activity History</h2>
          {contact.activities.length === 0 ? (
            <p className="text-sm text-gray-400">No activities linked to this contact.</p>
          ) : (
            <div className="space-y-3">
              {contact.activities.map((a) => (
                <div key={a.id} className="border-b border-gray-50 pb-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge>{a.activityType}</Badge>
                    <span className="text-sm font-medium">{a.subject}</span>
                    <span className="text-xs text-gray-400 ml-auto">{new Date(a.createdAt).toLocaleDateString()}</span>
                  </div>
                  {a.body && <p className="text-sm text-gray-600">{a.body}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">By {a.user.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  )
}
