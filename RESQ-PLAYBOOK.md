# RESQ PLAYBOOK — living with ResQ without losing NEXUS

*Written 2026-07-06. Context: NEXUS was built to replace ResQ; management
decided to use ResQ anyway. This is the plan for making that not hurt.*

---

## 1. The strategy in one paragraph

Don't fight the mandate — flank it. ResQ becomes the **reporting surface
management looks at**; NEXUS stays the **operating layer and the source of
truth** (vendors, equipment, PMs, dispatch speed). Everything management
wants to see in ResQ gets *fed from NEXUS* in one-shot bulk moves — never
retyped, never negotiated one email at a time. Every improvement below
follows that rule.

---

## 2. The vendor problem, and what NEXUS now does about it

**How ResQ vendor adds actually work:** there is no self-serve vendor
import. Each vendor goes through ResQ's *"Invite Your Own Vendor"* flow —
you enter their company + contact + email, ResQ emails the vendor an
invitation, and the vendor has to accept and onboard (COI, W-9, payment
details) before the platform treats them as fully live. Anything outside
that form means an email thread with the ResQ CSM. For a 40-vendor book
across three restaurants, that's weeks of ping-pong.

**What shipped in NEXUS (Vendors screen):**

| Tool | Where | What it does |
|---|---|---|
| **→ ResQ** | Vendors masthead, next to **+ New** | Downloads every active vendor as one CSV (company, trade, contact, all emails/phones, address, account #, 24-hr flag, notes). Send it to the CSM **once**: "please bulk-onboard these." The toast warns how many vendors are missing an email, since ResQ can't invite without one. |
| **⧉ ResQ** | Vendor detail header + row ⋮ menu ("Copy for ResQ") | Copies that vendor to the clipboard, field-for-field what the invite form asks for. Adding one vendor to ResQ = open their form, paste, done. No composing, no thread. |

Also callable from anywhere: `NXVendors.exportResQ()` and
`NXVendors.copyResQPacket(vendor)`.

**The workflow from now on:** a new vendor is *always* added in NEXUS
first (**+ New** — 30 seconds, works offline of any ResQ approval). Then,
whenever ResQ needs to know: ⧉ copy → paste into their invite form. ResQ
is downstream. NEXUS never waits on ResQ.

> Known gap (from the vendor book itself): **R4, Red Bud, Maccinisti,
> HOODZ, and Austin Industrial Refrigeration have no email on file.**
> ResQ cannot invite them until those are filled in. The export flags them.

---

## 3. Equipment is already bridged

Built earlier (Equipment screen): **→ ResQ** exports the current
location's units as a CSV matching ResQ's own 12-column export schema
(confirmed against their real export, May 2026), and **→ ResQ XLSX**
builds their 8-column bulk-import template for all locations. Categories
are auto-mapped to ResQ's equipment types; the toast tells you which rows
fell back to a generic type and deserve a skim. Facility names export
uppercase (ESTE / SUERTE / BAR TOTI) to match ResQ's convention — if the
ResQ facility names differ, find-and-replace in the sheet before upload.

---

## 4. Getting more out of ResQ itself — the levers

Things to set up (or make the CSM set up) inside ResQ so the mandated tool
is at least a *good* mandated tool:

1. **Bulk vendor onboarding.** Attach the NEXUS vendor CSV and ask the CSM
   to onboard the whole book in one pass. This is the single biggest
   time-saver and it's their job, not yours.
2. **Dispatch-before-acceptance.** Ask whether work orders can be sent to
   an invited vendor who hasn't finished onboarding (some platforms relay
   by email in the interim). If yes, the invite step stops blocking repairs.
3. **Approval thresholds.** Set auto-approve limits per location so small
   repairs don't queue behind a manager click. Management gets oversight
   on big spend; you get speed on small spend.
4. **PM schedules.** Load the recurring PMs (hood cleaning, grease trap,
   HVAC quarterly) so management sees the same calendar NEXUS already runs.
5. **Asset QR tags.** ResQ supports barcode/QR on assets ("Bar Code"
   column in their schema). NEXUS equipment QR codes export into that
   column — one label on the machine can serve both systems.
6. **Reporting exports.** Get a monthly spend export out of ResQ and back
   into NEXUS reconciliation, so vendor scorecards (A–F grades, response
   times) stay accurate. ResQ shows spend; NEXUS shows *judgment*.

**What stays out of ResQ, permanently:** ordering and pars (pars are
reference numbers only — never "order by par"), cleaning rosters, and the
vendor scorecards. ResQ has no equivalent and management didn't ask.

---

## 5. The widget question — what's buildable at each access level

**Level 0 — today, no API (done):** the CSV/packet bridge above. Blunt,
reliable, zero permission needed.

**Level 1 — email as the API (buildable next, no ResQ cooperation):**
ResQ sends notification emails (work order created/updated/completed).
Auto-forward those to a NEXUS-owned address, parse them with a small edge
function, and NEXUS gets a *read-only live feed of ResQ activity* — enough
to power a home-screen widget ("open ResQ work orders: 4 · oldest 6 days")
without ResQ knowing or caring. Say the word and this gets built; the only
input needed is a sample of the notification emails.

**Level 2 — the real API (requires management's weight):** ResQ's API and
webhooks are enterprise-tier and not publicly documented — there's no
self-serve key. Since *management* chose ResQ, let management request it.
The exact ask for the CSM: **read access to work orders, vendors, and
invoices, plus a webhook on work-order status change.** With that, NEXUS
gets a true two-way widget: work orders raised in NEXUS appear in ResQ,
status flows back live, and nobody double-enters anything again.

**Honesty note:** ResQ's help center and site actively block automated
readers (verified 2026-07-06 — server returns 403 to non-browser
traffic), and no public API docs exist. Every claim in §2 about the
invite flow matches their published support article titles and standard
platform behavior, but the fine details (dispatch-before-acceptance,
bulk-import willingness) should be confirmed with the CSM — the checklist
below is written to do exactly that.

---

## 6. One email to the CSM (send once, covers everything)

> Hi — we're standardizing on ResQ across Suerte, Este, and Bar Toti and
> want to onboard efficiently:
> 1. Attached is our full vendor list as CSV — can your team bulk-onboard
>    these instead of us submitting them one at a time?
> 2. Can we dispatch work orders to an invited vendor before they finish
>    onboarding? How does that reach them?
> 3. We already imported equipment via your template. What's the best way
>    to keep it in sync going forward — re-upload, or is there an API?
> 4. What does API/webhook access look like on our plan? We have an
>    internal ops dashboard and want work-order status flowing into it.
> 5. Can we get a recurring monthly spend/work-order export (CSV) per
>    facility?

One email. Ironically.
