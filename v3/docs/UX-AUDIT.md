# UX audit — Nerige OS staff screens

Audited against `.claude/skills/nerige-ops-ux/SKILL.md` (one directory above `v3/`),
with `src/lib/workspaces.ts` as the app's vocabulary and `PRODUCT.md` as the
statement of what each screen is for.

Date: 2026-09-17. Branch `platform-roles-and-performance`.

**The complaint being answered:** *"as a user my experience is not being smooth…
now it is too much scattered and the flow is not set according the uses… let it
be simple and easy."*

That is not a request for more features or fewer. Nearly every instance of it in
this build traces to one of three things, and they are the shape of this
document:

1. **The app calls the same thing three names.** You click **Weavers**, you land
   on a page headed **My vendors**, whose tab says **My vendors · Nerige**, and
   whose buttons offer **All products** and **Add a vendor** — four names for two
   nouns on one screen. Sixteen of the twenty-two nav sections did this. Nothing
   feels scattered faster than vocabulary that will not hold still.
2. **A slow screen was a white screen.** There was not a single `loading.tsx`
   anywhere in `src/app`. The catalogue, the orders list and the staff review all
   sit behind multi-second queries, and for those seconds the app showed nothing
   at all — which reads as broken, so people press back and click again.
3. **Empty meant stop.** "Nothing here." "No design matches that." "Nothing
   waiting." Twelve screens ended a journey with a sentence and no way onward.

Severity is the skill's own measure of cost to the person doing the job:

- **Blocks work** — somebody cannot finish the job, or finishes it wrong.
- **Slows work** — the job gets done, but with a detour, a re-read or a retry.
- **Rough edge** — noticed, not costly.

Items marked **FIXED** were changed in this pass. Items marked **RECOMMENDATION**
are in files owned by other agents working in the same tree right now
(`dashboard`, `work`, `numbers`, `flows`, `reorder`, `intake/new`,
`warehouse/inward/[orderId]`, `profiles`, `layout.tsx`, `nav.ts`,
`workspace-switcher`) and were left untouched deliberately.

---

## 1. Naming: the nav label and the page it opens

The skill is explicit: *"These names are the whole of the vocabulary people learn
this application by, so they are kept short, plain and identical everywhere they
appear."* (`workspaces.ts`) and *"Name things by what the person controls."*

Every mismatch below is a person clicking one word and arriving at another. The
cost compounds: it is also why search, help and asking a colleague all fail —
nobody can name the screen they are on.

| Nav label (`workspaces.ts`) | Heading was | `<title>` was | Severity | State |
|---|---|---|---|---|
| Weavers | `My vendors` | `My vendors · Nerige` | Slows work | **FIXED** → `Weavers` |
| All designs | `All products` | `Products · Nerige` | Slows work | **FIXED** → `All designs` |
| Whose saree is this | `To be identified` | `To be identified · Nerige` | Slows work | **FIXED** |
| Saree words | `Master data` | `Master data · Nerige` | **Blocks work** | **FIXED** → `Saree words` |
| Sarees being added | `Intake queue` | `Intake queue · Nerige` | Slows work | **FIXED** |
| Parcels | `Inwarding` | `Inwarding · Nerige` | Slows work | **FIXED** → `Parcels` |
| Approve sarees | `Review` | `Review · Nerige` | Slows work | **FIXED** |
| Look something up | `Lookup` | `Lookup · Nerige` | Rough edge | **FIXED** |

"Saree words" is rated **blocks work** rather than slows it. `master_data` is the
Postgres table. Nothing a warehouse manager or the owner ever says out loud is
"master data", and the warehouse home screen used to tell them a saree was stuck
*"Waiting for a master-data value"* — a sentence that names a table, names no
screen, and gives no clue that the fix is one click away under **Saree words**.
That is a saree sitting on a shelf because of a noun.

Detail-page titles were generic in a way that makes a browser's tab strip and
history useless once three are open: `Vendor · Nerige`, `Product · Nerige`,
`Order · Nerige`, `Saree · Intake · Nerige`, and `Lookup · Nerige` on *both* the
search and the result. **FIXED** — each now names what it is (`One weaver`,
`One design`, `A saree being added`, `One saree`).

### Buttons that named a different destination

- Warehouse home: a button reading **"Receive a parcel"** opened a screen headed
  **"Inwarding"**. Two names, neither shared with the nav section (**Parcels**).
  Severity: slows work. **FIXED** — the button now reads `Parcels`, matching
  where it lands. A weaver's parcel is *recorded* through the receive flow, which
  keeps its own name.
- Warehouse home and the queue: **"New saree"** where the section is
  **"Add a saree"**. **FIXED** on both.
- Weavers list: **"All products"**, **"Add a vendor"**. **FIXED** →
  `All designs`, `Add a weaver`.
- Weaver detail: **"Her products"**. **FIXED** → `Her designs`.
- New-weaver form: field labelled **"Vendor code"**, submit button
  **"Create vendor and login"**, and afterwards **"Open this vendor"**.
  **FIXED** → `Weaver code`, `Create the weaver and her login`, `Open this weaver`.
- Back links named the wrong thing or nothing: `All orders` (section is
  **Orders**), `Back to search` (section is **Look something up**),
  `Intake queue` ×3 (section is **Sarees being added**), `← Staff performance`
  with a stray arrow glyph. **FIXED** throughout.

### Database jargon on the glass

Quoting the offending copy, all **FIXED**:

| Screen | Was | Now |
|---|---|---|
| Whose saree is this | *"No placeholder vendor exists… Migration 026 has not been applied to this database."* | *"There is nowhere to park a saree whose code names no weaver… A developer needs to bring this database up to date."* |
| Whose saree is this | *"No product is sitting with the placeholder vendor."* | *"A saree lands here when its code names no weaver. Nothing is waiting…"* |
| Whose saree is this | *"…a stock number where the vendor code should be"* | *"…where the weaver's code should be"* |
| Saree words | *"Could not load master data: …"* | *"The saree words could not be loaded… tell a developer: …"* |
| Saree words | *"Drafts waiting for a value"* | *"Sarees held up waiting for a word"* |
| Saree words | *"…can be chosen at intake until one is named"* | *"…nobody can choose one while adding a saree"* |
| Warehouse home | *"Waiting for a master-data value"* | *"Waiting for a saree word to be named"* |
| Warehouse home tile | *"Drafts"* | *"Part-finished"* |
| Look something up (detail) | heading *"Intake"* | *"How this saree was added"* |
| Account requests | *"Requests made at /signup appear here"* — a URL as instructions | *"When somebody asks for a login from the sign-up page…"* |
| My profile | a `npm run provision -- --user-id … --reset-password` command in body copy | *"Ask an owner to issue you a new one."* |
| Sarees being added | filter labelled *"Status"* / *"Any status"* while the chips above say *stage* | `Stage` / `Any stage` |
| Shooting | *"In the automated pipeline — nothing to do here yet."* | *"Nothing for you to do on this one yet."* |
| All designs | *"Include inactive"* | *"Include designs Shopify no longer lists"* |
| All designs tile | *"edited"* | *"Photo replaced"* |
| Orders | *"14 lines"*, *"3 vendors"*, *"Unknown vendor"* | *"14 designs"*, *"3 weavers"*, *"Weaver not known"* |
| Order detail | *"This order has left the vendor"* | *"…has left the weaver"* |

**RECOMMENDATION (not owned).** `src/lib/intake/status.ts` `STATUS_LABELS` and
`humanise()` in `lookup/[sku]` still surface raw enum values lowercased —
`READY_FOR_REVIEW` becomes *"ready for review"*, `img_status` becomes
*"pending"*. It reads as machine output. A label map in the person's words
belongs beside the status enum, not in each screen.

**RECOMMENDATION (not owned).** `workspaces.ts` calls the section
**"Sarees being added"** but its home screen is `/intake/queue` and every URL,
action file and type in that subtree is still `intake`. The URL is not copy, but
`/intake/new` reached from a button reading "Add a saree" is a seam a curious
person will notice.

### A correctness bug found in copy

`admin/profile` printed **`Role: Procurement head`** as a hard-coded string, to
everybody — including the owner, whose role is `admin`. **FIXED**: it now reads
the actual role through a label map (`Owner — everything`, `Procurement head`,
`Warehouse manager`, `Answering questions`), and the row is labelled
*"What you can do"* rather than *"Role"*. Severity: rough edge, but it is the one
screen a person opens to check who the system thinks they are.

---

## 2. Empty states that dead-ended

The skill: *"Empty is an invitation: say what goes here and give the control that
starts it. 'No orders yet' is a dead end; 'Nothing sent yet — start with the
reorder grid' is a door."*

Every one of these ended with a full stop and nothing to press.

| Screen | Offending copy | Severity | Fix |
|---|---|---|---|
| Orders | *"Orders appear here once you have chosen a vendor on the reorder screen and pressed send."* | **Blocks work** | **FIXED** — the skill's own sentence, plus an **Open the reorder grid** button. The first thing a new procurement head sees was a description of a screen they could not get to from there. |
| All designs | *"Nothing here." / "No design matches that."* | Slows work | **FIXED** — says what to try, plus **Show the whole catalogue**. |
| Sarees being added | *"Nothing here."* for every cause — a filter that matched nothing and a genuinely empty queue read identically | Slows work | **FIXED** — the two are now told apart, with **Clear the filter** or **Add a saree**. |
| Approve sarees | *"Nothing to review"* | Slows work | **FIXED** — explains what puts a saree here, plus **Sarees being added**. |
| Shooting | *"Nothing to shoot"* | Slows work | **FIXED** — plus **Add a saree**, which is the next thing the manager does. |
| Whose saree is this | *"Nothing waiting" / "Not set up yet"* | Slows work | **FIXED** — both, plus a way onward. |
| Weavers | *"Add one, or load the catalogue to derive them from SKU prefixes."* | Slows work | **FIXED** — plus **Add a weaver**. |
| Account requests | *"Nothing waiting"* | Rough edge | **FIXED**. |
| Staff performance | *"No floor staff in this period"* | Slows work | **FIXED** — plus **Open the staff sheet**, which is where staff are actually added. |
| Cropping | *"Nothing to crop here"*, and the "switch to Everything" instruction had no control to do it with | Slows work | **FIXED** — the instruction is now the button. |
| Saree words | *"Nothing named yet"* | Rough edge | **FIXED** — says what the consequence is. |
| Look something up | before any search: a blank page with a box on it | Slows work | **FIXED** — the page now says what can be typed into the box before it is typed into. |

**RECOMMENDATION (not owned).** `reorder`, `work`, `numbers` and the three flow
end-screens were not audited for this; they should get the same pass.

---

## 3. Loading: a slow query was a blank page

**Severity: blocks work.** There was no `loading.tsx`, `error.tsx` or
`not-found.tsx` anywhere under `src/app` — verified by search. Every one of these
screens is a server component awaiting Supabase before it returns a single byte:

- `/admin/products` — `count: 'exact'` over 10,160 rows plus 60 images
- `/admin/performance` — a whole period of the staff sheet, per person per day
- `/orders`, `/orders/[id]`, `/review`, `/intake/queue`, `/lookup`
- `/warehouse` — five parallel loads
- `/admin/master-data` — the vocabulary plus example photographs

In production on a warehouse tablet that is multiple seconds of nothing. People
read nothing as broken: they press back and click again, which runs the query
twice and makes it slower.

**FIXED** — fifteen `loading.tsx` files, using new calm skeleton primitives
(`Skeleton`, `SkeletonHeader`, `SkeletonRows`, `SkeletonTiles`,
`LoadingAnnouncement`) added to `primitives.tsx`:

```
admin/products, admin/products/[sku], admin/products/unidentified,
admin/products/cropping, admin/vendors, admin/master-data, admin/performance,
orders, orders/[id], review, intake/queue, lookup, warehouse,
warehouse/inward, warehouse/shooting
```

The skeletons are `aria-hidden` and each screen announces the wait once in words
through a `role="status"` region, so the shapes are for the eye and the sentence
is for everyone else. `animate-pulse` is switched off under
`prefers-reduced-motion` (see §5).

`warehouse/inward/loading.tsx` also covers `warehouse/inward/[orderId]`, which
belongs to another agent; it is additive and no file of theirs was touched, but
they should know it is there.

**RECOMMENDATION (not owned).** `dashboard`, `work`, `numbers`, `reorder` and
the `flows/*` steps need the same treatment, and `reorder` most of all — it is
9,218 designs and it is the screen procurement opens first.

**RECOMMENDATION (nobody owns yet).** There is no `error.tsx` at any level. An
unhandled throw — `lookup/[sku]` throws deliberately on an RPC failure — shows
Next's own error screen, in English, with a digest hash. A single
`(app)/error.tsx` saying what happened and offering "try again" would cover every
screen in the app. This is a **blocks work** gap that nobody currently owns.

---

## 4. "It never renders zero, because zero is an answer"

The skill's hardest line, and the build honours it unevenly.

**Good, and worth keeping:** `/warehouse` wraps each section in `settle()` and
renders `SectionError` rather than a zero. `/admin/products` withholds the
sell-through badge entirely until a sales sync has run. `sales-badges.tsx`
returns `null` rather than a row of noughts. `/admin/settings` reports the last
*successful* sync rather than the last one.

**Failing, and now FIXED — error copy that gave no way out.** Five screens
rendered a raw Postgres message and nothing else, then carried on drawing an
empty list underneath, so a failed query and an empty queue looked the same:

| Screen | Was | Severity |
|---|---|---|
| Sarees being added | *"Could not load the queue: {message}"* then an empty list | Blocks work |
| Approve sarees | *"Could not load the review queue: {message}"* | Blocks work |
| Shooting | *"Could not load the board: {message}"* | Blocks work |
| Parcels | *"Could not load orders: {message}"* then four empty piles | Blocks work |
| Saree words | *"Could not load master data: {message}"* | Slows work |
| Look something up | the bare Postgres string as the whole message | Slows work |

All now say what happened, that what is below may therefore be wrong, and what to
do — reload, then tell a developer — keeping the technical text at the end for
whoever that developer is. None of them apologise, per the skill.

**Still failing — RECOMMENDATION.** Several list screens ignore the `error`
field altogether and render `data ?? []`: `admin/vendors/page.tsx` (three
queries, no error handling — a failure shows "0 weaving houses"),
`admin/signups/page.tsx`, `admin/settings/page.tsx`, `orders/page.tsx` (a failed
query produces the *"Nothing sent yet"* empty state, which is a lie with a button
on it). These need the `settle()` treatment `/warehouse` already uses. I left
them because fixing them means changing how the query result is consumed, which
is data logic, not presentation — and the brief for this pass was explicit that
it stays presentational.

---

## 5. The accessibility floor

### Keyboard focus — **blocks work**, **FIXED**

`primitives.tsx` gives `Button`, `Input`, `Select` and `Textarea` a proper
`focus-visible` ring. Nothing else in the app had one. That is most of the
navigation: every row of every queue, every stage chip, every weaver in the
table, every day in the staff grid, the side panel, the back links. A person
tabbing through the shooting board on the warehouse tablet had no way to see
where they were.

**FIXED** in `globals.css` with a zero-specificity `:where()` rule, so controls
that already draw their own ring keep it and only the gap is filled:

```css
:where(a, button, summary, [role='button'], [tabindex]):focus-visible {
  outline: 2px solid var(--color-stone-900);
  outline-offset: 2px;
  border-radius: 0.375rem;
}
```

### `prefers-reduced-motion` — **FIXED**

Not respected anywhere. Now honoured globally in `globals.css`, which also covers
the new skeletons.

### Touch targets — **slows work**, mostly **FIXED**

The skill says 44px because the warehouse is on a tablet. Found under:

- Pagination on **Whose saree is this**: bare `<a class="underline">` — roughly
  18px tall, on the screen where the owner works through a hundred sarees in a
  run. **FIXED** (now `LinkButton`).
- Mine/Everyone toggle on **Sarees being added**: `min-h-10` (40px). **FIXED**.
- `← Staff performance` back links, `Correct`/`Fill in` links in the per-person
  day list, the `Ignored` disclosure on **Saree words**, the weaver name links in
  the table, the `All orders` and `Back to search` back links. **FIXED**.
- The "include inactive" checkbox on **All designs** was a browser-default
  ~13px box. **FIXED** (20px, `accent-stone-900`).
- **RECOMMENDATION:** the day chips on **Staff performance** are `min-h-9`
  (36px) and the grid cells are `h-9 w-9`. Both are deliberately dense — a month
  of days has to fit — and enlarging them would break the grid. They are
  navigational shortcuts to a screen also reachable by the person's name, so I
  left them and am flagging the trade-off rather than silently keeping it.

### Contrast — **slows work**, largely **FIXED**

`text-stone-500` measures 4.80:1 on white and passes. `text-stone-400` measures
**2.56:1** and fails 4.5:1 badly — and it was carrying real content, not
decoration: every "Updated 3 Sep, 14:22" line, the counts beside section
headings, "No photo", "(left)", "Recorded by", target sub-labels, "Not recorded"
values in the performance table. **FIXED** across all owned screens by moving
informative text to `stone-600` (7.0:1), while leaving `stone-400` on the
purely decorative `·` separators, which are now `aria-hidden` so a screen reader
does not read "middle dot" between every fact.

Also raised: `text-amber-700` → `amber-800` on the badge that says a weaver has
**Never** signed in, and `bg-red-600` → `red-700` on the flag counters.

**RECOMMENDATION (not owned).** `text-stone-400` remains in
`admin/insights/*`, `warehouse/staff/roster.tsx` and `sheet-screen.tsx`
(disabled-state styling, mostly legitimate), and across the dashboard,
work, numbers and flows components. A grep for `text-stone-400` is the whole
to-do list.

### Meaning carried by colour alone — **FIXED where found**

The badges are in good shape: `StatusBadge` and `IntakeStatusBadge` both carry a
word inside the colour, and `sales-badges.tsx` names the tier. Three places did
not:

- **A saree being added**, the pipeline list: `●` / `○` with `aria-hidden`, so a
  screen reader heard only the step name and its detail, and a person who cannot
  distinguish the green from the grey saw two identical circles. **FIXED** —
  `sr-only` "Done: " / "Not done yet: " before each step.
- **Staff performance**, the day grid: state was a background colour plus a
  single letter, with the full meaning only in a `title` attribute — which does
  not reach a screen reader or a touch device. **FIXED** — each cell now carries
  its full sentence as `sr-only` text; the letter and the flag counter are
  `aria-hidden`.
- **Account requests**, recently decided: raw lowercase `approved` / `rejected`
  differing mainly by colour. **FIXED** — `Approved` / `Turned down`, in weight
  as well as hue.

### Tables with real headers — **FIXED**

Neither the weavers table nor the two performance tables used `scope`, and none
had a `<caption>`. The day-by-day grid had an empty `<th>` in the corner and
person names in `<th>` with no `scope="row"`. **FIXED** — `scope="col"` /
`scope="row"` throughout, `sr-only` captions on the weavers table and the
per-person work table, and an `sr-only` header row on the latter, which had a
`<tbody>` and no `<thead>` at all.

### `aria-current` on the active item — partly **FIXED**

`side-panel.tsx` already set `aria-current="page"` correctly. The stage chips on
**Sarees being added**, the type chips on **Saree words** and the Mine/Everyone
toggle all styled an active item without announcing it. **FIXED** on the ones I
own.

**RECOMMENDATION (not owned).** `src/app/(app)/layout.tsx` `NavLink` — the
header navigation, on every staff screen — sets no `aria-current` and no active
styling at all. That is the single most-seen navigation in the app and it never
says where you are. It is a one-line change in a file owned by another agent
this session.

### 375px — **slows work**, partly **FIXED**

Checked by inspection at 375, 768, 1024 and 1440:

- **Good:** the weavers table, both performance tables and the day grid each sit
  in their own `overflow-x-auto`, so the page body does not scroll sideways —
  which is the skill's rule, correctly applied.
- **Checked, no change needed:** the filter row on **All designs** uses
  `min-w-52` on the search box plus `min-w-44` and `min-w-40` on two selects in a
  `flex-wrap` row. At 375px with the page's 16px padding the widest child is
  208px against a 343px content box, so the row wraps rather than clipping.
- **FIXED:** header action buttons across **Weavers**, **Warehouse**,
  **One weaver**, **One design**, **Staff performance**, **Add a weaver** and
  both paginators were nested `<Link><Button/></Link>` — an anchor wrapping a
  button, so two tab stops and two announcements for one destination, and on a
  narrow screen a control whose hit area and visible box disagree. **FIXED** by
  adding a `LinkButton` primitive (one anchor, button sizing, 44px minimum) and
  using it everywhere that pattern appeared in the screens I own.
- **RECOMMENDATION:** `admin/performance` renders its table at full width inside
  a `space-y-6` container with no `max-w`; on a phone the horizontal scroll is
  within the table, which is correct, but the period picker above it should be
  checked by a person on a real handset. Not something a code read settles.

---

## 6. Scan-ability of dense lists

The skill: *"tabular numerals wherever numbers are compared down a column. SKUs
are always monospace."*

- **Weavers** put **Code** first and made it the link; **Name** sat in the second
  column as plain text. People refer to a weaving house by name — the code is the
  SKU prefix, read character by character. **FIXED** — the name is first and is
  the link; the code is second, monospace, and still selectable. Severity: slows
  work, fifty-three rows every time.
- **Weavers**, the Login column, printed `—` for a house with no login. That is
  the single most consequential fact on the row — a weaver with no login has seen
  none of her orders — rendered as punctuation. **FIXED** → *"No login yet"*.
- Missing `tabular-nums` on compared figures: the "Showing the most recent N of
  M" lines on **Orders** and **Sarees being added**, the pile counts on
  **Parcels** and **Shooting**, the "N of M sarees still use the default framing"
  line on **Cropping**, the sales figures in the holding-pen rows,
  "Page N of M" on two paginators. **FIXED** throughout.
- SKUs are correctly monospace everywhere I looked — `design-card.tsx`,
  `lookup`, `intake`, the products grid, the queue. No change needed; worth
  saying, because it is the rule most likely to be dropped by the next screen.
- Column order is otherwise consistent across the two performance tables.

**RECOMMENDATION (not owned).** The reorder grid and the `numbers` screens were
not read for this pass.

---

## 7. Numbers without the age of the data behind them

The skill: *"Every number on screen carries the age of the data behind it when
that data is synced rather than typed."*

`stock-line.tsx` is the model of this and every quantity that goes through it is
correct. Two screens showed synced figures bare:

- **All designs** — a `SellThroughBadge` on every tile, computed from
  `units_30d`/`60d`/`90d`/`365d`, with no date anywhere on the page. The code was
  careful to withhold the badge entirely until a sync had run (a good decision,
  and commented as such) but once one had, a figure from three days ago looked
  like this morning's. Severity: slows work — it is the number reorder decisions
  are made on. **FIXED** — one line under the heading: *"Sell-through counted
  from sales up to 14 Sep 2026, 09:30."*, derived presentationally from the
  `sales_synced_at` already selected. No query changed.
- **One design** — four sales tiles (30/60/90 days, a year) with no date.
  **FIXED**, same treatment, and it now says so plainly when sales have never
  been counted rather than showing four confident zeroes.
- **Look something up (detail)** — *"Sales have not been synced yet."* was
  technically right but left "so these would be zero" unsaid. **FIXED** —
  *"…not the same as nothing having sold."*

**RECOMMENDATION (not owned).** `numbers`, `dashboard` and `reorder` all present
synced figures and were not checked.

---

## 8. Smaller things, fixed in passing

- **Approve sarees** and **Whose saree is this** had form results announced in a
  plain `<span>`; a person using a screen reader pressed **Assign** and heard
  nothing. **FIXED** — `role="status"` on success, `role="alert"` on failure,
  on the holding-pen row and the saree-word row.
- Unlabelled form controls: the weaver select and search box on **All designs**,
  both selects on **Cropping**, the weaver dropdown on each holding-pen row, the
  name box on each saree-word row. All had a placeholder doing a label's job.
  **FIXED** — `sr-only` labels or `aria-label`.
- **Look something up** — the search box's `aria-label` was the single word
  "Search", which tells a screen-reader user nothing about what to type.
  **FIXED** → the placeholder's own text.
- `EmptyState` body copy was `text-stone-500`; moved to `stone-600`. It is the
  one piece of copy on a dead-end screen and it should be the most readable.
- **One weaver** — *"Usual lead time: 12 days"* is the schema column name read
  aloud. **FIXED** → *"Usually takes 12 days to weave an order"*. *"To reorder"*
  → *"Could be made again"*, matching the reorder section's own blurb.
  *"Last order: —"* → *"Never"*, per the screen's own good instinct elsewhere.
- **Staff performance**, per-person day list: quality flags were prefixed with a
  `⚑` dingbat. The skill says no emoji as icons and a dingbat is the same
  problem — it is read aloud as "black flag" or skipped entirely. **FIXED** →
  the word `Flag:`.
- **Shooting** — *"None."* under an empty group. **FIXED** → *"Nothing here."*,
  and moved off the failing `stone-400`.
- Sentence case and exclamation marks: no exclamation marks found anywhere in
  staff copy. Title-case leaks were minor and are fixed above (`edited`,
  `no photo`, `retired`, `approved`).

---

## What was deliberately not done

- **No data logic, guards, queries or schema were touched.** Every change is
  copy, class names, ARIA, or a new `loading.tsx`. The `salesAsAt` value on
  **All designs** and the role label on **My profile** are computed from data the
  page already had.
- **No files belonging to other agents were edited.** `layout.tsx` (the header
  nav's missing `aria-current`), `nav.ts`, `workspaces*.ts`, `dashboard/**`,
  `work/**`, `numbers/**`, `flows/**`, `reorder/**`, `intake/new/**`,
  `warehouse/inward/[orderId]/**`, `profiles/**`, `workspace-switcher.tsx`,
  `components/dashboard/**`, `components/flow/**`, and everything under
  `supabase/`.
- **`intake/_components/` and `intake/_lib/`** are shared between screens owned
  by different agents this session and were left alone. The status-label
  recommendation in §1 lives there.
- **`primitives.tsx` was changed additively**, as required: `LinkButton`,
  `Skeleton`, `LoadingAnnouncement`, `SkeletonHeader`, `SkeletonRows`,
  `SkeletonTiles`. The one exception is `EmptyState`'s body colour, a contrast
  fix that changes no signature and breaks no import.

## Verification

```
npx tsc --noEmit        clean
npx eslint <owned paths>  clean (1 pre-existing warning in admin/signups/actions.ts:55,
                          'admin' assigned but never used — not mine, not touched)
npm run build             ✓ Compiled successfully, no errors or warnings
npx vitest run            8 files, 155 tests, all passing
npm run i18n:check        all five locale files agree, 123 keys each
```

The brief said 141 tests; the suite is at 155, presumably from another agent's
work in the same tree. Nothing in this pass added or changed a test — every
change is presentational.
