'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { Photo } from '@/components/design-card'
import { REJECT_REASONS, parseCount, wouldComplete } from '@/lib/inwarding/rules'
import type { InwardLine } from '@/lib/inwarding/view'
import { recordReceipt, type ReceiptActionState } from './actions'

const INITIAL: ReceiptActionState = { status: 'idle' }

/**
 * Every field is controlled. React resets an uncontrolled form after its action
 * runs — including when the action came back with "say why these were
 * rejected" — and retyping twelve lines at a bench is how counts go wrong.
 */
interface Draft {
  received: string
  rejected: string
  reason: string
  note: string
}

const EMPTY: Draft = { received: '', rejected: '', reason: '', note: '' }

/**
 * The receiving bench: one card per line, counts typed in, one button.
 *
 * Built for a tablet on a bench with a parcel open beside it — every input is a
 * 44px target with a numeric keypad, and the photograph is big enough to hold a
 * saree up against. The button says, before it is pressed, whether this parcel
 * closes the order, because finding that out from a status badge afterwards is
 * how a short parcel gets closed by accident.
 *
 * After a successful parcel every field clears for the next box, rather than
 * leaving the last counts there to be submitted twice.
 */
export function ReceiptForm({ orderId, lines }: { orderId: string; lines: InwardLine[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(recordReceipt, INITIAL)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [closeShort, setCloseShort] = useState(false)
  const [parcelNote, setParcelNote] = useState('')
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined)

  // Clear the counts once a parcel is saved — adjusting state during render when
  // the action result changes, which React prefers to an effect for exactly this.
  if (state.status === 'success' && state.savedAt !== savedAt) {
    setSavedAt(state.savedAt)
    setDrafts({})
    setCloseShort(false)
    setParcelNote('')
  }

  const entries = lines.map((l) => ({
    orderLineId: l.id,
    received: parseCount(drafts[l.id]?.received) || 0,
    rejected: parseCount(drafts[l.id]?.rejected) || 0,
  }))
  const completes = wouldComplete(
    lines.map((l) => ({ id: l.id, ordered: l.ordered, received: l.received, rejected: l.rejected })),
    entries,
    closeShort,
  )

  const problemFor = (id: string) => state.problems?.find((p) => p.orderLineId === id)?.message

  const set = (id: string, key: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), [key]: value } }))

  return (
    <form
      action={async (fd) => {
        await action(fd)
        router.refresh()
      }}
      className="space-y-4"
    >
      <input type="hidden" name="orderId" value={orderId} />

      {lines.map((line) => {
        const draft = drafts[line.id] ?? EMPTY
        const rejecting = (parseCount(draft.rejected) || 0) > 0
        const problem = problemFor(line.id)

        return (
          <article
            key={line.id}
            className="space-y-3 rounded-xl border border-stone-200 p-4 break-inside-avoid"
          >
            <input type="hidden" name="lineId" value={line.id} />
            <LineHeading line={line} />

            <p className="text-sm text-stone-600 tabular-nums">
              Ordered <strong className="text-stone-900">{line.ordered}</strong>
              {(line.received > 0 || line.rejected > 0) && (
                <>
                  {' · '}already received {line.received}
                  {line.rejected > 0 && `, rejected ${line.rejected}`}
                </>
              )}
              {' · '}
              {line.outstanding > 0 ? (
                <span className="font-medium text-amber-700">{line.outstanding} to come</span>
              ) : (
                <span className="font-medium text-emerald-700">accounted for</span>
              )}
            </p>

            <div className="no-print grid grid-cols-2 gap-3">
              <Field label={line.kind === 'new_design' ? 'Pieces received' : 'Received'}>
                <Input
                  name={`received:${line.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={draft.received}
                  onChange={(e) => set(line.id, 'received', e.target.value)}
                />
              </Field>
              <Field label="Rejected">
                <Input
                  name={`rejected:${line.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={draft.rejected}
                  onChange={(e) => set(line.id, 'rejected', e.target.value)}
                />
              </Field>
            </div>

            {/* Only asked when something was turned away: a reason field on every
                line of a clean parcel is twelve questions nobody needs. */}
            {rejecting && (
              <div className="no-print grid gap-3 sm:grid-cols-2">
                <Field label="Why rejected" required>
                  <Select
                    name={`reason:${line.id}`}
                    value={draft.reason}
                    onChange={(e) => set(line.id, 'reason', e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {REJECT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note">
                  <Input
                    name={`note:${line.id}`}
                    type="text"
                    autoComplete="off"
                    value={draft.note}
                    onChange={(e) => set(line.id, 'note', e.target.value)}
                  />
                </Field>
              </div>
            )}

            {/* On paper, boxes to write in instead of inputs. */}
            <div className="hidden gap-6 text-sm print:flex">
              <span>Received ________</span>
              <span>Rejected ________</span>
              <span>Reason ______________</span>
            </div>

            {problem && <Alert tone="error">{problem}</Alert>}
          </article>
        )
      })}

      <div className="no-print space-y-4 rounded-xl border border-stone-200 p-4">
        <Field label="Parcel note" hint="Anything about the box itself: wet, opened, short.">
          <Textarea
            name="note"
            rows={2}
            value={parcelNote}
            onChange={(e) => setParcelNote(e.target.value)}
          />
        </Field>

        <label className="flex min-h-11 items-start gap-3 text-sm text-stone-700">
          <input
            type="checkbox"
            name="closeShort"
            checked={closeShort}
            onChange={(e) => setCloseShort(e.target.checked)}
            className="mt-0.5 size-5 shrink-0"
          />
          <span>
            <span className="font-medium text-stone-900">Nothing more is coming.</span> Close the
            order with whatever is still missing. Say why in the parcel note.
          </span>
        </label>

        {state.status === 'error' && !state.problems?.some((p) => p.orderLineId) && (
          <Alert tone="error">{state.message}</Alert>
        )}
        {state.status === 'error' && state.problems?.some((p) => p.orderLineId) && (
          <Alert tone="error">Some lines need attention — see above.</Alert>
        )}
        {state.status === 'success' && <Alert tone="success">{state.message}</Alert>}

        <Button type="submit" disabled={pending} className="w-full">
          {pending
            ? 'Recording…'
            : completes
              ? 'Record parcel and mark order received'
              : 'Record parcel (order stays open)'}
        </Button>
      </div>
    </form>
  )
}

/** What the bench is looking for in the box: a code and a photograph, or a brief. */
export function LineHeading({ line }: { line: InwardLine }) {
  if (line.kind === 'restock') {
    return (
      <div className="flex gap-4">
        <Photo url={line.imageUrl} alt={line.title ?? line.sku ?? ''} className="h-40 w-32 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[19px] leading-tight font-medium break-words text-stone-900">
            {line.sku}
          </p>
          {line.title && <p className="text-base text-stone-900">{line.title}</p>}
          <p className="text-xs text-stone-500">Restock — the code is on the piece.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-base leading-snug text-stone-900">{line.brief}</p>
      {line.references.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {line.references.map((ref) => (
            <li key={ref.sku} className="shrink-0">
              <Photo url={ref.imageUrl} alt={ref.sku} className="h-28 w-20" />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-500">
        New designs — no code yet. Count the pieces; they go on to intake to be given codes.
      </p>
    </div>
  )
}
