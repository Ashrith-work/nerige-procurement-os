'use client'

import { useActionState } from 'react'
import { Button, Select, Input } from '@/components/ui/primitives'
import { approveSignup, rejectSignup, type DecisionState } from './actions'

export interface SignupRow {
  id: string
  userId: string
  fullName: string
  requestedRole: string
  vendorCode: string | null
  phone: string | null
  note: string | null
  createdAt: string
  /** True when someone already has a login under this identity. */
  alreadyHasAccount: boolean
}

const ROLE_LABELS: Record<string, string> = {
  vendor: 'Weaver',
  warehouse_manager: 'Warehouse manager',
  customer_support: 'Customer support',
  procurement_head: 'Procurement',
}

const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'kn', label: 'ಕನ್ನಡ Kannada' },
  { value: 'ta', label: 'தமிழ் Tamil' },
  { value: 'te', label: 'తెలుగు Telugu' },
  { value: 'hi', label: 'हिन्दी Hindi' },
]

const INITIAL: DecisionState = { status: 'idle' }

/**
 * One request, and the two things that can happen to it.
 *
 * THE PASSWORD IS SHOWN ONCE AND NOWHERE ELSE. It exists in this component's
 * state and in Supabase's hash, and that is all — there is no email to send it
 * in, because these accounts live on a domain that cannot receive mail. So it
 * is rendered large, in monospace, with the reason it will not come back said
 * plainly. Losing it is recoverable but it costs a second conversation.
 *
 * THE LANGUAGE PICKER IS NOT COSMETIC. For a weaver it writes
 * `vendors.default_locale`, so every later login at that house inherits it. A
 * weaver who reads Kannada arriving at an English portal is the failure this
 * one dropdown prevents, and this screen is the last moment anyone is thinking
 * about her specifically.
 */
export function DecisionRow({ request }: { request: SignupRow }) {
  const [approveState, approve, approving] = useActionState(approveSignup, INITIAL)
  const [rejectState, reject, rejecting] = useActionState(rejectSignup, INITIAL)

  const busy = approving || rejecting
  const done = approveState.status === 'approved' || rejectState.status === 'rejected'

  return (
    <li className="space-y-3 border-b border-stone-200 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium text-stone-900">{request.fullName}</span>
        <span className="font-mono text-sm text-stone-600">{request.userId}</span>
        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
          {ROLE_LABELS[request.requestedRole] ?? request.requestedRole}
        </span>
        {request.vendorCode && (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-600">
            {request.vendorCode}
          </span>
        )}
      </div>

      <p className="text-xs text-stone-500">
        Asked {new Date(request.createdAt).toLocaleDateString('en-IN')}
        {request.phone && ` · ${request.phone}`}
      </p>

      {request.note && <p className="text-sm text-stone-600 italic">“{request.note}”</p>}

      {/*
        * Not a block, just a warning. Somebody may legitimately be re-applying
        * after losing a password, and the approve action would fail on the
        * duplicate email anyway — but a surprise error is a worse experience
        * than being told first.
        */}
      {request.alreadyHasAccount && (
        <p className="text-sm text-amber-700">
          Someone already signs in with this user ID. Approving will fail — reset their password
          instead.
        </p>
      )}

      {approveState.status === 'approved' && approveState.password ? (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm text-emerald-900">{approveState.message}</p>
          <div className="rounded bg-white p-2">
            <p className="text-xs text-stone-500">User ID</p>
            <p className="font-mono text-sm break-all text-stone-900">{approveState.userId}</p>
            <p className="mt-2 text-xs text-stone-500">Password — shown once</p>
            <p className="font-mono text-lg break-all text-stone-900 select-all">
              {approveState.password}
            </p>
          </div>
          <p className="text-xs text-emerald-800">
            Nothing sends this. Copy it and pass it on however you already speak to them.
          </p>
        </div>
      ) : rejectState.status === 'rejected' ? (
        <p className="text-sm text-stone-500">Rejected.</p>
      ) : (
        !done && (
          <div className="flex flex-wrap items-end gap-2">
            <form action={approve} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={request.id} />
              <label className="text-xs text-stone-500">
                Portal language
                <Select name="locale" defaultValue="en" className="mt-1 w-auto min-w-36">
                  {LOCALES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" disabled={busy}>
                {approving ? 'Creating…' : 'Approve'}
              </Button>
            </form>

            <form action={reject} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={request.id} />
              <Input
                name="note"
                placeholder="Reason (optional)"
                className="w-auto min-w-44"
                disabled={busy}
              />
              <Button type="submit" variant="secondary" disabled={busy}>
                {rejecting ? 'Rejecting…' : 'Reject'}
              </Button>
            </form>
          </div>
        )
      )}

      {(approveState.status === 'error' || rejectState.status === 'error') && (
        <p className="text-sm text-red-700">
          {approveState.message ?? rejectState.message}
        </p>
      )}
    </li>
  )
}
