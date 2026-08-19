/**
 * The roles a stranger may ask for, in a plain module on purpose.
 *
 * This list used to live in `actions.ts`, and it built cleanly, passed
 * typecheck, and then answered 500 on the first request in production:
 *
 *   TypeError: h.map is not a function
 *
 * A `'use server'` file may export ONLY async functions. Every other export is
 * still rewritten into a server-action reference for the client bundle, so the
 * component imported a function stub where it expected an array — and nothing
 * before runtime says so, because the type is erased and the build has no
 * reason to look.
 *
 * So: constants shared between a server action and a client component belong in
 * a module that is neither.
 *
 * `admin` is deliberately absent. Approval is required for every role, so
 * asking for it would not be escalation in itself — but a dropdown offering
 * ownership of the whole system is one mis-click by one tired approver away
 * from giving it away. `request_signup` refuses it independently, in a CHECK
 * constraint rather than by typing the column as `app_role`, which would permit
 * the value to exist at all.
 */
export const REQUESTABLE_ROLES = [
  { value: 'vendor', label: 'Weaver — I make sarees for Nerige' },
  { value: 'warehouse_manager', label: 'Warehouse — I add new products' },
  { value: 'customer_support', label: 'Customer support — I look up orders' },
  { value: 'procurement_head', label: 'Procurement' },
] as const

export const REQUESTABLE_ROLE_VALUES: ReadonlySet<string> = new Set(
  REQUESTABLE_ROLES.map((r) => r.value),
)
