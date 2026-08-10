/**
 * Pulling a video ID out of whatever the admin pasted.
 *
 * YouTube hands out at least six shapes of link depending on which button you
 * pressed, and the admin will paste whichever one the browser gave her — not a
 * canonical one, because nothing in YouTube's interface offers a canonical one.
 * So this accepts all of them rather than asking her to reformat a URL:
 *
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   https://www.youtube.com/embed/ID
 *   https://www.youtube.com/shorts/ID
 *   https://www.youtube.com/live/ID
 *   https://m.youtube.com/watch?v=ID&t=42s
 *   ID                                    (pasted bare)
 *
 * `t` is carried through when present, because a Nerige team member who links
 * to 1:30 of a longer film meant it.
 *
 * ON PRIVATE VIDEOS. An **unlisted** video plays here perfectly: it is
 * unlisted, not restricted, and anyone with the link — or with it embedded —
 * can watch. A **private** video cannot, and no parameter fixes that. YouTube
 * serves private video only to signed-in accounts on its share list, and a
 * weaver watching inside this portal is not signed in to YouTube at all. The
 * embed returns "Video unavailable" for her while playing perfectly for the
 * admin who owns it, which is the worst possible failure: it looks fine to the
 * person checking it. `isProbablyPrivate` cannot be answered from a URL, so the
 * admin screen states the rule and the portal renders a link out as a fallback.
 */

/** A YouTube video ID: 11 characters of URL-safe base64. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const PATH_PREFIXES = ['embed', 'shorts', 'live', 'v']

export interface ParsedVideo {
  id: string
  /** Seconds into the film to start at, when the pasted link carried one. */
  startSeconds: number | null
}

/** `90`, `1m30s`, `01:30` — YouTube writes all three. */
function parseStart(value: string | null): number | null {
  if (!value) return null

  if (/^\d+$/.test(value)) return Number(value)

  const hms = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0)
  }

  return null
}

export function parseYouTubeUrl(input: string | null | undefined): ParsedVideo | null {
  const raw = (input ?? '').trim()
  if (raw === '') return null

  // Pasted bare, which is what happens when someone copies from a spreadsheet.
  if (VIDEO_ID.test(raw)) return { id: raw, startSeconds: null }

  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)
  const start = parseStart(url.searchParams.get('t') ?? url.searchParams.get('start'))

  if (host === 'youtu.be') {
    const id = segments[0] ?? ''
    return VIDEO_ID.test(id) ? { id, startSeconds: start } : null
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null

  const fromQuery = url.searchParams.get('v')
  if (fromQuery && VIDEO_ID.test(fromQuery)) return { id: fromQuery, startSeconds: start }

  if (segments.length >= 2 && PATH_PREFIXES.includes(segments[0].toLowerCase())) {
    const id = segments[1]
    return VIDEO_ID.test(id) ? { id, startSeconds: start } : null
  }

  return null
}

/**
 * The src for the iframe.
 *
 * youtube-nocookie.com rather than youtube.com: a weaver opening her order
 * screen has not asked to be tracked across the web by an advertising network,
 * and the film plays identically from either host.
 *
 * `rel=0` keeps YouTube from ending the film on a wall of unrelated
 * recommendations, which on a portal that exists to explain one process is
 * actively confusing. `playsinline=1` is what stops iOS Safari taking the video
 * fullscreen the moment she presses play and losing her the page underneath.
 */
export function youTubeEmbedUrl(video: ParsedVideo): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  })
  if (video.startSeconds !== null) params.set('start', String(video.startSeconds))

  return `https://www.youtube-nocookie.com/embed/${video.id}?${params.toString()}`
}

/** Where to send her when the embed will not play. */
export function youTubeWatchUrl(video: ParsedVideo): string {
  const params = new URLSearchParams({ v: video.id })
  if (video.startSeconds !== null) params.set('t', String(video.startSeconds))

  return `https://www.youtube.com/watch?${params.toString()}`
}
