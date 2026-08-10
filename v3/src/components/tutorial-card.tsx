import type { Dictionary } from '@/lib/i18n'
import { parseYouTubeUrl, youTubeEmbedUrl, youTubeWatchUrl } from '@/lib/tutorial/youtube'

export interface TutorialVideo {
  youtube_url: string
  title: string
  caption: string | null
}

/**
 * The card at the top of /portal, above her orders, on every visit.
 *
 * It is not dismissable, and that is the decision most likely to be argued
 * with. The reasoning: this portal replaces a phone call, and the weaver
 * opening it may have used it twice, three months apart, on a phone she shares.
 * A "don't show again" checkbox is pressed once by someone who has understood
 * nothing yet, and there is no second chance to explain the one step that
 * matters — that the code under the photograph goes onto the fabric.
 *
 * It is placed above the orders rather than below because a weaver who does not
 * yet know what to do will not scroll past the thing she came for to find the
 * explanation.
 *
 * The film plays inline. Sending her to YouTube to watch it means sending her
 * into an app that will recommend her something else and not bring her back.
 */
export function TutorialCard({ video, t }: { video: TutorialVideo | null; t: Dictionary }) {
  if (!video) return null

  const parsed = parseYouTubeUrl(video.youtube_url)

  const steps = [t.tutorial.step1, t.tutorial.step2, t.tutorial.step3, t.tutorial.step4, t.tutorial.step5]

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="space-y-0.5">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
          {t.tutorial.watch}
        </p>
        <h2 className="text-base font-medium text-stone-900">{video.title}</h2>
        {video.caption && <p className="text-sm text-stone-600">{video.caption}</p>}
      </div>

      {parsed ? (
        // 16:9, and the height follows the width rather than being fixed —
        // this sits on a 380px phone and on a laptop, and a letterboxed film
        // on either is a film nobody watches.
        <div className="overflow-hidden rounded-lg bg-black">
          <iframe
            src={youTubeEmbedUrl(parsed)}
            title={video.title}
            className="aspect-video w-full"
            // No `microphone`, no `camera`, no `geolocation`: a tutorial film
            // needs none of them, and an iframe gets what it is granted.
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <p className="rounded-lg bg-white px-3 py-2 text-sm text-stone-600">
          {t.tutorial.unavailable}
        </p>
      )}

      {parsed && (
        <a
          href={youTubeWatchUrl(parsed)}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-stone-500 underline underline-offset-2 hover:text-stone-900"
        >
          {t.tutorial.openOnYoutube}
        </a>
      )}

      {/* The film is the explanation; this is the version she can read at the
          loom with the sound off, which is where she actually is. */}
      <div className="space-y-1.5 pt-1">
        <p className="text-sm font-medium text-stone-900">{t.tutorial.stepsHeading}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700 marker:text-stone-400">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>
    </section>
  )
}
