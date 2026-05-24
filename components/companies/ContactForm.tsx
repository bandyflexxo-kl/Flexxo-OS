'use client'

import { useActionState } from 'react'
import { createContactAction } from './contactActions'
import Button from '@/components/ui/Button'

interface Company { id: string; name: string }
interface Props {
  companies: Company[]
  defaultCompanyId?: string
}

export default function ContactForm({ companies, defaultCompanyId }: Props) {
  const [state, action, pending] = useActionState(createContactAction, undefined)

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="companyId" className="text-sm font-medium text-gray-700">Company *</label>
        <select id="companyId" name="companyId" defaultValue={defaultCompanyId ?? ''} required
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
          <option value="">Select company</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {state?.errors?.companyId && <p className="text-xs text-red-500">{state.errors.companyId}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name *</label>
        <input id="name" name="name" required className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        {state?.errors?.name && <p className="text-xs text-red-500">{state.errors.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="position" className="text-sm font-medium text-gray-700">Position</label>
          <input id="position" name="position" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="department" className="text-sm font-medium text-gray-700">Department</label>
          <input id="department" name="department" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
          <input id="email" name="email" type="email" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-sm font-medium text-gray-700">Phone</label>
          <input id="phone" name="phone" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="whatsapp" className="text-sm font-medium text-gray-700">WhatsApp</label>
          <input id="whatsapp" name="whatsapp" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="influenceLevel" className="text-sm font-medium text-gray-700">Influence Level</label>
          <select id="influenceLevel" name="influenceLevel" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
            <option value="">Select</option>
            {['High', 'Medium', 'Low'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" name="isDecisionMaker" value="1" className="rounded" />
        Decision Maker
      </label>

      {state?.message && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.message}</p>}

      <div className="flex gap-3">
        <Button type="submit" loading={pending}>Save Contact</Button>
        <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
      </div>
    </form>
  )
}
