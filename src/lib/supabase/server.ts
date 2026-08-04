import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers.
 *
 * Uses the ANON key, so every query this client makes is subject to Row Level
 * Security. That is deliberate and load-bearing: the database enforces vendor
 * isolation even if a query in this application forgets a `WHERE vendor_id`
 * clause. Application-layer filtering is a convenience; RLS is the guarantee.
 *
 * Never swap this for the service-role client to "fix" a query returning no
 * rows. An empty result under RLS means either the user genuinely lacks access
 * or a policy is missing — both are answered in SQL, not by escalating.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Server Components cannot set cookies. Harmless here: proxy.ts
            // refreshes the session on every request, so the rotated token is
            // persisted there instead.
          }
        },
      },
    },
  )
}
