/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled from npm because the seed files need exactly
 * one thing a naive `split(',')` cannot do: honour quoted fields. Saree
 * descriptions are full of commas — "a dual shaded blue - purple border, and a
 * gold zari border with rudraksham motifs" — and splitting one of those in the
 * wrong place silently shifts every later column, which is the kind of bug that
 * shows up as a price in the image field three screens away.
 *
 * Handles quoted commas, quoted newlines, doubled quotes, CRLF and a BOM.
 */

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first
  // header name and every lookup of that column returns undefined.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
    } else if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
    } else if (ch === '\r') {
      i += 1
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
    } else {
      field += ch
      i += 1
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Parses to objects keyed by the header row. Blank lines are skipped. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim())

  return rows.slice(1).flatMap((cells) => {
    if (cells.length === 1 && cells[0].trim() === '') return []
    const record: Record<string, string> = {}
    header.forEach((name, idx) => {
      record[name] = cells[idx] ?? ''
    })
    return [record]
  })
}
