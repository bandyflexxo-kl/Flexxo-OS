'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Assignment = { id: string; user: { name: string }; isPrimary: boolean }

type CompanyData = {
  id: string
  name: string
  regNumber: string | null
  tinNumber: string | null
  industry: string | null
  companySize: string | null
  generalEmail: string | null
  mainPhone: string | null
  website: string | null
  leadSource: string | null
  status: string
  leadTemperature: string | null
  assignments: Assignment[]
}

const STATUS_OPTIONS = ['Lead', 'Prospect', 'Active Customer', 'Inactive', 'Dormant', 'Lost', 'Do Not Contact']
const LEAD_SOURCE_OPTIONS = ['Referral', 'Cold Call', 'Walk-in', 'Website', 'WhatsApp', 'Trade Show', 'LinkedIn', 'Other']
const COMPANY_SIZE_OPTIONS = ['1–10', '11–50', '51–200', '201–500', '500+']

export default function CompanyOverviewPanel({
  company,
  canEdit,
  createdAt,
}: {
  company: CompanyData
  canEdit: boolean
  createdAt: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name:            company.name,
    status:          company.status,
    leadTemperature: company.leadTemperature ?? '',
    regNumber:       company.regNumber ?? '',
    tinNumber:       company.tinNumber ?? '',
    industry:        company.industry ?? '',
    companySize:     company.companySize ?? '',
    generalEmail:    company.generalEmail ?? '',
    mainPhone:       company.mainPhone ?? '',
    website:         company.website ?? '',
    leadSource:      company.leadSource ?? '',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleCancel() {
    setForm({
      name:            company.name,
      status:          company.status,
      leadTemperature: company.leadTemperature ?? '',
      regNumber:       company.regNumber ?? '',
      tinNumber:       company.tinNumber ?? '',
      industry:        company.industry ?? '',
      companySize:     company.companySize ?? '',
      generalEmail:    company.generalEmail ?? '',
      mainPhone:       company.mainPhone ?? '',
      website:         company.website ?? '',
      leadSource:      company.leadSource ?? '',
    })
    setEditing(false)
    setError(null)
  }

  async function handleSave() {
    setError(null)
    const payload = {
      name:            form.name.trim() || undefined,
      status:          form.status,
      leadTemperature: form.leadTemperature || null,
      regNumber:       form.regNumber.trim() || null,
      tinNumber:       form.tinNumber.trim() || null,
      industry:        form.industry.trim() || null,
      companySize:     form.companySize || null,
      generalEmail:    form.generalEmail.trim() || null,
      mainPhone:       form.mainPhone.trim() || null,
      website:         form.website.trim() || null,
      leadSource:      form.leadSource || null,
    }

    const res = await fetch(`/api/companies/${company.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })

    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error ?? 'Failed to save. Please try again.')
      return
    }

    startTransition(() => {
      setEditing(false)
      router.refresh()
    })
  }

  if (!editing) {
    return (
      <div>
        {canEdit && (
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit Details
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
          <Field label="Company Name" value={company.name} />
          <Field label="Status" value={company.status} />
          <Field label="Lead Temperature" value={company.leadTemperature} />
          <Field label="Registration No." value={company.regNumber} />
          <Field label="TIN Number" value={company.tinNumber} />
          <Field label="Industry" value={company.industry} />
          <Field label="Company Size" value={company.companySize} />
          <Field label="General Email" value={company.generalEmail} />
          <Field label="Main Phone" value={company.mainPhone} />
          <Field label="Website" value={company.website} link />
          <Field label="Lead Source" value={company.leadSource} />
          <Field label="Created" value={createdAt} />
          <div className="sm:col-span-2">
            <p className="text-xs text-gray-400 mb-1">Assigned to</p>
            <div className="flex flex-wrap gap-2">
              {company.assignments.length === 0 ? (
                <span className="text-sm text-gray-400">Unassigned</span>
              ) : (
                company.assignments.map(a => (
                  <span key={a.id} className="text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded">
                    {a.user.name} {a.isPrimary ? '(Primary)' : ''}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Edit mode
  return (
    <div className="max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Edit Company Details</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-400 mb-1">Company Name</label>
          <input name="name" value={form.name} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Status</label>
          <select name="status" value={form.status} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Lead Temperature</label>
          <select name="leadTemperature" value={form.leadTemperature} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">—</option>
            {['Hot', 'Warm', 'Cold'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Registration No.</label>
          <input name="regNumber" value={form.regNumber} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">TIN Number</label>
          <input name="tinNumber" value={form.tinNumber} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Industry</label>
          <input name="industry" value={form.industry} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Company Size</label>
          <select name="companySize" value={form.companySize} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">—</option>
            {COMPANY_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">General Email</label>
          <input name="generalEmail" type="email" value={form.generalEmail} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Main Phone</label>
          <input name="mainPhone" type="tel" value={form.mainPhone} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-400 mb-1">Website</label>
          <input name="website" type="url" value={form.website} onChange={handleChange}
            placeholder="https://"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Lead Source</label>
          <select name="leadSource" value={form.leadSource} onChange={handleChange}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">—</option>
            {LEAD_SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="text-sm text-gray-500 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, link }: { label: string; value?: string | null; link?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      {value ? (
        link ? (
          <a href={value} target="_blank" rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline break-all">
            {value}
          </a>
        ) : (
          <p className="text-sm text-gray-900">{value}</p>
        )
      ) : (
        <p className="text-sm text-gray-400">—</p>
      )}
    </div>
  )
}
