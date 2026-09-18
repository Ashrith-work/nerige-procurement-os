import Link from 'next/link'
import { requireStaffReview } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, PageHeader } from '@/components/ui/primitives'
import { loadTasks } from '@/lib/performance/summary'
import { AddTaskForm, TaskRow } from './targets-form'

export const metadata = { title: 'Staff targets' }

/**
 * The per-day targets the review measures against.
 *
 * A target is units in a FULL day spent on only that task. The review scales it
 * by attendance (half day = half) and, for people who split their day, adds
 * work across tasks in fractions of a day — so a target here should be what one
 * person does in a whole day of that task and nothing else, not a blended
 * number.
 *
 * Blank is a valid answer and the default for every task but picking. A task
 * with no target shows its count and no percentage, which is better than a
 * percentage against a number nobody agreed.
 */
export default async function StaffTargetsPage() {
  await requireStaffReview()
  const supabase = await createClient()
  const tasks = await loadTasks(supabase, { includeInactive: true })

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/admin/performance"
        className="inline-flex min-h-11 items-center text-sm text-stone-600 hover:underline"
      >
        Staff performance
      </Link>
      <PageHeader
        title="Targets"
        subtitle="Units in one full working day of only this task. Leave blank if there is no agreed number."
      />

      <Card className="space-y-1 text-sm text-stone-600">
        <p>
          Picking starts at <strong>259</strong>: the reference rate of about 37 units an hour, times an assumed 7
          productive hours. Change it if the floor’s real working hours are different.
        </p>
        <p>Retiring a task takes it off the staff sheet; its past counts stay in the review.</p>
      </Card>

      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {tasks.map((t) => (
          <TaskRow key={t.code} task={t} />
        ))}
      </ul>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-stone-700">Add a task</h2>
        <AddTaskForm />
      </Card>
    </div>
  )
}
