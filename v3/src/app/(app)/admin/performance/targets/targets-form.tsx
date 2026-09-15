'use client'

import { useActionState } from 'react'
import { Button, Input } from '@/components/ui/primitives'
import type { StaffTask } from '@/lib/performance/calc'
import { addTask, updateTask, type TaskState } from './actions'

const IDLE: TaskState = { status: 'idle' }

/** One task, edited in place. Each row saves on its own; there are eight of them. */
export function TaskRow({ task }: { task: StaffTask }) {
  const [state, save, saving] = useActionState(updateTask, IDLE)

  return (
    <li className="px-4 py-3">
      <form action={save} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="code" value={task.code} />
        <label className="block min-w-36 flex-1">
          <span className="block text-xs text-stone-500">Label</span>
          <Input name="label" defaultValue={task.label} maxLength={40} required disabled={saving} />
        </label>
        <label className="block w-28">
          <span className="block text-xs text-stone-500">Target / day</span>
          <Input
            name="target_per_day"
            defaultValue={task.targetPerDay ?? ''}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="none"
            className="text-right tabular-nums"
            disabled={saving}
          />
        </label>
        <label className="block w-20">
          <span className="block text-xs text-stone-500">Order</span>
          <Input
            name="sort_order"
            defaultValue={task.sortOrder}
            inputMode="numeric"
            className="text-right tabular-nums"
            disabled={saving}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" name="active" defaultChecked={task.active} disabled={saving} className="size-5" />
          On sheet
        </label>
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {state.status !== 'idle' && (
        <p className={state.status === 'ok' ? 'mt-1 text-xs text-emerald-700' : 'mt-1 text-xs text-red-700'}>
          {state.message}
        </p>
      )}
    </li>
  )
}

export function AddTaskForm() {
  const [state, add, adding] = useActionState(addTask, IDLE)

  return (
    <>
      <form action={add} className="flex flex-wrap items-end gap-2">
        <label className="block min-w-44 flex-1">
          <span className="block text-xs text-stone-500">Label</span>
          <Input name="label" maxLength={40} required placeholder="e.g. Ironing" disabled={adding} />
        </label>
        <label className="block w-28">
          <span className="block text-xs text-stone-500">Target / day</span>
          <Input
            name="target_per_day"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="none"
            className="text-right"
            disabled={adding}
          />
        </label>
        <Button type="submit" disabled={adding}>
          {adding ? 'Adding…' : 'Add task'}
        </Button>
      </form>
      {state.status !== 'idle' && (
        <p className={state.status === 'ok' ? 'mt-2 text-sm text-emerald-700' : 'mt-2 text-sm text-red-700'}>
          {state.message}
        </p>
      )}
    </>
  )
}
