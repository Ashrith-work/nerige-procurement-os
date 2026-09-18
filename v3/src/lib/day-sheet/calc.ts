/**
 * The warehouse day sheet's arithmetic.
 *
 * Pure, and imports nothing but a type: the unit tests load this file directly,
 * and the movement grid runs every function here in the browser on each tick,
 * so the figures under the boxes move as the manager works rather than after a
 * round trip to Postgres.
 *
 * The notebook page (IMG20260918124032) is the specification. It asks three
 * questions of one movement, and this file answers all three from the same set
 * of rows:
 *
 *   1. which sarees did not come back,
 *   2. which of those were sold at the counter ("offline"), and
 *   3. what is left over — the overall difference, still to explain.
 *
 * The third is the only one that needs a person: a reason and a name. The other
 * two are bookkeeping and are derived, never typed.
 */

import type { AppRole } from '@/lib/auth/session'

// ---------------------------------------------------------------------------
// The movements
// ---------------------------------------------------------------------------

/** Must stay in step with the `day_movement` enum — migration 039. */
export type MovementKind = 'cec' | 'ai_colour' | 'video_call'

export interface MovementDefinition {
  kind: MovementKind
  /** The heading, in the manager's own words off the notebook page. */
  label: string
  /** The label over the first box. */
  outLabel: string
  /** The label over the second box. */
  backLabel: string
}

/**
 * The three movements, in the order the notebook lists them.
 *
 * `ai_colour` is the AI colour change: sarees taken off the floor to be
 * recoloured. The notebook page reads "AE change", which was a mishearing —
 * from the enum. If it should read differently it is renamed here and in the
 * migration together — the strings below are the whole of the screen's
 * vocabulary for these three sections.
 */
export const MOVEMENTS: readonly MovementDefinition[] = [
  {
    kind: 'cec',
    label: 'CEC',
    outLabel: 'Went out of the warehouse to the CEC',
    backLabel: 'Came back to the warehouse from the CEC',
  },
  {
    kind: 'ai_colour',
    label: 'AI colour change',
    outLabel: 'Went out for an AI colour change',
    backLabel: 'Came back after the colour change',
  },
  {
    kind: 'video_call',
    label: 'Video call',
    outLabel: 'Went out of the warehouse for a video call',
    backLabel: 'Came back to the warehouse after a video call',
  },
]

export function movementLabel(kind: MovementKind): string {
  return MOVEMENTS.find((m) => m.kind === kind)?.label ?? kind
}

/**
 * Where each movement's two totals live on `warehouse_days`.
 *
 * Kept as data rather than written out three times in the loader and three
 * times again in the action: a fourth movement is then a line in `MOVEMENTS`, a
 * line here and two columns, and nothing else changes.
 */
export const TOTAL_COLUMNS: Record<MovementKind, { out: string; back: string }> = {
  cec: { out: 'cec_out', back: 'cec_back' },
  ai_colour: { out: 'ai_out', back: 'ai_back' },
  video_call: { out: 'video_out', back: 'video_back' },
}

/**
 * The reasons already written on the notebook page, offered as suggestions.
 *
 * A suggestion list, not a closed set — the field stays free text. These two
 * are the ones the manager has actually written; the list grows from use rather
 * than from a guess about what else might go wrong.
 */
export const COMMON_REASONS: readonly string[] = ['Missing', 'Not scanned and sent to CEC']

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/** One row of `warehouse_days`, as the screen holds it. */
export interface DayTotals {
  /** What the manager counted going out, per movement. */
  out: Record<MovementKind, number>
  /** What the manager counted coming back, per movement. */
  back: Record<MovementKind, number>
  /**
   * Orders that began as a video call rather than on the website. The one order
   * figure nothing else records — see the ORDERS section, which is otherwise
   * entirely read.
   */
  videoOrders: number
  note: string
}

export function emptyTotals(): DayTotals {
  return {
    out: { cec: 0, ai_colour: 0, video_call: 0 },
    back: { cec: 0, ai_colour: 0, video_call: 0 },
    videoOrders: 0,
    note: '',
  }
}

/** One row of `warehouse_movements`: one saree, one day, one movement. */
export interface MovementRow {
  id: string
  kind: MovementKind
  sku: string
  wentOut: boolean
  cameBack: boolean
  soldOffline: boolean
  billNo: string
  reason: string
  who: string
  /**
   * Whether the catalogue knows this code. `null` means the check itself did
   * not run — which is not the same as "not in the catalogue" and must not be
   * shown as one.
   */
  known: boolean | null
}

/** The notebook's three lists, all read off the same rows. */
export interface MovementSplit {
  /** Written down as having gone out and not ticked back in. */
  notBack: MovementRow[]
  /** Of those, the ones sold at the counter. The notebook's "offline" list. */
  soldOffline: MovementRow[]
  /** The rest of `notBack`: the overall difference, still to explain. */
  unexplained: MovementRow[]
  /** Rows in `unexplained` with nothing written against them yet. */
  unanswered: MovementRow[]
}

export interface MovementFigures {
  /** The counted total out, as typed into the first box. */
  out: number
  /** The counted total back, as typed into the second box. */
  back: number
  /** The third box: out − back. Negative when more came back than went out. */
  difference: number
  /** How many of the difference the counter explains. */
  offlineSold: number
  /** The notebook's "find overall diff": difference − offline sold. */
  stillToExplain: number
  /**
   * Sarees inside the difference with no line written down for them. Positive
   * means the counts and the list disagree and the list is short; negative
   * means more lines than the count allows, which is a miscount in one box or
   * a saree ticked back in twice.
   */
  unlisted: number
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

/**
 * A row still waiting on a person.
 *
 * Deliberately only the reason: the notebook asks "why and who", and the why is
 * the answer — a name with no reason against it explains nothing, while a
 * reason with no name is still an account of where the saree went. Requiring
 * both would keep the row amber after the manager had in fact answered it.
 */
export function needsAnswer(row: MovementRow): boolean {
  return row.wentOut && !row.cameBack && !row.soldOffline && row.reason.trim() === ''
}

/** The notebook's three lists, in the order the sarees were written down. */
export function splitMovements(rows: readonly MovementRow[]): MovementSplit {
  const notBack = rows.filter((r) => r.wentOut && !r.cameBack)
  const soldOffline = notBack.filter((r) => r.soldOffline)
  const unexplained = notBack.filter((r) => !r.soldOffline)
  return { notBack, soldOffline, unexplained, unanswered: unexplained.filter(needsAnswer) }
}

/**
 * The three boxes and everything under them.
 *
 * The difference comes from the COUNTED totals, not from the rows: the manager
 * counts a stack at the door and writes the codes down afterwards, so the two
 * disagree for most of the day and the gap between them is itself information —
 * `unlisted` is "you have five to write down still".
 */
export function movementFigures(out: number, back: number, split: MovementSplit): MovementFigures {
  const difference = out - back
  const offlineSold = split.soldOffline.length
  return {
    out,
    back,
    difference,
    offlineSold,
    stillToExplain: difference - offlineSold,
    unlisted: difference - split.notBack.length,
  }
}

/** Whether this movement has nothing left outstanding on it. */
export function movementIsSettled(figures: MovementFigures, split: MovementSplit): boolean {
  return figures.stillToExplain === 0 && figures.unlisted === 0 && split.unanswered.length === 0
}

/**
 * A minus sign, not a hyphen.
 *
 * These numbers sit in a column of tabular figures next to each other, and a
 * hyphen is half the height and a third of the width of the digits beside it.
 */
export function formatSigned(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n)
}

/**
 * A code as it is stored.
 *
 * Trimmed, and inner runs of whitespace collapsed to one space — SKUs contain
 * spaces here ("DMG - 157"), so they cannot simply be stripped. Case is left
 * exactly as typed: the unique constraint is on the text, and quietly
 * upper-casing a code would store something the person did not write and flag
 * a perfectly good lower-case SKU as unknown.
 */
export function normaliseSku(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * Several codes out of one paste.
 *
 * A manager with the codes already in a spreadsheet pastes a column, and a
 * column arrives as newline-separated text. Commas and tabs are split on for
 * the same reason. Duplicates within the paste are dropped — the same saree
 * twice in one paste is a copy, not a second journey.
 */
export function splitPastedSkus(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[\r\n\t,;]+/)) {
    const sku = normaliseSku(part)
    if (sku === '' || seen.has(sku)) continue
    seen.add(sku)
    out.push(sku)
  }
  return out
}

// ---------------------------------------------------------------------------
// Who may write it
// ---------------------------------------------------------------------------

/**
 * The application-side twin of `app.can_record_day()` — migration 039.
 *
 * Takes a role rather than a session so this file stays importable by the
 * tests and by the client grid. The database is the enforcement; this decides
 * whether a control is rendered at all, because a disabled field the manager
 * can see is clearer than one that refuses on save.
 */
export function canRecordDay(role: AppRole): boolean {
  return role === 'admin' || role === 'warehouse_manager'
}

// ---------------------------------------------------------------------------
// The orders half — read, never typed
// ---------------------------------------------------------------------------

/** What `public.warehouse_day_orders(date)` answers. Counts only. */
export interface DayOrders {
  ordersReceived: number
  domestic: number
  international: number
  sareeOnly: number
  serviceOrders: number
  stitchedOrders: number
  offlineOrders: number
  canShipToday: number
  dispatched: number
  stillToGo: number
  openTillDate: number
  oldestOpen: string | null
  /** False where the dispatch board is not on this database. Never shown as 0. */
  boardConnected: boolean
}

export type OrderFigureKey = Exclude<keyof DayOrders, 'oldestOpen' | 'boardConnected'>

/**
 * How the orders section reads, grouped by the question each group answers.
 *
 * Every one of these is counted from the dispatch board. None of them has an
 * input beside it, and that absence is the whole point of the screen: the
 * spreadsheet it replaces asked a person to count what the database already
 * knew, which is how a day sheet ends up filled in at six o'clock from memory.
 */
export const ORDER_GROUPS: readonly { title: string; figures: readonly { key: OrderFigureKey; label: string }[] }[] = [
  {
    title: 'Came in today',
    figures: [
      { key: 'ordersReceived', label: 'Orders received' },
      { key: 'domestic', label: 'Domestic' },
      { key: 'international', label: 'International' },
      { key: 'offlineOrders', label: 'Offline' },
    ],
  },
  {
    title: 'What they were for',
    figures: [
      { key: 'sareeOnly', label: 'Saree only' },
      { key: 'serviceOrders', label: 'Service' },
      { key: 'stitchedOrders', label: 'Stitched' },
    ],
  },
  {
    title: 'Went out today',
    figures: [
      { key: 'canShipToday', label: 'Could ship today' },
      { key: 'dispatched', label: 'Dispatched' },
      { key: 'stillToGo', label: 'Still to go' },
    ],
  },
  {
    title: 'Still open',
    figures: [{ key: 'openTillDate', label: 'Open up to this day' }],
  },
]
