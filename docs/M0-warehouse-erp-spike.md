# M0 — Warehouse & ERP spike

**Not a coding task.** Three to five days of observation and API reading, run by the Procurement Head with the Warehouse Manager. It has one output: a decision on where Goods Receipt lives, plus a written integration contract.

It is scheduled first because it is the only genuine unknown in the roadmap — and it is deliberately **non-blocking**: M1 through M4 can be built in full before this concludes. Nothing below stops other work.

---

## Why this exists

You confirmed an ERP/WMS is in place (EasyEcom or Increff) and that barcode label printing already happens in the warehouse. That single fact changes the project's nature: **we are an integration layer, not an inventory system.**

The open question is narrower but consequential — if the WMS already performs goods receipt competently, building a second receiving screen would mean retraining the warehouse for no gain, running two sources of truth, and reconciling them forever. If it does receipt poorly (no damage capture, no photo evidence, no per-PO-line reconciliation), then vendor scorecards and three-way match in M6 have nothing trustworthy to stand on.

The schema is already built to survive either answer: `goods_receipts` has a `source` enum (`internal | erp`) and two possible writers. This spike decides which writer to implement — one adapter, not an architecture.

---

## Part 1 — Sit with the Warehouse Manager (half a day)

Watch one real inbound shipment, start to finish. Do not interview; observe, then ask. What people describe and what they do diverge, and the gap is usually where the system needs to help.

Record:

- [ ] What physically arrives with the goods — a delivery challan, a vendor invoice, a handwritten note, nothing?
- [ ] How is the shipment matched to a purchase order today? By PO number, by vendor name, by memory?
- [ ] Where is the quantity first written down — WMS, paper, WhatsApp, Excel?
- [ ] **Time from goods arriving to stock being sellable on Shopify.** Get the real number, not the intended one. If this is measured in days, it is likely worth more than anything else in the roadmap.
- [ ] What happens when the count is short? Over? Damaged?
- [ ] Are damages photographed today? Where do those photos end up?
- [ ] When are barcode labels printed — by the vendor, on receipt, or at packing?
- [ ] How many people touch a shipment between gate and shelf?
- [ ] What does the Warehouse Manager complain about unprompted? (Highest-signal question here.)

## Part 2 — Audit the WMS (one day)

Confirm which system is in use, then evaluate what its inward flow actually captures:

- [ ] EasyEcom or Increff — and which plan/tier
- [ ] Does it hold **purchase orders**, or only inventory?
- [ ] Does it produce a **GRN** with per-line quantities?
- [ ] Can it record **damage** and **short quantity** separately, per PO line?
- [ ] Can it attach **photo evidence** to a receipt line?
- [ ] Does it support a QC disposition — accept / accept-at-discount / reject?
- [ ] Does it hold **vendor** records, and are they in sync with anything?
- [ ] Who actually uses it daily, and do they trust it?

## Part 3 — Read the API (one to two days)

- [ ] Is API access included in the current plan, or does it cost extra?
- [ ] Obtain sandbox credentials
- [ ] Document the endpoints for: create PO, fetch GRN, fetch stock-on-hand, create/fetch vendor
- [ ] **Webhooks or polling?** If polling, what rate limit?
- [ ] Confirm the identifier we can join on — our `vendors.code`, our PO number, or an ERP-internal id
- [ ] Rate limits, auth model, sandbox parity with production

## Part 4 — Shopify (half a day)

M2 and M8 depend on this, so gather it in the same pass:

- [ ] Confirm Shopify Plus API access and app/token setup
- [ ] Export a sample of variants: does every variant carry a usable `sku`?
- [ ] Decode the SKU convention — what do `vint`, `shan`, `wb` mean in `vintwb11987` / `shanwb14090`? Does the prefix already encode vendor or source?
- [ ] Is `cost-per-item` populated today? (Feeds landed cost in M6.)
- [ ] Which is authoritative for stock levels right now — Shopify or the WMS?
- [ ] How is sell-through currently reported, if at all?

---

## The decision

At the end, choose one and write down why:

| Option | Choose when | Consequence |
| --- | --- | --- |
| **A — Receive in the Procurement OS**, post to ERP | The WMS captures inward poorly, or cannot attach damage photos per line | Full M5 build. Best evidence quality; warehouse retraining required |
| **B — Receive in the ERP**, ingest GRN | The WMS does this well and the team trusts it | Small M5. No retraining. Vendor scorecard quality is limited to what the WMS records |
| **C — Hybrid**: count and QC here, ledger in ERP | The WMS tracks stock well but captures no QC evidence | Usually the pragmatic answer. Moderate build |

**Write the answer into `docs/decisions/0001-grn-ownership.md`** with the evidence behind it. In two years someone will ask why receiving works the way it does, and the observation notes will be the only honest answer.

---

## What would change the roadmap

Flag immediately if any of these turn out to be true — each is worth re-sequencing for:

- **Inward-to-sellable takes more than three days.** That is capital sitting idle and probably outranks parts of the current plan.
- **The WMS already holds purchase orders and vendors use it.** M3 shrinks considerably.
- **No API access on the current plan.** Either budget for the upgrade or fall back to CSV exchange, which changes M5 materially.
- **Shopify SKUs are inconsistent or missing.** M2 gains a data-cleanup phase before mapping is possible.
