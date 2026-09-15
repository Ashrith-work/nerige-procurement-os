'use client'

import { useActionState } from 'react'
import { Alert, Button, Card, Input } from '@/components/ui/primitives'
import { formatLongDay } from '@/lib/performance/period'
import { addStaffMember, setStaffActive, type RosterState } from './actions'

interface RosterPerson {
  id: string
  name: string
  active: boolean
  startedOn: string
}

const IDLE: RosterState = { status: 'idle' }

/**
 * Who is on the sheet. Below it and folded away, because it changes a few
 * times a year and the sheet changes every day.
 *
 * Nobody is ever deleted from here — only taken off the sheet. Their days stay
 * on the record, and "Former staff" keeps the way back for somebody who
 * returns.
 */
export function Roster({
  people,
  today,
  readOnly,
}: {
  people: RosterPerson[]
  today: string
  readOnly: boolean
}) {
  const [addState, add, adding] = useActionState(addStaffMember, IDLE)
  const active = people.filter((p) => p.active)
  const former = people.filter((p) => !p.active)

  return (
    <details className="group" open={people.length === 0}>
      <summary className="cursor-pointer list-none text-sm font-medium text-stone-700 select-none">
        <span className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 hover:bg-stone-100">
          <span className="transition-transform group-open:rotate-90">›</span>
          Floor staff roster · {active.length} on the sheet
        </span>
      </summary>

      <Card className="mt-2 space-y-4">
        {!readOnly && (
          <form action={add} className="flex flex-wrap items-end gap-2">
            <label className="block min-w-48 flex-1">
              <span className="block text-xs text-stone-500">Name</span>
              <Input name="name" required maxLength={60} placeholder="As you call them on the floor" disabled={adding} />
            </label>
            <label className="block">
              <span className="block text-xs text-stone-500">Started</span>
              <Input name="started_on" type="date" defaultValue={today} max={today} className="w-auto" disabled={adding} />
            </label>
            <Button type="submit" disabled={adding}>
              {adding ? 'Adding…' : 'Add to sheet'}
            </Button>
          </form>
        )}
        {addState.status !== 'idle' && (
          <Alert tone={addState.status === 'ok' ? 'success' : 'error'}>{addState.message}</Alert>
        )}

        <ul className="divide-y divide-stone-100">
          {active.map((p) => (
            <RosterRow key={p.id} person={p} readOnly={readOnly} />
          ))}
        </ul>

        {former.length > 0 && (
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Former staff</h3>
            <ul className="divide-y divide-stone-100">
              {former.map((p) => (
                <RosterRow key={p.id} person={p} readOnly={readOnly} />
              ))}
            </ul>
          </div>
        )}
      </Card>
    </details>
  )
}

function RosterRow({ person, readOnly }: { person: RosterPerson; readOnly: boolean }) {
  const [state, act, pending] = useActionState(setStaffActive, IDLE)

  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className={person.active ? 'text-stone-900' : 'text-stone-400'}>{person.name}</span>
      <span className="text-xs text-stone-400">since {formatLongDay(person.startedOn)}</span>
      {state.status === 'error' && <span className="text-sm text-red-700">{state.message}</span>}
      {!readOnly && (
        <form
          action={act}
          className="ml-auto"
          onSubmit={(e) => {
            // Taking someone off the sheet is reversible, but it is still a
            // person's name disappearing from tomorrow's register.
            if (person.active && !window.confirm(`Take ${person.name} off the sheet from today?`)) e.preventDefault()
          }}
        >
          <input type="hidden" name="id" value={person.id} />
          <input type="hidden" name="active" value={person.active ? 'false' : 'true'} />
          <Button type="submit" variant="ghost" disabled={pending} className="text-sm">
            {pending ? '…' : person.active ? 'Take off sheet' : 'Bring back'}
          </Button>
        </form>
      )}
    </li>
  )
}
