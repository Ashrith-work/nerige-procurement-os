'use client'

import { useActionState } from 'react'
import Image from 'next/image'
import { Button, Input, cn } from '@/components/ui/primitives'
import { nameCode, setActive, setIgnored, type MasterDataState } from './actions'

export interface CodeExample {
  sku: string
  title: string | null
  imageUrl: string | null
}

export interface CodeRowData {
  type: string
  code: string
  value: string | null
  status: 'unnamed' | 'named' | 'ignored'
  active: boolean
  designCount: number
  examples: CodeExample[]
}

const INITIAL: MasterDataState = { status: 'idle' }

/**
 * One code: what it is called, how many designs carry it, three of those
 * designs, and what can be done to it.
 *
 * THE PHOTOGRAPHS ARE THE POINT, as in the holding pen. Nobody knows what `CRM`
 * means as a colour from the letters; they know it the moment they see three
 * sarees carrying it. So an unnamed code shows its examples, and naming is a
 * text box beside them.
 */
export function CodeRow({ row }: { row: CodeRowData }) {
  const [nameState, nameAction, naming] = useActionState(nameCode, INITIAL)
  const [ignoreState, ignoreAction, ignoring] = useActionState(setIgnored, INITIAL)
  const [activeState, activeAction, toggling] = useActionState(setActive, INITIAL)

  const busy = naming || ignoring || toggling
  const latest = [nameState, ignoreState, activeState].find((s) => s.status === 'error') ?? [nameState, ignoreState, activeState].find((s) => s.status === 'saved')

  const hidden = (
    <>
      <input type="hidden" name="type" value={row.type} />
      <input type="hidden" name="code" value={row.code} />
    </>
  )

  return (
    <li className={cn('space-y-3 border-b border-stone-200 py-4 last:border-b-0', !row.active && 'opacity-60')}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-lg font-semibold text-stone-900">{row.code}</span>
        {row.value && <span className="text-stone-800">{row.value}</span>}
        <span className="text-xs text-stone-500 tabular-nums">
          {row.designCount.toLocaleString('en-IN')} design{row.designCount === 1 ? '' : 's'}
        </span>
        {!row.active && <span className="rounded bg-stone-200 px-1.5 text-xs text-stone-700">retired</span>}
      </div>

      {row.examples.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {row.examples.map((e) => (
            <li key={e.sku} className="w-24">
              <div className="relative h-28 w-24 overflow-hidden rounded bg-stone-100">
                {e.imageUrl ? (
                  <Image src={e.imageUrl} alt={e.title ?? e.sku} fill sizes="96px" className="object-cover" unoptimized />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-stone-400">no photo</span>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-stone-500" title={e.title ?? e.sku}>
                {e.sku}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {row.status !== 'ignored' && (
          <form action={nameAction} className="flex flex-wrap items-center gap-2">
            {hidden}
            <Input
              name="value"
              defaultValue={row.value ?? ''}
              placeholder={row.status === 'unnamed' ? 'What does this code mean?' : 'Name'}
              maxLength={120}
              required
              className="w-56"
              disabled={busy}
            />
            <Button type="submit" disabled={busy}>
              {naming ? 'Saving…' : row.status === 'unnamed' ? 'Name it' : 'Rename'}
            </Button>
          </form>
        )}

        <form action={ignoreAction}>
          {hidden}
          <input type="hidden" name="ignore" value={row.status === 'ignored' ? 'false' : 'true'} />
          <input type="hidden" name="has_value" value={row.value ? 'true' : 'false'} />
          <Button type="submit" variant="ghost" disabled={busy}>
            {row.status === 'ignored' ? 'Stop ignoring' : 'Ignore'}
          </Button>
        </form>

        {row.status === 'named' && (
          <form action={activeAction}>
            {hidden}
            <input type="hidden" name="active" value={row.active ? 'false' : 'true'} />
            <Button type="submit" variant="ghost" disabled={busy}>
              {row.active ? 'Retire' : 'Restore'}
            </Button>
          </form>
        )}
      </div>

      {latest && (
        <p className={latest.status === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>{latest.message}</p>
      )}
    </li>
  )
}
