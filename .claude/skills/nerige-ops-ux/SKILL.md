---
name: nerige-ops-ux
description: The design and UX rules for Nerige OS — an internal operations app used by an owner, a procurement head, a warehouse manager, support staff and 53 weavers. Use whenever building or changing any screen, navigation, dashboard or flow in nerige-procurement-os or nerige-dispatch. Covers workspaces, task flows, what belongs on a dashboard, copy, and the accessibility floor.
---

# Nerige OS — design and UX

Synthesised from Anthropic's `frontend-design` skill (distinctiveness, copy as design
material), `ui-ux-pro-max` (the pre-delivery checklist, resilient text), and
`bencium-design` (systematic audit, WCAG 2.1 AA, typography), narrowed to what this
app actually is: **a tool people use every working day, not a page they visit.**

That narrowing matters. A landing page is judged on how it looks in the first three
seconds. This app is judged on whether the warehouse manager still fills in the staff
sheet in week six. Optimise for the sixtieth use, not the first.

## The one rule everything follows

**A screen exists to finish a job, not to present data.**

Before adding anything to a screen, name the job and the person doing it. If you
cannot, it belongs somewhere else — or nowhere.

## Workspaces, not a menu of everything

One person does several jobs here. Pooja orders sarees, approves new ones, and reads
the numbers; those are three different heads, and a single navigation listing all of
them makes every one of them harder to find.

So navigation is shaped by the **workspace** the person is in (`src/lib/workspaces.ts`),
not by their role alone. The role decides what they *may* reach; the workspace decides
what is *in front of them now*.

- A workspace names a job in the user's words: *Ordering sarees*, *New sarees*,
  *The warehouse*, *The numbers*.
- Switching is one control, top right, always in the same place.
- The default is the workspace they chose when the account was set up, and they can
  change it. Nobody should have to switch before starting work.
- People may add their own, choosing the sections they want. A workspace nobody
  configured is still complete on its own.

**Never** make the switcher the only route to something. It is a focus tool, not a
permission boundary: every screen a role may reach stays reachable by URL and by
search, whatever workspace is open.

## Flows

A job that takes more than one screen is a **flow**, and a flow says three things on
every screen: where you are, what this step wants, and what happens next.

- Number the steps only when they are genuinely sequential. Ordering is: choose the
  weaver, choose the designs, say how many, send. That is a sequence, so number it.
  Looking something up is not.
- One primary action per step, in the same place every time, named for what it does:
  "Send the order", never "Submit".
- The flow's own trail is the progress bar. Do not also leave breadcrumbs.
- Leaving mid-flow must lose nothing. These people are interrupted constantly — a
  tablet locks, a phone rings. State lives in the URL or the database, never only in
  a component.
- Every flow ends on a screen that says what happened and offers the obvious next
  thing, which is usually starting the same flow again.

## Dashboards: three, and they do different jobs

One dashboard mixing decisions, pipelines and analytics teaches people to skim all
three. Keep them apart:

1. **Today** — only what is waiting on this person right now. Every tile is an action
   with a place to go. No totals, no trends, nothing that is merely interesting.
2. **Work** — what is in flight: orders with weavers, sarees being made, parcels
   arriving. Progress, not performance.
3. **Numbers** — every analysis, in one place, on purpose. Sell-through, insights,
   staff output. A person opens this deliberately; nothing here interrupts them
   anywhere else.

If a number cannot be acted on today, it is not a Today tile. If it measures a
person, it belongs in Numbers and nowhere near a queue.

## Copy

- Name things by what the person controls: "Saree words", not "master data";
  "Not yet identified", not "unidentified vendor holding pen".
- The action's name does not change through the flow. The button that says "Record
  the parcel" produces "Parcel recorded".
- Empty is an invitation: say what goes here and give the control that starts it.
  "No orders yet" is a dead end; "Nothing sent yet — start with the reorder grid" is
  a door.
- Errors say what happened and what to do, in the interface's voice, and never
  apologise.
- Sentence case everywhere. No exclamation marks. No emoji as icons.

## The floor, on every screen

Non-negotiable, checked before anything ships:

- Text contrast 4.5:1 minimum; badge meaning never carried by colour alone.
- Visible keyboard focus; every flow completable from the keyboard.
- Touch targets 44px minimum — the warehouse works on a tablet, the weaver on a phone.
- `prefers-reduced-motion` respected; motion is confined to what explains a change.
- Works at 375, 768, 1024 and 1440 wide. Chips and labels wrap rather than clip.
- Every number on screen carries the age of the data behind it when that data is
  synced rather than typed.
- A section that fails to load says so. It never renders zero, because zero is an
  answer and "we could not ask" is not.

## Visual language

Restraint, because this is a tool: stone greys, one accent, generous space, no
gradients, no shadows beyond a hairline border. The photograph of the saree is the
only thing on any screen allowed to be loud — it is what the weaver recognises and
what Pooja judges. Everything around it is quiet on purpose.

Type: one family, three sizes that mean something (a code, a sentence, a label), and
tabular numerals wherever numbers are compared down a column. SKUs are always
monospace: they are read character by character and copied onto fabric by hand.
