'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'

// ── Types ──────────────────────────────────────────────────────────────────────

type PendingRequest = {
  id:           string
  requestedBy:  { name: string }
  changes:      Record<string, unknown>
  createdAt:    string
}

type ContactRow = {
  id:              string
  name:            string
  position:        string | null
  department:      string | null
  email:           string | null
  phone:           string | null
  whatsapp:        string | null
  isDecisionMaker: boolean
  pendingRequest:  PendingRequest | null
}

type FormState = {
  name:            string
  position:        string
  email:           string
  phone:           string
  whatsapp:        string
  isDecisionMaker: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function contactToForm(c: ContactRow): FormState {
  return {
    name:            c.name,
    position:        c.position ?? '',
    email:           c.email ?? '',
    phone:           c.phone ?? '',
    whatsapp:        c.whatsapp ?? '',
    isDecisionMaker: c.isDecisionMaker,
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ContactsPanel({
  contacts,
  companyId,
  canEditDirect,  // Admin / Director
}: {
  contacts:      ContactRow[]
  companyId:     string
  canEditDirect: boolean
}) {
  const router = useRouter()
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [form,       setForm]       = useState<FormState | null>(null)
  const [isPending,  startTransition] = useTransition()
  const [error,      setError]      = useState<string | null>(null)
  const [rejectId,   setRejectId]   = useState<{ contactId: string; requestId: string } | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  // ── Edit form open/close ──────────────────────────────────────────────────

  function openEdit(contact: ContactRow) {
    setEditingId(contact.id)
    setForm(contactToForm(contact))
    setError(null)
  }

  function closeEdit() {
    setEditingId(null)
    setForm(null)
    setError(null)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    if (!form) return
    const { name, value, type } = e.target
    setForm(prev => prev ? {
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    } : prev)
  }

  // ── Save: direct (privileged) or request (others) ───────────────────────

  async function handleSave(contactId: string, currentContact: ContactRow) {
    if (!form) return
    setError(null)

    // Build only changed fields
    const payload: Record<string, unknown> = {}
    if (form.name            !== currentContact.name)                                          payload.name            = form.name.trim() || undefined
    if (form.position        !== (currentContact.position ?? ''))                              payload.position        = form.position.trim() || null
    if (form.email           !== (currentContact.email ?? ''))                                 payload.email           = form.email.trim() || null
    if (form.phone           !== (currentContact.phone ?? ''))                                 payload.phone           = form.phone.trim() || null
    if (form.whatsapp        !== (currentContact.whatsapp ?? ''))                              payload.whatsapp        = form.whatsapp.trim() || null
    if (form.isDecisionMaker !== currentContact.isDecisionMaker)                              payload.isDecisionMaker = form.isDecisionMaker

    if (Object.keys(payload).length === 0) { closeEdit(); return }

    const res = await fetch(
      canEditDirect
        ? `/api/contacts/${contactId}`
        : `/api/contacts/${contactId}/edit-request`,
      {
        method:  canEditDirect ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
    )

    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(typeof d.error === 'string' ? d.error : 'Failed to save. Please try again.')
      return
    }

    startTransition(() => { closeEdit(); router.refresh() })
  }

  // ── Admin approve ────────────────────────────────────────────────────────

  async function handleApprove(contactId: string, requestId: string) {
    const res = await fetch(`/api/contacts/${contactId}/edit-request/${requestId}/approve`, { method: 'POST' })
    if (!res.ok) { alert('Failed to approve. Please try again.'); return }
    startTransition(() => router.refresh())
  }

  // ── Admin reject ─────────────────────────────────────────────────────────

  async function submitReject() {
    if (!rejectId) return
    const res = await fetch(`/api/contacts/${rejectId.contactId}/edit-request/${rejectId.requestId}/reject`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reason: rejectNote.trim() || undefined }),
    })
    if (!res.ok) { alert('Failed to reject.'); return }
    setRejectId(null)
    setRejectNote('')
    startTransition(() => router.refresh())
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (contacts.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No contacts yet.{' '}
        <Link href={`/contacts/new?companyId=${companyId}`} className="text-blue-600 hover:underline">
          Add one
        </Link>
      </p>
    )
  }

  return (
    <div>
      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reject contact edit</h3>
            <textarea
              className="w-full text-sm border border-gray-300 rounded-lg p-2 h-24 focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Reason (optional)"
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={submitReject}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                Reject
              </button>
              <button onClick={() => { setRejectId(null); setRejectNote('') }}
                className="text-sm text-gray-500 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="pb-2 font-medium">Name</th>
            <th className="pb-2 font-medium">Position</th>
            <th className="pb-2 font-medium">Email</th>
            <th className="pb-2 font-medium">Phone</th>
            <th className="pb-2 font-medium">Decision Maker</th>
            <th className="pb-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {contacts.map(contact => {
            const req       = contact.pendingRequest
            const changes   = req ? req.changes : null
            const isEditing = editingId === contact.id

            if (isEditing && form) {
              return (
                <tr key={contact.id} className="border-b border-blue-100 bg-blue-50/40">
                  <td className="py-3" colSpan={6}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <Field label="Name">
                        <input name="name" value={form.name} onChange={handleChange}
                          className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </Field>
                      <Field label="Position">
                        <input name="position" value={form.position} onChange={handleChange}
                          className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </Field>
                      <Field label="Email">
                        <input name="email" type="email" value={form.email} onChange={handleChange}
                          className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </Field>
                      <Field label="Phone">
                        <input name="phone" type="tel" value={form.phone} onChange={handleChange}
                          className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </Field>
                      <Field label="WhatsApp">
                        <input name="whatsapp" type="tel" value={form.whatsapp} onChange={handleChange}
                          className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </Field>
                      <Field label="Decision Maker">
                        <label className="flex items-center gap-2 mt-1">
                          <input name="isDecisionMaker" type="checkbox" checked={form.isDecisionMaker}
                            onChange={handleChange} className="rounded" />
                          <span className="text-sm text-gray-700">Yes</span>
                        </label>
                      </Field>
                    </div>

                    {!canEditDirect && (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3 inline-block">
                        Your edit will be sent for admin approval before taking effect.
                      </p>
                    )}

                    {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

                    <div className="flex gap-2">
                      <button onClick={() => handleSave(contact.id, contact)} disabled={isPending}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        {isPending ? 'Saving…' : canEditDirect ? 'Save' : 'Submit for approval'}
                      </button>
                      <button onClick={closeEdit} disabled={isPending}
                        className="text-xs text-gray-500 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )
            }

            const hasPending = !!req
            return (
              <tr key={contact.id}
                className={`border-b border-gray-50 ${hasPending ? 'bg-amber-50/60' : ''}`}>
                <td className="py-2">
                  <Link href={`/contacts/${contact.id}`} className="text-blue-600 hover:underline">
                    {hasPending && changes?.name
                      ? <><span className="line-through text-gray-400 mr-1">{contact.name}</span><span className="italic text-amber-700">{String(changes.name)}</span></>
                      : contact.name}
                  </Link>
                  {hasPending && (
                    <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 whitespace-nowrap">
                      ⏳ pending approval
                    </span>
                  )}
                </td>
                <td className="py-2 text-gray-500">
                  {hasPending && changes?.position !== undefined
                    ? <><span className="line-through text-gray-300 mr-1">{contact.position ?? '—'}</span><span className="italic text-amber-700">{String(changes.position ?? '—')}</span></>
                    : (contact.position ?? '—')}
                </td>
                <td className="py-2 text-gray-500">
                  {hasPending && changes?.email !== undefined
                    ? <><span className="line-through text-gray-300 mr-1">{contact.email ?? '—'}</span><span className="italic text-amber-700">{String(changes.email ?? '—')}</span></>
                    : (contact.email ?? '—')}
                </td>
                <td className="py-2 text-gray-500">
                  {hasPending && changes?.phone !== undefined
                    ? <><span className="line-through text-gray-300 mr-1">{contact.phone ?? '—'}</span><span className="italic text-amber-700">{String(changes.phone ?? '—')}</span></>
                    : (contact.phone ?? '—')}
                </td>
                <td className="py-2">
                  {hasPending && changes?.isDecisionMaker !== undefined
                    ? <Badge color="orange">{changes.isDecisionMaker ? 'Yes (proposed)' : 'No (proposed)'}</Badge>
                    : (contact.isDecisionMaker ? <Badge color="green">Yes</Badge> : '—')}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-1 flex-wrap">
                    {hasPending && canEditDirect && req && (
                      <>
                        <button
                          onClick={() => handleApprove(contact.id, req.id)}
                          disabled={isPending}
                          title={`Requested by ${req.requestedBy.name}`}
                          className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectId({ contactId: contact.id, requestId: req.id })}
                          className="text-xs bg-red-100 text-red-700 border border-red-200 px-2 py-1 rounded hover:bg-red-200 transition-colors"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => openEdit(contact)}
                      className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
