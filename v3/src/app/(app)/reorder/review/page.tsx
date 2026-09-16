import { requireProcurement } from '@/lib/auth/session'
import { PageHeader } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { runningFlow, withFlow } from '@/components/flow/flows'
import { Review } from './review'

export const metadata = { title: 'Review · Nerige' }

export default async function ReviewPage({
  searchParams,
}: {
  /**
   * `flow=order` while the ordering flow is running, and nothing else. Without
   * it this screen is unchanged: the same review, the same send.
   */
  searchParams: Promise<{ flow?: string }>
}) {
  await requireProcurement()
  const { flow: flowParam } = await searchParams
  const flow = runningFlow(flowParam, 'order')

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {flow && (
        <FlowStepper
          flow="order"
          current={3}
          hrefs={{
            weaver: '/flows/order',
            designs: withFlow('/reorder', 'order'),
            sent: '/flows/order/sent',
          }}
          note="Set how many of each, then send at the bottom of the screen. Step 4 shows what went out."
        />
      )}

      <PageHeader
        title="Before you send"
        subtitle="Ask for more of anything, and for new designs like it, then confirm."
      />
      <Review />
    </div>
  )
}
