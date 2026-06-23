'use client'
import { useState } from 'react'

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pass = 'Fx@'
  for (let i = 0; i < 8; i++) pass += chars[Math.floor(Math.random() * chars.length)]
  return pass
}

interface Props {
  companyId:       string
  companyName:     string
  existingAccount: { id: string; email: string } | null
  primaryContact:  { name: string; email: string } | null
}

export default function OpenPortalAccountButton({
  companyId,
  companyName,
  existingAccount,
  primaryContact,
}: Props) {
  const [open, setOpen]       = useState(false)
  const [name, setName]       = useState(primaryContact?.name  ?? '')
  const [email, setEmail]     = useState(primaryContact?.email ?? '')
  const [password]            = useState(generatePassword)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(existingAccount !== null)
  const [doneEmail, setDoneEmail] = useState(existingAccount?.email ?? '')
  const [copied, setCopied]   = useState(false)

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
        ✓ B2B Account Active · {doneEmail}
      </span>
    )
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${companyId}/open-portal-account`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password }),
      })
      const data = await res.json() as { id?: string; email?: string; error?: unknown }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to create account.')
        return
      }
      setDone(true)
      setDoneEmail(data.email ?? email)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  function copyPassword() {
    void navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        Open B2B Account
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Open B2B Shop Account</h2>
            <p className="text-sm text-gray-500 mb-5">{companyName}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Login Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Temporary Password{' '}
                  <span className="text-gray-400 font-normal">(customer changes on first login)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={password}
                    readOnly
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700"
                  />
                  <button
                    onClick={copyPassword}
                    className="text-xs text-blue-600 border border-blue-200 px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Share this with the customer via WhatsApp.</p>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="flex-1 text-sm text-gray-700 border border-gray-300 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !name.trim() || !email.trim()}
                className="flex-1 text-sm bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Creating…' : 'Confirm & Open Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
