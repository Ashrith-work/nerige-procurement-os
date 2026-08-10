'use client'

import { useActionState, useState } from 'react'
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n'
import { parseYouTubeUrl, youTubeEmbedUrl } from '@/lib/tutorial/youtube'
import { Button, Card, Field, Input, Select, Alert, Textarea } from '@/components/ui/primitives'
import { saveTutorial, removeTutorial, type TutorialState } from './tutorial-actions'

export interface TutorialRow {
  id: string
  locale: string
  youtube_url: string
  title: string
  caption: string | null
}

const IDLE: TutorialState = { status: 'idle' }

/**
 * Managing the film, one language at a time.
 *
 * The preview is the whole reason this is a client component. A pasted YouTube
 * link either plays or it does not, and the failure is silent everywhere else:
 * a private video renders as "Video unavailable" on a weaver's phone while
 * playing perfectly for the admin who owns it and is signed in to YouTube. So
 * the preview here is the embed a WEAVER gets, not a thumbnail — if it does not
 * play in this box it will not play for her.
 *
 * The warning about private videos is stated in words for the same reason. It
 * cannot be detected from a URL; YouTube only tells you by refusing to play.
 */
export function TutorialEditor({ videos }: { videos: TutorialRow[] }) {
  const [state, action, pending] = useActionState(saveTutorial, IDLE)
  const [locale, setLocale] = useState<Locale>('en')
  const [url, setUrl] = useState('')

  const existing = videos.find((v) => v.locale === locale)
  const preview = parseYouTubeUrl(url || existing?.youtube_url || '')

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-stone-900">Tutorial video</h2>
        <p className="text-sm text-stone-500">
          Shown at the top of every vendor portal, above their orders. A weaver sees the video for
          her own language, or the English one if there is none.
        </p>
      </div>

      <Alert tone="info">
        Use an <strong>unlisted</strong> video, not a private one. Unlisted plays for anyone with
        the link and is invisible on your channel. Private videos only play for YouTube accounts
        you have shared them with — a weaver is not signed in to YouTube here, so a private video
        shows her “Video unavailable” while still playing perfectly for you.
      </Alert>

      {state.status === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.status === 'saved' && <Alert tone="success">Saved.</Alert>}

      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Language" required>
            <Select
              name="locale"
              value={locale}
              onChange={(e) => {
                setLocale(e.target.value as Locale)
                setUrl('')
              }}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                  {videos.some((v) => v.locale === l) ? ' — has a video' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Title" required hint="Shown above the player.">
            <Input name="title" required defaultValue={existing?.title ?? ''} key={`t-${locale}`} />
          </Field>
        </div>

        <Field
          label="YouTube link"
          required
          hint="Any YouTube address — watch, youtu.be, embed or shorts."
        >
          <Input
            name="youtube_url"
            required
            value={url || existing?.youtube_url || ''}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </Field>

        <Field label="Caption" hint="One line under the title. Optional.">
          <Textarea name="caption" rows={2} defaultValue={existing?.caption ?? ''} key={`c-${locale}`} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : existing ? 'Replace video' : 'Save video'}
          </Button>

          {existing && (
            <Button
              type="submit"
              variant="secondary"
              formAction={removeTutorial}
              name="id"
              value={existing.id}
            >
              Remove
            </Button>
          )}
        </div>
      </form>

      {preview && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-stone-700">
            What a weaver sees — if it does not play here, it will not play for her
          </p>
          <div className="overflow-hidden rounded-lg bg-black">
            <iframe
              src={youTubeEmbedUrl(preview)}
              title="Preview"
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </Card>
  )
}
