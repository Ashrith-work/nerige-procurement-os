import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/primitives'
import { DashboardSection, SectionError, Tile, TileGrid, settle, toneWhen } from '@/components/dashboard/tile'
import { DashboardStrip } from '@/components/dashboard/strip'
import { Pipeline } from '@/components/dashboard/pipeline'
import { loadOrderPipeline, type PipelineStage } from '@/lib/dashboards/pipeline'
import { loadIntakeCounts } from '@/lib/intake/summary'
import { loadInwardCounts } from '@/lib/inwarding/summary'

export const metadata = { title: 'In progress' }

/**
 * In progress: what is in flight, and whose turn it is.
 *
 * The middle of the three dashboards, and the one with the least right to a
 * number that grades anybody. An order sitting eleven days with a weaver is a
 * fact about an order — where it is, and who moves it next. How often that
 * weaver is late is a different question, asked deliberately, on `/numbers`.
 *
 * Read top to bottom it is one journey: an order goes out to a weaver and comes
 * back as a parcel; a saree arrives at the bench and goes out as a listing. The
 * two halves are the two things this business has in flight at any moment, and
 * nothing else belongs on the screen.
 *
 * ROLES SEE THE PARTS THEY CAN OPEN. The warehouse manager may read every order
 * — migration 036 gives the receiving bench that — but the order screen itself
 * is procurement's, so their first two stages are plain cards rather than links
 * into a refusal, and their sarees are their own submissions rather than
 * everybody's.
 */
export default async function WorkPage() {
  const user = await requireRole('admin', 'procurement_head', 'warehouse_manager')
  const supabase = await createClient()

  const internal = user.role === 'admin' || user.role === 'procurement_head'
  const mineOnly = user.role === 'warehouse_manager'

  const [pipeline, intake, inward] = await Promise.all([
    settle(() => loadOrderPipeline(supabase)),
    settle(() => loadIntakeCounts(supabase, mineOnly ? { submittedBy: user.id } : {})),
    settle(() => loadInwardCounts(supabase)),
  ])

  // Where each stage goes for this person. Null means "no destination you may
  // open", and the pipeline renders that stage as a card instead of a link.
  const stageHref = (stage: PipelineStage): string | null => {
    if (internal) return '/orders'
    return stage.key === 'dispatched' || stage.key === 'received' ? '/warehouse/inward' : null
  }

  const orderHref = (stage: PipelineStage): string | null => {
    if (!stage.mark) return null
    if (internal) return `/orders/${stage.mark.order.id}`
    return stage.key === 'dispatched' ? `/warehouse/inward/${stage.mark.order.id}` : null
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DashboardStrip current="work" role={user.role} />

      <PageHeader
        title="In progress"
        subtitle="Everything in flight, and whose turn it is next."
      />

      <DashboardSection title="Orders with weavers">
        {pipeline.ok ? (
          <>
            <Pipeline stages={pipeline.value} hrefFor={stageHref} orderHrefFor={orderHref} />
            {!internal && (
              <p className="text-xs text-stone-500">
                The first two stages are procurement’s to chase. Yours start when a weaver dispatches.
              </p>
            )}
          </>
        ) : (
          <SectionError message={pipeline.error} />
        )}
      </DashboardSection>

      <DashboardSection title={mineOnly ? 'Sarees you are adding' : 'Sarees being added'}>
        {intake.ok ? (
          <TileGrid>
            <Tile
              href="/intake/queue?stage=draft"
              label="Drafts"
              value={intake.value.drafts}
              hint="Waiting for a saree word"
            />
            <Tile href="/intake/queue?stage=shoot" label="To shoot" value={intake.value.awaitingShoot} />
            <Tile
              href="/intake/queue?stage=upload"
              label="Shot, photos pending"
              value={intake.value.awaitingUpload}
            />
            <Tile
              href="/intake/queue?stage=review"
              label="Waiting for review"
              value={intake.value.awaitingReview}
              tone={toneWhen(intake.value.awaitingReview, 'waiting')}
            />
          </TileGrid>
        ) : (
          <SectionError message={intake.error} />
        )}
      </DashboardSection>

      <DashboardSection title="Parcels">
        {inward.ok ? (
          <TileGrid>
            <Tile
              href="/warehouse/inward"
              label="Expected"
              value={inward.value.expected}
              hint="Dispatched, no parcel opened yet"
              tone={toneWhen(inward.value.expected, 'waiting')}
            />
            <Tile
              href="/warehouse/inward"
              label="Part received"
              value={inward.value.partiallyReceived}
              hint="Pieces still owed"
              tone={toneWhen(inward.value.partiallyReceived, 'waiting')}
            />
            <Tile
              href="/warehouse/inward"
              label="Promised, not sent"
              value={inward.value.lateNotDispatched}
              hint="The date has passed"
              tone={toneWhen(inward.value.lateNotDispatched, 'bad')}
            />
          </TileGrid>
        ) : (
          <SectionError message={inward.error} />
        )}
      </DashboardSection>

      <p className="text-xs text-stone-500">
        Everything on this screen is typed by somebody here, so it is as current as the last person to touch it. The
        synced figures — stock and sales — are on Numbers, with the age of the sync beside them.
      </p>
    </div>
  )
}
