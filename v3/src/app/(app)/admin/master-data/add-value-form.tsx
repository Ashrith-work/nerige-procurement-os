'use client'

import { useActionState } from 'react'
import { Button, Input } from '@/components/ui/primitives'
import { addValue, type MasterDataState } from './actions'

const INITIAL: MasterDataState = { status: 'idle' }

/**
 * Adds a value to the current tab. The code is required for the three types a
 * SKU carries and optional (derived from the name) for the other four — the
 * action enforces it, this form only says so up front.
 */
export function AddValueForm({ type, typeLabel, codeRequired }: { type: string; typeLabel: string; codeRequired: boolean }) {
  const [state, action, pending] = useActionState(addValue, INITIAL)

  return (
    <form action={action} className="space-y-2 rounded-xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="type" value={type} />
      <p className="text-sm font-medium text-stone-700">Add a {typeLabel.toLowerCase()}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-stone-500">
          Name
          <Input name="value" required maxLength={120} placeholder="e.g. Temple Border" className="mt-1 w-56" disabled={pending} />
        </label>
        <label className="text-xs text-stone-500">
          Code{codeRequired ? ' (goes into the SKU)' : ' (optional)'}
          <Input
            name="code"
            required={codeRequired}
            maxLength={16}
            pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,15}"
            placeholder={codeRequired ? 'e.g. BRHM' : 'derived if blank'}
            className="mt-1 w-40 font-mono uppercase"
            disabled={pending}
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {state.status !== 'idle' && (
        <p className={state.status === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>{state.message}</p>
      )}
    </form>
  )
}
