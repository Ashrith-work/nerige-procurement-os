import 'server-only'
import { randomInt } from 'node:crypto'

/**
 * The password a weaver is given.
 *
 * Read aloud down a phone line, in a noisy room, by someone reading Latin
 * script as a second script. That constraint decides the alphabet: no `O` or
 * `0`, no `l`, `I` or `1`, no `5` or `S`, no punctuation at all. Every
 * character that survives is unambiguous when spoken and unambiguous when
 * typed on an Android keyboard that autocapitalises.
 *
 * Grouped in fours with hyphens for the same reason — `hxrm-4kqt-vwn9` is
 * something a person can hold in their head between hearing it and typing it,
 * and can find their place in again after being interrupted.
 *
 * Twelve characters from a 28-symbol alphabet is about 57 bits. Against a
 * remote login with no reset flow and no enumeration, that is far past the
 * point where guessing is the weak link.
 *
 * `randomInt` rather than `Math.random()`: this is a credential, and it uses
 * rejection sampling internally so the distribution is uniform rather than
 * modulo-biased.
 */
const ALPHABET = 'abcdefghjkmnpqrtuvwxyz2346789'

const GROUPS = 3
const GROUP_SIZE = 4

export function generatePassword(): string {
  const groups: string[] = []

  for (let g = 0; g < GROUPS; g++) {
    let group = ''
    for (let i = 0; i < GROUP_SIZE; i++) {
      group += ALPHABET[randomInt(ALPHABET.length)]
    }
    groups.push(group)
  }

  return groups.join('-')
}
