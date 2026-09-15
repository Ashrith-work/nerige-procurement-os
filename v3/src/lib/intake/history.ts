import { isIntakeStatus, type IntakeStatus } from './status'

/**
 * Reads `product_intakes.status_history` (migration 035).
 *
 * The column is maintained by a trigger and should always be well-formed, but
 * it is jsonb, so a screen that trusted its shape would crash on the first row
 * an admin repaired by hand. Anything unrecognisable is dropped rather than
 * rendered as "undefined at Invalid Date".
 */
export interface HistoryEntry {
  status: IntakeStatus
  at: string
  by: string | null
  note: string | null
}

export function parseStatusHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: HistoryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (!isIntakeStatus(e.status) || typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) continue
    entries.push({
      status: e.status,
      at: e.at,
      by: typeof e.by === 'string' ? e.by : null,
      note: typeof e.note === 'string' && e.note.trim() !== '' ? e.note : null,
    })
  }
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
