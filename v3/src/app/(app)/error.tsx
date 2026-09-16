'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * What a person sees when a screen fails.
 *
 * Without this file Next.js renders its own page: a hash, a stack trace in
 * development, and in production the words "Application error: a client-side
 * exception has occurred". None of that tells a warehouse manager whether to
 * try again, ring somebody, or carry on with the work by hand.
 *
 * So: what happened, what it means for the work, and the two things worth
 * doing. No apology and no blame — the screen failed, the person did not.
 *
 * The loaders behind these screens throw rather than return zeros precisely so
 * that this page appears instead of a confident, wrong number. That is the
 * trade this file pays for.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The server's own log holds the stack; this is what ties a person's report
    // ("it broke at about four") to the line that failed.
    console.error('[screen failed]', error.digest ?? '', error.message)
  }, [error])

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded-xl border border-stone-200 p-6">
        <h1 className="text-lg font-medium text-stone-900">This screen did not load</h1>
        <p className="mt-2 text-sm text-stone-600">
          Nothing was lost and nothing was changed. The last thing you saved is saved.
        </p>
        <p className="mt-2 text-sm text-stone-600">
          Try it again. If it fails a second time, the sync or the database is likely down — carry on
          with the work and tell whoever runs this system.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50"
          >
            Back to my home screen
          </Link>
        </div>

        {error.digest && (
          <p className="mt-4 font-mono text-xs text-stone-500">Reference {error.digest}</p>
        )}
      </div>
    </div>
  )
}
