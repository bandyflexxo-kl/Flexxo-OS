'use client'

import { useActionState, useState } from 'react'
import { createCompanyAction } from './actions'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'

interface Stage { id: string; name: string }
interface User { id: string; name: string }

interface Props {
  stages: Stage[]
  users: User[]
}

const LEAD_SOURCES = ['Name Card', 'WhatsApp', 'Cold Call', 'BNI/Referral', 'Website', 'Social Media', 'QNE Import', 'Other']
const INDUSTRIES = ['Manufacturing', 'Trading', 'Retail', 'Construction', 'F&B', 'Healthcare', 'Education', 'Finance', 'IT', 'Property', 'Logistics', 'Other']
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+']
const TEMPERATURES = ['Cold', 'Warm', 'Hot']

export default function CompanyForm({ stages, users }: Props) {
  const [state, action, pending] = useActionState(createCompanyAction, undefined)
  const [showDupeWarning, setShowDupeWarning] = useState(false)

  return (
    <>
      {state?.duplicateWarning && !showDupeWarning && (
        <Modal
          title="Possible Duplicate Detected"
          onClose={() => setShowDupeWarning(true)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setShowDupeWarning(true)}>Cancel</Button>
              <Button onClick={() => setShowDupeWarning(true)}>Save Anyway</Button>
            </>
          }
        >
          <p>A similar company was found: <strong>{state.duplicateWarning}</strong></p>
          <p className="mt-2 text-gray-500">Do you still want to save this company?</p>
        </Modal>
      )}

      <form action={action} className="space-y-5">
        <input type="hidden" name="confirmDupe" value={showDupeWarning ? '1' : ''} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium text-gray-700">Company Name *</label>
            <input id="name" name="name" required className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            {state?.errors?.name && <p className="text-xs text-red-500">{state.errors.name}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="regNumber" className="text-sm font-medium text-gray-700">Registration Number</label>
            <input id="regNumber" name="regNumber" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="industry" className="text-sm font-medium text-gray-700">Industry</label>
            <select id="industry" name="industry" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="">Select industry</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="companySize" className="text-sm font-medium text-gray-700">Company Size</label>
            <select id="companySize" name="companySize" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="">Select size</option>
              {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="generalEmail" className="text-sm font-medium text-gray-700">General Email</label>
            <input id="generalEmail" name="generalEmail" type="email" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="mainPhone" className="text-sm font-medium text-gray-700">Main Phone</label>
            <input id="mainPhone" name="mainPhone" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="website" className="text-sm font-medium text-gray-700">Website</label>
            <input id="website" name="website" type="url" className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="https://" />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="leadSource" className="text-sm font-medium text-gray-700">Lead Source</label>
            <select id="leadSource" name="leadSource" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="">Select source</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="leadTemperature" className="text-sm font-medium text-gray-700">Lead Temperature</label>
            <select id="leadTemperature" name="leadTemperature" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="">Select temperature</option>
              {TEMPERATURES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="assignedUserId" className="text-sm font-medium text-gray-700">Assigned Salesperson</label>
            <select id="assignedUserId" name="assignedUserId" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="initialStageId" className="text-sm font-medium text-gray-700">Initial Pipeline Stage</label>
            <select id="initialStageId" name="initialStageId" className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="">Select stage</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2 flex flex-col gap-1">
            <label htmlFor="remarks" className="text-sm font-medium text-gray-700">Remarks</label>
            <textarea id="remarks" name="remarks" rows={3} className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none" />
          </div>
        </div>

        {state?.message && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.message}</p>
        )}

        <div className="flex gap-3">
          <Button type="submit" loading={pending}>Save Company</Button>
          <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
        </div>
      </form>
    </>
  )
}
