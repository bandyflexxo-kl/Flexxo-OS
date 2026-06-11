import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge from '@/components/ui/Badge'
import Link from 'next/link'
import { companyOwnerFilter } from '@/lib/authorization'

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await verifySession()
  const { q } = await searchParams
  const ownerFilter = companyOwnerFilter(session)

  const contacts = await prisma.contact.findMany({
    where: {
      isActive: true,
      company:  ownerFilter,
      ...(q ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { company: { name: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: { company: true },
    orderBy: { name: 'asc' },
    take: 200,
  })

  return (
    <div>
      <Topbar
        title="Contacts"
        actions={
          <Link href="/contacts/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            + Add Contact
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8">
        <form className="mb-6">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search contacts..."
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-60"
          />
          <button type="submit" className="ml-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">Search</button>
        </form>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">WhatsApp</th>
                <th className="px-4 py-3 font-medium">Decision Maker</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No contacts found.</td></tr>
              )}
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/contacts/${c.id}`} className="text-blue-600 hover:underline font-medium">{c.name}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/companies/${c.companyId}`} className="text-gray-600 hover:underline">{c.company.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.position ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.whatsapp ?? '—'}</td>
                  <td className="px-4 py-3">{c.isDecisionMaker ? <Badge color="green">Yes</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">{contacts.length} contacts</p>
      </div>
    </div>
  )
}
