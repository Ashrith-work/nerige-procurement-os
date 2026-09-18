import { requireStaff } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Button, Card, Input, PageHeader } from '@/components/ui/primitives'
import {
  availableSections,
  resolveWorkspaces,
  type WorkspaceRow,
} from '@/lib/workspaces'
import { deleteWorkspace, makeDefault, renameWorkspace, saveWorkspace, setHidden } from './actions'

export const metadata = { title: 'Workspaces' }

/**
 * Managing your own workspaces.
 *
 * Deliberately yours alone: nobody else can read this, not even the owner. How a
 * person arranges their working day decides nothing about the business.
 *
 * A built-in can be renamed or hidden but not deleted, because it is not a row —
 * it is a template in code that a later version may improve, and somebody who
 * deleted it would never receive that. Hiding is the reversible form of the same
 * wish.
 */
export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>
}) {
  const user = await requireStaff()
  const params = await searchParams
  const supabase = await createClient()

  const { data } = await supabase
    .from('user_workspaces')
    .select('key, name, sections, hidden, is_default, sort')
    .eq('user_id', user.id)
    .order('sort')

  const rows = (data ?? []) as WorkspaceRow[]
  const workspaces = resolveWorkspaces(user.role, rows)
  const hidden = workspaces.length === 0 ? [] : rows.filter((r) => r.hidden)
  const sections = availableSections(user.role)

  const editingKey = params.edit ?? null
  const editing = editingKey ? workspaces.find((w) => w.key === editingKey) : null
  const building = params.new === '1' || Boolean(editing)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Workspaces"
        subtitle="One for each job you do. The switcher at the top right changes which one you are in; the one marked “opens first” is where signing in lands."
      />

      <ul className="space-y-3">
        {workspaces.map((w) => (
          <li key={w.key}>
            <Card className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">
                    {w.name}
                    {w.isDefault && (
                      <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-600">
                        opens first
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-stone-500">{w.blurb}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {!w.isDefault && (
                    <form action={makeDefault}>
                      <input type="hidden" name="key" value={w.key} />
                      <Button type="submit" variant="secondary">
                        Open this one first
                      </Button>
                    </form>
                  )}
                  {w.custom ? (
                    <>
                      <a
                        href={`/profiles?edit=${encodeURIComponent(w.key)}`}
                        className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50"
                      >
                        Change
                      </a>
                      <form action={deleteWorkspace}>
                        <input type="hidden" name="key" value={w.key} />
                        <Button type="submit" variant="ghost">
                          Remove
                        </Button>
                      </form>
                    </>
                  ) : (
                    <form action={setHidden}>
                      <input type="hidden" name="key" value={w.key} />
                      <input type="hidden" name="hidden" value="1" />
                      <Button type="submit" variant="ghost">
                        Hide
                      </Button>
                    </form>
                  )}
                </div>
              </div>

              <p className="text-sm text-stone-600">{w.sections.map((s) => s.label).join(' · ')}</p>

              {!w.custom && (
                <form action={renameWorkspace} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="key" value={w.key} />
                  <label className="text-xs text-stone-500" htmlFor={`name-${w.key}`}>
                    Call it
                  </label>
                  <Input
                    id={`name-${w.key}`}
                    name="name"
                    defaultValue={w.name}
                    maxLength={40}
                    className="w-auto min-w-48 flex-1"
                  />
                  <Button type="submit" variant="secondary">
                    Rename
                  </Button>
                </form>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {hidden.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-stone-700">Hidden</p>
          <ul className="flex flex-wrap gap-2">
            {hidden.map((row) => (
              <li key={row.key}>
                <form action={setHidden}>
                  <input type="hidden" name="key" value={row.key} />
                  <input type="hidden" name="hidden" value="0" />
                  <Button type="submit" variant="secondary">
                    Bring back {row.name ?? row.key}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {building ? (
        <Card className="space-y-4">
          <div>
            <h2 className="font-medium text-stone-900">
              {editing ? `Change ${editing.name}` : 'A workspace of your own'}
            </h2>
            <p className="text-sm text-stone-500">
              Name the job, then tick what you want in front of you. The first one ticked is where it opens.
            </p>
          </div>

          <form action={saveWorkspace} className="space-y-4">
            {editing && <input type="hidden" name="key" value={editing.key} />}

            <div className="space-y-1">
              <label className="text-sm font-medium text-stone-700" htmlFor="workspace-name">
                Call it
              </label>
              <Input
                id="workspace-name"
                name="name"
                defaultValue={editing?.name ?? ''}
                placeholder="Friday paperwork"
                maxLength={40}
                required
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-stone-700">What goes in it</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {sections.map((s) => (
                  <label
                    key={s.key}
                    className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-stone-200 p-3 hover:bg-stone-50"
                  >
                    <input
                      type="checkbox"
                      name="sections"
                      value={s.key}
                      defaultChecked={editing?.sections.some((chosen) => chosen.key === s.key) ?? false}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm text-stone-900">{s.label}</span>
                      <span className="block text-xs text-stone-500">{s.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2">
              <Button type="submit">{editing ? 'Save changes' : 'Add this workspace'}</Button>
              <a
                href="/profiles"
                className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </a>
            </div>
          </form>
        </Card>
      ) : (
        <a
          href="/profiles?new=1"
          className="inline-flex min-h-11 items-center rounded-lg border border-dashed border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          Add a workspace of your own
        </a>
      )}
    </div>
  )
}
