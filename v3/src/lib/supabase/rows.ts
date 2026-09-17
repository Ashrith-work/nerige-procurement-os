import 'server-only'

/**
 * Turning a PostgREST result into rows, and a failure into a failure.
 *
 * THE BUG THIS EXISTS TO STOP. `const rows = data ?? []` reads as harmless and
 * is not: when the query failed, `data` is null, `rows` is empty, and the screen
 * renders its empty state. `/orders` said "Nothing sent yet" — with a button
 * offering to start the first one — while the database was refusing the query.
 * That is not a missing number, it is a confident false statement about the
 * business, and the person who reads it acts on it.
 *
 * So the rule, matching every loader written since: the list a screen is ABOUT
 * throws, and `app/(app)/error.tsx` says the screen did not load. Silence is
 * only acceptable for a secondary read, where the screen can still do its job —
 * and those say what is missing rather than printing a zero.
 */

export interface PgResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface PgSingleResult<T> {
  data: T | null
  error: { message: string } | null
}

/**
 * The rows, or an exception naming what could not be read.
 *
 * `what` completes the sentence "Could not load …", so it is written in the
 * person's words — "the orders", not "orders table" — because it reaches the
 * screen and, in a support conversation, their mouth.
 */
export function rowsOrThrow<T>(result: PgResult<T>, what: string): T[] {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`)
  return result.data ?? []
}

/** The same, for a query that returns one row or none. A null row is not an error. */
export function rowOrThrow<T>(result: PgSingleResult<T>, what: string): T | null {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`)
  return result.data
}

/**
 * For a secondary read the screen can survive without: the rows, or null to say
 * "this part is missing" — never an empty array, which is indistinguishable
 * from "there are none of these".
 */
export function rowsOrNull<T>(result: PgResult<T>): T[] | null {
  return result.error ? null : (result.data ?? [])
}
