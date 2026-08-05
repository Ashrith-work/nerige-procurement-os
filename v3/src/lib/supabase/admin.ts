import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * Permitted uses — currently exactly one category:
 *   * provisioning auth.users when a vendor login or Pooja's account is
 *     created, because creating an auth user is not expressible under RLS
 *
 * Forbidden, without exception:
 *   * any code path that reads or writes data on behalf of a vendor
 *   * any query whose filter derives from user input
 *   * "just to make this query work" — that is a missing policy, not a
 *     permissions problem
 *
 * The seed loader does not use this module. It talks to Postgres directly as
 * the owner, from a script, precisely so that bulk loading never becomes an
 * application code path.
 *
 * `import 'server-only'` makes an accidental client-side import a build
 * failure rather than a credential leak. The key is also deliberately not
 * prefixed NEXT_PUBLIC_, so Next.js will not inline it into browser bundles.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Required for user provisioning only.')
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      // No session persistence: this client is per-operation and must never
      // adopt or leak a user's identity.
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
