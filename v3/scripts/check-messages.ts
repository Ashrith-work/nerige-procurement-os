/**
 * `npm run i18n:check` — every locale file carries every English key.
 *
 * This runs before `npm run build`, so a phase that adds a string to en.json
 * and forgets the other four does not deploy. The failure a weaver would
 * otherwise get is the worst kind: a screen that is 90% her language with one
 * English sentence in the middle of it, on the step where she is least sure
 * what to do.
 *
 * It checks three things, and the second and third are the ones that bite:
 *
 *   1. Missing keys — in en.json, absent elsewhere.
 *   2. Extra keys — absent from en.json. Almost always a typo in a key name,
 *      which reads as a missing translation at runtime and as nothing at all
 *      here unless it is checked for.
 *   3. Placeholder drift — `{n}` present in English and dropped in Hindi means
 *      a quantity vanishes from the sentence. The message still renders, which
 *      is exactly why nobody notices.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const MESSAGES_DIR = join(HERE, '..', 'messages')

const REFERENCE = 'en'
const TRANSLATIONS = ['kn', 'ta', 'te', 'hi']

type Messages = Record<string, Record<string, string>>

/** "order.noCode" — section and key, which is as deep as these files go. */
function flatten(messages: Messages): Map<string, string> {
  const out = new Map<string, string>()

  for (const [section, entries] of Object.entries(messages)) {
    if (entries === null || typeof entries !== 'object') {
      throw new Error(`Section "${section}" is not an object of strings.`)
    }
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'string') {
        throw new Error(`"${section}.${key}" is not a string.`)
      }
      out.set(`${section}.${key}`, value)
    }
  }

  return out
}

function placeholders(message: string): Set<string> {
  return new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
}

async function load(locale: string): Promise<Map<string, string>> {
  const path = join(MESSAGES_DIR, `${locale}.json`)
  try {
    return flatten(JSON.parse(await readFile(path, 'utf8')) as Messages)
  } catch (err) {
    throw new Error(`${locale}.json — ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main() {
  const english = await load(REFERENCE)
  const problems: string[] = []

  console.log(`${REFERENCE}.json — ${english.size} keys\n`)

  for (const locale of TRANSLATIONS) {
    const translated = await load(locale)
    const missing: string[] = []
    const extra: string[] = []
    const drifted: string[] = []

    for (const [key, source] of english) {
      const value = translated.get(key)
      if (value === undefined) {
        missing.push(key)
        continue
      }

      const want = placeholders(source)
      const got = placeholders(value)
      const lost = [...want].filter((p) => !got.has(p))
      const gained = [...got].filter((p) => !want.has(p))
      if (lost.length || gained.length) {
        drifted.push(
          `${key} — ${lost.length ? `dropped {${lost.join('}, {')}}` : ''}` +
            `${lost.length && gained.length ? '; ' : ''}` +
            `${gained.length ? `invented {${gained.join('}, {')}}` : ''}`,
        )
      }
    }

    for (const key of translated.keys()) {
      if (!english.has(key)) extra.push(key)
    }

    const bad = missing.length + extra.length + drifted.length

    if (bad === 0) {
      console.log(`  ${locale}.json  complete — ${translated.size} keys`)
      continue
    }

    console.log(`  ${locale}.json  ${bad} problem(s)`)
    for (const key of missing) console.log(`      missing      ${key}`)
    for (const key of extra) console.log(`      not in en    ${key}`)
    for (const note of drifted) console.log(`      placeholder  ${note}`)

    problems.push(`${locale}.json: ${missing.length} missing, ${extra.length} extra, ${drifted.length} placeholder`)
  }

  if (problems.length > 0) {
    console.error(`\nEvery user-facing string belongs in all five locale files in the same commit.`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  console.log('\nAll five locale files agree.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
