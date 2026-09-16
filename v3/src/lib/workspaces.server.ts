import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { SessionUser } from '@/lib/auth/session'
import {
  activeWorkspace,
  homeFor,
  resolveWorkspaces,
  type Workspace,
  type WorkspaceRow,
} from '@/lib/workspaces'

/**
 * Resolving the workspace for a request.
 *
 * The cookie holds the workspace someone switched to during this session; their
 * saved default is what a fresh browser gets. The cookie carries no authority —
 * `resolveWorkspaces()` only ever returns workspaces built from sections this
 * role may reach, so a forged value selects nothing that is not already allowed,
 * and an unknown value falls through to the default.
 *
 * Read once per request: the layout needs the navigation and several pages want
 * the same answer, and `cache()` makes that one query rather than four.
 */
export const WORKSPACE_COOKIE = 'nerige_workspace'

export interface WorkspaceContext {
  workspaces: Workspace[]
  active: Workspace | null
  home: string
}

export const getWorkspaceContext = cache(async (user: SessionUser): Promise<WorkspaceContext> => {
  // A weaver has one job and no switcher; asking the database would be a query
  // per request to arrive at an empty list.
  if (user.role === 'vendor' || user.role === 'developer') {
    return { workspaces: [], active: null, home: user.role === 'vendor' ? '/portal' : '/dev' }
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('user_workspaces')
    .select('key, name, sections, hidden, is_default, sort')
    .eq('user_id', user.id)
    .order('sort')

  const workspaces = resolveWorkspaces(user.role, (data ?? []) as WorkspaceRow[])
  const requested = (await cookies()).get(WORKSPACE_COOKIE)?.value ?? null
  const active = activeWorkspace(workspaces, requested)

  return { workspaces, active, home: active ? homeFor(active) : '/dashboard' }
})
