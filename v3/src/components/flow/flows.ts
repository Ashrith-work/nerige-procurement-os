/**
 * The three guided flows, as data.
 *
 * WHY THIS EXISTS. Ordering sarees, adding a saree and receiving a parcel each
 * take more than one screen, and until now each was a set of menu items whose
 * order you had to already know. A flow is the same screens with the sequence
 * made visible: on every step it says where you are, what the step wants, and
 * what happens next.
 *
 * Only genuinely sequential jobs are numbered — looking something up is not a
 * flow and never gets a progress bar.
 *
 * THE FLOW LIVES IN THE URL. A flow is running because `?flow=order` is on the
 * address, never because a component remembers. These people are interrupted
 * constantly: a tablet locks at the receiving bench, a phone rings at the
 * warehouse table. Leaving and coming back must lose nothing, so every screen
 * reconstructs the whole of its state from the URL and the database, and a
 * shared screen opened WITHOUT the parameter behaves exactly as it always did.
 */

export const FLOW_KEYS = ['order', 'new-saree', 'receive'] as const

export type FlowKey = (typeof FLOW_KEYS)[number]

export interface FlowStepDef {
  /** Stable name for this step, used to hand it a destination. */
  key: string
  /** The step, in the words the person would use. Two or three of them. */
  label: string
  /** What this step wants, in one sentence. */
  wants: string
  /** What happens after it. Empty on the last step, which has no after. */
  next: string
}

export interface FlowDef {
  key: FlowKey
  /** The job, in the user's words. The same name the workspace section uses. */
  name: string
  steps: readonly FlowStepDef[]
}

export const FLOWS: Record<FlowKey, FlowDef> = {
  order: {
    key: 'order',
    name: 'Order sarees',
    steps: [
      {
        key: 'weaver',
        label: 'Choose the weaver',
        wants: 'Pick the house you are ordering from. Ordering happens one weaver at a time.',
        next: 'Next: choose the designs.',
      },
      {
        key: 'designs',
        label: 'Choose designs',
        wants: 'Tap every saree you want made again. The bar at the bottom counts them as you go.',
        next: 'Next: say how many of each.',
      },
      {
        key: 'quantities',
        label: 'Say how many',
        wants:
          'Set how many pieces of each, and turn any of them into “make new like this” if you want a variation.',
        next: 'Next: send the order.',
      },
      {
        key: 'sent',
        label: 'Send',
        wants: 'Send the order. Each weaver gets her own, in her portal.',
        next: '',
      },
    ],
  },
  'new-saree': {
    key: 'new-saree',
    name: 'Add a saree',
    steps: [
      {
        key: 'details',
        label: 'Details',
        wants: 'Enter what is on the table. The code to write on the fabric appears when you save.',
        next: 'Next: write that code on the fabric.',
      },
      {
        key: 'code',
        label: 'Write the code on the fabric',
        wants: 'Copy this number onto the fabric by hand, then check it digit by digit.',
        next: 'Next: photograph the saree.',
      },
      {
        key: 'shoot',
        label: 'Photograph it',
        wants: 'Photograph the saree, then record how many photographs were taken.',
        next: 'Next: send it for approval.',
      },
      {
        key: 'approve',
        label: 'Send for approval',
        wants: 'Send it to procurement to be signed off.',
        next: '',
      },
    ],
  },
  receive: {
    key: 'receive',
    name: 'Receive a parcel',
    steps: [
      {
        key: 'parcel',
        label: 'Which parcel',
        wants: 'Find the order the box in front of you belongs to. Match the docket on the label.',
        next: 'Next: count what arrived.',
      },
      {
        key: 'counts',
        label: 'What arrived',
        wants: 'Count each line: how many came, and how many were turned away and why.',
        next: 'Next: check what was recorded.',
      },
      {
        key: 'done',
        label: 'Done',
        wants: 'What this parcel recorded, and what is still owed on the order.',
        next: '',
      },
    ],
  },
}

/**
 * Whether the `?flow=` on this URL names the flow this screen belongs to.
 *
 * A shared screen asks this and shows the progress bar only when the answer is
 * yes. Anything else — no parameter, a misspelling, a flow that does not pass
 * through here — leaves the screen exactly as it is without a flow.
 */
export function runningFlow(param: string | undefined | null, key: FlowKey): FlowDef | null {
  return param === key ? FLOWS[key] : null
}

/** `href` with the flow carried on it, so the next screen knows one is running. */
export function withFlow(href: string, key: FlowKey | null): string {
  if (!key) return href
  return `${href}${href.includes('?') ? '&' : '?'}flow=${key}`
}

