# NEXUS — UI / UX Criteria

> The contract every screen must honor. Read once, refer back forever.
> If a decision isn't here, it's a smell. Add it, don't improvise.

**Version**: 1.0 — pre-overhaul baseline
**Status**: Living document. Edit in PR with rationale.
**Audience**: future-Orion, contractors, AI assistants, UX reviewers.

---

## TL;DR — the ten rules

1. **Editorial × terminal, gold on near-black.** That's the brand. Don't dilute it.
2. **One token system.** `--nx-*` wins. `--accent`/`--bg` are deprecated.
3. **One primary action per screen.** Gold gradient pill. Everything else is quieter.
4. **44px minimum touch target.** Always. Cooks have wet thumbs at 6am.
5. **Typography does the work, not borders.** Spacing creates hierarchy; rules don't.
6. **Mono is for time, code, IDs, status.** Not body copy, not headlines.
7. **No "fixes" CSS files.** Ever again. Patches go in the canonical file, with a comment.
8. **Empty / loading / error / success — every async surface needs all four.** No exceptions.
9. **Motion is 120ms (press), 220ms (flow), 350ms (slow). Three values. No fourth.**
10. **If you can't write a one-line caption explaining why a screen exists, it doesn't ship.**

---

## 1 · North star

> *NEXUS is a calm command surface for restaurant operations. It tells you what's wrong, what's next, and gets out of the way. Beauty earns its place by reducing friction, not adding gloss.*

Every design decision answers to that sentence. If a flourish doesn't reduce friction or increase clarity, cut it. If a screen feels busy, it's wrong — even if every element on it is "correct" in isolation.

The product is used at 6am with wet hands and at 11pm with tired eyes. **It is not used to admire the interface.**

---

## 2 · Who actually uses this

| User | Context | Posture | Implication |
|---|---|---|---|
| Manager (Orion, GMs) | All views, all the time | Two-handed, focused | Information density is OK. Power-user shortcuts welcome. |
| Line cook / FOH | Duties, Equipment QR, Log | One-handed, distracted, often gloved/wet | Big targets. One thing per screen. Forgive thumb errors. |
| Contractor | Public PM scan flow | Phone in landscape, on-site, often in a basement | No login if avoidable. No app needed. Big buttons. Photo capture must work first try. |
| AI (Trajan/Providentia) | Chat surfaces | Reading user prose, writing structured replies | Treat as a first-class user. Streaming, citations, undo. |

**Design floor**: every primary action must be reachable with one thumb on a 6.1" phone in portrait. If it isn't, redesign — don't add a "tap here" hint.

---

## 3 · Aesthetic identity (codified)

The voice already exists in `index.html`, `home.js`, and the *Astra monstrat / The stars are pointing* PIN-screen copy. The overhaul preserves it.

### 3.1 Two words: **editorial × terminal**

- **Editorial** = magazine restraint. Generous negative space. Display type that means it. Section headings that read like a print masthead. Phrases like *"Quiet this morning"* and *"On the books"* — not labels like "Activity Feed" or "Upcoming Events."
- **Terminal** = monospace dignity. Time stamps, IDs, status flags, command-line cues. The PIN screen is the canonical reference — JetBrains Mono caps with letter-spacing.

These two registers cohabit. They never blur into a third thing. Body copy is sans (DM Sans). Status / clock / metadata is mono (JetBrains Mono). Don't put body copy in mono "for vibes" and don't put timestamps in sans "for warmth." The contrast is the brand.

### 3.2 The metaphor: the coin

The Trajan ↔ Providentia coin is load-bearing identity. It signals:
- A choice the user makes (which advisor)
- A duality (operational vs. predictive AI)
- The ritual of opening the app (flip on PIN screen, persistent on masthead)

Treat the coin as you would a logo. Don't shrink it below 32px. Don't crop it. Don't replace its idle wobble with a different motion. The wobble *is* the brand.

### 3.3 What we are not

- Not Linear (we're warmer, more editorial, less corporate-grid).
- Not Notion (we're denser, more declarative, less playful).
- Not a typical kitchen ops tool (we're not orange/red/screaming, we're calm).
- Not Apple stock (we're not glossy/skeuomorphic).

When tempted to copy a competitor's pattern, ask: **does the editorial × terminal voice survive this?** If no, don't.

---

## 4 · Design tokens — the contract

**Single source of truth: `css/nx-system.css`**. Every other stylesheet reads from it. Direct hex codes outside this file are bugs.

### 4.1 Deprecation: kill the legacy tokens

The codebase has two parallel token systems. This must end.

| Legacy (deprecate) | Canonical (use) | Notes |
|---|---|---|
| `--accent` | `--nx-gold` | Same value, but the name reflects the family |
| `--bg` | `--nx-bg` | |
| `--surface`, `--elevated` | `--nx-surface-1`, `--nx-surface-2`, `--nx-surface-3` | Three levels. Don't add a fourth. |
| `--text`, `--muted`, `--faint` | `--nx-text`, `--nx-muted`, `--nx-faint`, `--nx-faintest` | Four levels. |
| `--border` | `--nx-gold-line` | Borders are gold-tinted, period. |
| `--green`, `--red`, `--blue`, `--purple` | `--nx-green`, `--nx-red`, plus `--nx-amber` (= `--nx-gold`) | Blue/purple are *not* in the system; if you need them, you're wrong. |
| `--r`, `--rs`, `--rp` | `--nx-radius-tighter`, `--nx-radius-tight`, `--nx-radius-card`, `--nx-radius-pill` | Four named radii. Don't introduce a fifth. |

**Migration rule**: when you touch a file, replace any legacy token you see with its `--nx-*` equivalent. Don't do it as a separate PR — it'll never finish. Do it as you go.

### 4.2 The token shape

Every token belongs to one of these families. Adding a token outside these families requires a written rationale in this doc.

```
Color:
  --nx-bg                   page background
  --nx-surface-{0..3}       layered surfaces (elevation by translucency, not by color)
  --nx-surface-press        pressed/active state
  --nx-text / -strong       body / emphasized
  --nx-muted / -faint / -faintest    three steps down
  --nx-gold                 the brand accent
  --nx-gold-{faint,soft,line,line-2,line-3,glow,deep,darker}    tonal stack
  --nx-red / -soft / -line      destructive, oxblood
  --nx-green / -soft / -line    success, olive bronze (NOT kelly green)
  --nx-amber                = --nx-gold (warning ≡ attention, on purpose)

Spacing (use a token, never a px literal):
  --nx-space-{1..12}        4 → 72px in a fibonacci-ish ramp

Radius:
  --nx-radius-tighter       6px   (chips, mono pills)
  --nx-radius-tight         10px  (buttons, fields)
  --nx-radius-card          16px  (cards, sheets)
  --nx-radius-pill          999px (pills, the primary CTA)

Type:
  --nx-text-{xs,sm,base,md,lg,xl,2xl,3xl,4xl}
  --nx-font-display / -body / -mono

Shadows:
  --nx-shadow-{soft,card,pill,fab}    four levels. No fifth.

Motion:
  --nx-press     120ms      (button press)
  --nx-flow      220ms      (panel slide, card expand)
  --nx-slow      350ms      (modal open, view transition)
  --nx-cinematic 700ms      (PIN→app, coin flip — reserved for ritual moments)
  --nx-ease      cubic-bezier(0.4, 0, 0.2, 1)    (the only easing)
```

**Anything outside this list is a leak.** When you reach for a value not in the system, the answer is one of: (1) use the closest token, (2) propose a new token in this doc, (3) you're solving the wrong problem.

---

## 5 · Typography

### 5.1 The three faces

| Face | Use for | Never use for |
|---|---|---|
| **Outfit** (display) | Headlines, the lede on Home, the PIN-screen wordmark, masthead | Body copy, captions |
| **DM Sans** (body) | Paragraphs, list items, button labels, form fields | Timestamps, IDs |
| **JetBrains Mono** (terminal) | Time, dates, status flags, IDs, code, the PIN keys, dashboard counts | Sentences. Headlines. Anything > 6 words. |

Mono in a sentence reads as "robot." Sans for a clock reads as "calendar appointment." Don't cross the streams.

### 5.2 Scale (mobile-first)

```
12px   --nx-text-xs    metadata, captions, kickers ("OVERDUE")
13.5px --nx-text-sm    secondary body, supporting text
16px   --nx-text-base  primary body (THIS IS THE FLOOR — never go smaller for readable copy)
17px   --nx-text-md    emphasized body
19px   --nx-text-lg    section subheadings
22px   --nx-text-xl    card titles
28px   --nx-text-2xl   view-level headings
40px   --nx-text-3xl   the home lede ("Morning, Orion.")
48px   --nx-text-4xl   PIN screen wordmark only
```

**Body copy floor: 16px.** Anything smaller is a metadata role (timestamp, kicker, count label). If you find yourself writing 14px body copy because "it doesn't fit," you have too much copy or your card is too narrow.

### 5.3 Letter-spacing

- Mono caps (kickers, status, time): `letter-spacing: 0.12em` to `0.18em`. The PIN screen uses `0.21em` and that's intentional — it's a moment.
- Display headlines: `letter-spacing: -0.01em` (slight tightening — feels editorial)
- Body: `0` (default).
- **Never letter-space lowercase body copy.**

### 5.4 Line-height

- Body: 1.5 (default `<body>`).
- Headlines: 1.15.
- Mono single-line elements (clock, status pill): 1.

### 5.5 Numerals

When a screen shows numbers that compare or stack vertically (the four stat counters on Home, the inventory rows, the brain count), use `font-variant-numeric: tabular-nums`. Otherwise, the digits jitter as values change.

---

## 6 · Color

### 6.1 The palette is intentionally narrow

```
Background    near-black warm    #111116    (dark)    #F4F1EB    (light)
Text          warm cream         #ede9e0    (dark)    #1a1a1f    (light)
Accent        gold               #d4a44e    (dark)    #8b6914    (light)
Success       olive bronze       #9c8a3e
Warn          gold (= accent)    #d4a44e    intentional — warn IS attention
Destructive   oxblood            #a83e3e
Info          gold (= accent)               we don't have a separate info color
```

**No kelly green. No bright red. No sky blue. No purple.** These were on the legacy palette and have been replaced. If the data has more semantic categories than the palette has colors, you have a UX problem — solve it with copy and iconography, not by adding colors.

### 6.2 Surfaces are translucent layers, not different colors

Elevation in dark mode comes from translucency over `--nx-bg`, not from lighter greys. This means:
- Backdrops show through subtly (good — adds depth on the brain galaxy view)
- A card on top of a card on top of a sheet automatically gets visually distinct
- We don't need shadows to fake depth on dark backgrounds

```
--nx-surface-0    rgba(28, 24, 20, 0.30)   barely there, ambient
--nx-surface-1    rgba(28, 24, 20, 0.45)   default card
--nx-surface-2    rgba(20, 18, 14, 0.65)   floating panel, sheet
--nx-surface-3    rgba(36, 32, 28, 0.75)   modal, FAB backing
```

In light mode, the same tokens point at warm cream-on-cream layers. Same logic.

### 6.3 Borders

All borders are gold-tinted. Period. Pure neutral borders look corporate; gold-tinted borders read as part of the brand even when they're at 7% opacity.

```
--nx-gold-line       0.22  default
--nx-gold-line-2     0.40  emphasis (active tab, focused field)
--nx-gold-line-3     0.62  selected, attention
```

---

## 7 · Spacing & rhythm

### 7.1 The scale

```
4   --nx-space-1    hair gap (icon ↔ label)
8   --nx-space-2    inline pair gap
12  --nx-space-3    card inner row spacing
16  --nx-space-4    card padding (default), section inner gap
20  --nx-space-5    rare, fine-grained
24  --nx-space-6    section vertical spacing within a card
32  --nx-space-7    section break (between groups of cards)
40  --nx-space-8
48  --nx-space-9    view-level section break
56  --nx-space-10
72  --nx-space-12   page-level breathing room (top of view, between major regions)
```

**Use a token. Never a literal `padding: 17px`.** If you need 17px, the answer is you don't.

### 7.2 Vertical rhythm rule

A view scans top-to-bottom on a phone. The rhythm is:

```
72px breathing room
└── view title (40px display, with tight letter-spacing)
    8px
    └── intro sentence (16px body, --nx-muted)
        32px
        └── primary section heading (12px mono caps, --nx-gold, with a 1px gold-line top border)
            16px
            └── content
                32px
                └── next primary section heading
```

This is what `home.js` already does with the *"Today"* / *"On the books"* sections. Replicate it across all views. **Hierarchy comes from spacing, not from `<hr>` or background color stripes.**

### 7.3 No "decorative dividers"

A horizontal rule means: "this section is actually different, you crossed a boundary." A horizontal rule does NOT mean "I needed visual separation here." If you want visual separation, use spacing. If spacing isn't enough, your content needs reorganization, not a divider.

---

## 8 · Component library — the closed set

These are the only primitives. Building a one-off component is a **smell**. The answer is: extend a primitive, or reach for the closest existing one.

### 8.1 Pills (the primary action vocabulary)

```
.nx-pill                       default (gold gradient, white-gold text)
.nx-pill--secondary            outlined gold, transparent fill
.nx-pill--quiet                text-only, --nx-muted (tertiary action)
.nx-pill--sm                   smaller pad
.nx-pill--xs                   even smaller (use sparingly)
```

**One primary pill per screen.** If you have two gold pills competing, one of them must demote to `--secondary`. The PIN-pad layout is the visual reference for what a "moment" looks like — calm, single focal point.

### 8.2 Cards

```
.nx-card                       default surface card
.nx-card--elevated             with --nx-shadow-card (use when card overlaps content)
.nx-card--bordered             with --nx-gold-line border (use when no shadow context)
.nx-card--press                tappable variant; gives feedback on :active
```

Card padding is always `--nx-space-4` (16px). If your content needs more, use `--nx-space-6` (24px) for "section card" feeling. Don't invent 20px.

### 8.3 Sections

```
.nx-section                    section wrapper (margin-top: --nx-space-7)
.nx-section--first             first section in a view (no top margin)
.nx-section-title              the kicker heading (mono caps, gold)
```

Use these. Don't write `<h2 style="...">` inline.

### 8.4 Stats

```
.nx-stat                       the at-a-glance number block (Home's four buttons)
.nx-stat-num                   tabular-nums, large
.nx-stat-label                 mono caps, --nx-faint, kicker style
```

If you need to show a number prominently, this is the component.

### 8.5 Inputs

```
.nx-input                      text field
.nx-input--sm                  
.nx-textarea                   
.nx-select                     
```

Field height: 44px (touch floor). Always.

### 8.6 The Ask bar

```
.nx-ask                        the hero AI input (Home → Ask NEXUS)
```

This is the single most important affordance in the app. Every view should consider whether the user might want to ask AI from here, and surface a `.nx-ask` if so.

### 8.7 Banned components

Anything not in this list. Specifically:

- Bootstrap-style alerts (use `.nx-card` with `--nx-red-line` or `--nx-amber` border)
- Material chips (we have `.nx-pill--xs`)
- Modal stacks more than two deep (refactor — your IA is wrong)
- Floating tooltips that show on hover (we're mobile-first; hover doesn't exist)
- Numbered badges over icons in nav unless count > 0 AND change is real-time
- Avatar bubbles (we don't have avatars; PIN identifies users)

---

## 9 · Motion language

### 9.1 Three speeds. Three jobs.

| Speed | Token | Use for | Don't use for |
|---|---|---|---|
| **120ms** | `--nx-press` | Button press, ripple, tap response | View transitions |
| **220ms** | `--nx-flow` | Panel slide, accordion expand, card swap | Page-level motion |
| **350ms** | `--nx-slow` | Modal open, sheet from bottom, view-to-view | Anything that should feel snappy |
| **700ms** | `--nx-cinematic` | **PIN → app reveal, coin flip, ritual moments only** | Anywhere else, ever |

Easing is **always** `cubic-bezier(0.4, 0, 0.2, 1)` (`--nx-ease`). Don't use linear, don't use ease-in-out, don't use bounce. One easing. One.

### 9.2 What motion is for

- **Confirm**: a button press visually depresses (`transform: scale(0.97)`, 120ms)
- **Connect**: a card sliding into place tells the user "this came from there"
- **Reveal**: a panel from below shows it's optional / temporary
- **Ritual**: the coin flip on PIN, the *cinematic* speed earned by the moment

### 9.3 What motion is NOT for

- Decoration. If a thing animates and the user can't say what changed, kill it.
- Hiding latency. If a fetch is slow, fix the fetch or show a skeleton — don't disguise it with a 600ms fade.
- Loading spinners that spin forever. Skeletons or dots are better signals.

### 9.4 Reduced motion

Honor `prefers-reduced-motion`. The coin idle wobble, the PIN ritual, any fade or slide must collapse to instant or to a 50ms confirmation flash. This is non-negotiable — it's accessibility, not a "nice to have."

---

## 10 · Voice & copy

The copy is half the design. NEXUS has a distinct voice already; codify it.

### 10.1 Register

- **Calm, declarative, slightly literary.** *"Nothing urgent this morning."* not *"No alerts!"*. *"On the books"* not *"Upcoming events."*
- **Short sentences.** Five words is fine. Twelve words is suspicious.
- **No exclamation marks.** Ever. We don't shout. (One exception: an actual emergency like a sub-zero freezer, which we currently don't have a state for.)
- **Mono caps for status, not for emotion.** `OVERDUE` is mono caps because it's a flag. `Quiet this morning.` is sans because it's a sentence.

### 10.2 The masthead voice

The PIN screen's *Astra monstrat / The stars are pointing / Tap the coin* sets the bar. The latin epigram is earned because the coin is the brand metaphor. **Don't add latin elsewhere** — that voice is reserved for the ritual moment.

The day-to-day voice is the *"Morning, Orion."* / *"Quiet this morning."* register: warm, observational, slightly literary, never twee.

### 10.3 Buttons

| Don't | Do |
|---|---|
| Submit | Save |
| OK | Got it |
| Cancel | Not now |
| Click here | (rewrite — never use this phrase) |
| Read more → | View full calendar → |

The arrow `→` is acceptable on tertiary "more" affordances. Don't use it on primary pills.

### 10.4 Empty states

Empty states are micro-essays. They have:
- A **mark** (◇ or ◎ or another single glyph — the calm-state diamond on Home is the canonical example)
- A **declaration** (one sentence describing the state)
- An **action** (the user's next move, as a `.nx-pill--secondary`)

```
◇  Nothing urgent this morning.
   All equipment current, no overnight tickets,
   contractors on schedule.
   ┌─────────────────────────────┐
   │  Review equipment →         │
   └─────────────────────────────┘
```

Empty ≠ broken. Empty means "everything is fine," and we say so.

### 10.5 Error states

Error copy is honest, not cute. Specifically:

- Tell the user **what** failed.
- Tell them **whether to retry, fix, or wait.**
- Don't hide the technical detail in a tooltip — put it in a `<details>` so the user can copy it.
- Never blame the user. *"Couldn't load equipment list. Check your connection or try again."* not *"You appear to be offline."*

---

## 11 · Information architecture (per view)

The app currently has nine views. Each must answer **one question**. If a view answers more than one, it's two views.

| View | Answers | Doesn't |
|---|---|---|
| **Home** | "What needs my attention right now?" | Show everything. Browse history. Configure things. |
| **NEXUS (Brain)** | "What does the system know, and how is it connected?" | List tasks. Show schedules. |
| **Duties (Clean)** | "What did I commit to today, and is it done?" | Plan future shifts. Audit performance. |
| **Log** | "What happened across the restaurants?" | Make decisions. Trigger actions. (It's a feed.) |
| **Board** | "What's in flight, and where is each thing?" | Be a daily checklist. (Use Duties for that.) |
| **Calendar** | "When is something happening?" | Show what — only when. |
| **Equipment** | "Is each piece working, when was it serviced, when next?" | List inventory consumables. |
| **Inventory** | "What do we have, and how much?" | Track equipment. Show suppliers. |
| **Ingest** | "What's coming in from outside (email, scans, voice)?" | Be a daily working surface. (Manager-only.) |

**Rule**: when a feature wants to land somewhere, it goes in the view whose question it answers. If it doesn't fit a question, **it doesn't ship until you decide which question it answers.** No "we'll put it on Home and figure it out later." Home is the most expensive real estate in the app.

### 11.1 Home is sacred

Home is what the manager sees at 6am. It must contain:

1. **Library card** (today's track + chapter) — the morning ritual
2. **Lede** ("Morning, [name].")
3. **Situation line** (one sentence summarizing what's true right now)
4. **Glance stats** (4 numbers, mono — tickets / overdue / services / nodes)
5. **Today** (priority feed, max 3 items, real or calm-state)
6. **On the books** (calendar peek, max 2 items)
7. **Ask NEXUS** (the hero input)

It must NOT contain: navigation tabs duplicated, notifications icon stack, "recent" anything that isn't priority-ranked, configuration. **If a feature wants to add itself to Home, it must displace something — Home doesn't grow.**

---

## 12 · State design — every async surface needs all four

For any view, card, or component that loads data, define:

| State | Visual | Copy |
|---|---|---|
| **Loading** | Skeleton bars (no spinner) | None — silence is fine for <2s |
| **Empty** | Mark + declaration + action | The micro-essay (see §10.4) |
| **Error** | `--nx-red-line` border, oxblood mono kicker `ERROR` | Honest, with retry |
| **Success / loaded** | The actual data | (the data is the copy) |

**If you build a card and don't define all four, the card is unfinished.** Loading skeletons are not optional — they prevent layout shift, which prevents the user feeling like the app stuttered.

### 12.1 Skeletons

A skeleton is a `--nx-surface-1` block at the dimensions the loaded content will occupy. It pulses subtly (`opacity: 0.6 → 1.0`, 1.4s, ease-in-out, infinite). Don't shimmer-gradient — the editorial voice is calmer than that.

---

## 13 · Touch & accessibility

### 13.1 The 44px floor

Every tappable thing is at least 44 × 44px. This is non-negotiable. It's WCAG 2.5.5 (Target Size), Apple HIG, and a wet-thumb survival floor.

If your design "looks tight" with 44px buttons, the design is wrong, not the floor.

### 13.2 Focus visible

Keyboard focus is a 2px gold outline at `--nx-gold-line-3`, with 2px offset. This is for desktop power users and screen reader users. Don't hide it.

### 13.3 Color contrast

All text passes WCAG AA at minimum:
- `--nx-text` on `--nx-bg`: must be > 7:1 (it is, in both themes)
- `--nx-muted` on `--nx-bg`: must be > 4.5:1 (verify in both themes when changing)
- `--nx-faint` is for **decorative** copy only (e.g., "Tap to expand") — never use for content

### 13.4 Screen reader copy

Every icon-only button has an `aria-label`. Every status uses ARIA live regions when it changes (e.g., the offline banner). Lucide icons get `aria-hidden="true"` because their meaning is in the surrounding label.

### 13.5 i18n

Copy strings live in `i18n.js`. Don't hardcode English in templates. The voice rules apply across languages — the translator is given the *register* (calm, declarative, literary) along with the strings.

---

## 14 · Performance budget

The app is currently shipping **940KB of CSS across 22 files** before any HTML or JS. This is not OK. Targets:

| Asset | Current | Target | Hard ceiling |
|---|---|---|---|
| CSS (uncompressed) | ~940KB | < 250KB | 350KB |
| CSS files loaded on initial paint | 22 | 1 (consolidated) | 3 |
| JS on initial paint (post-PIN) | ~1.4MB | < 500KB | 800KB |
| Time to interactive (4G mid-tier Android) | unknown | < 2.5s | 4s |
| Layout shift (CLS) on Home | unknown | < 0.05 | 0.1 |

The CSS consolidation plan is in §16. The JS audit is a separate document.

**Asset rule**: every file added to the load path needs a one-line justification. *"It was easier to put it in its own file"* is not a justification.

---

## 15 · Banned patterns

These are concrete things that will not appear in NEXUS again. PR rejection-level banned.

1. **A "fixes" or "polish" CSS file.** `equipment-fixes.css`, `equipment-card-polish.css` — these are technical debt by name. Patches go in the canonical file with a `/* PATCH 2026-04: ... */` comment.
2. **Inline `style="..."` attributes** outside of dynamic values (positioning a tooltip, sizing a canvas). All static styling lives in CSS files.
3. **Mixed token systems in one file.** A file uses `--nx-*` or `--accent` — never both. Migrating files is fine, half-migrated files are not.
4. **`<br>` for vertical rhythm.** Use spacing.
5. **`<hr>` as decoration.** Use spacing.
6. **Emoji as iconography.** Lucide icons exist for a reason. (The coin is not an emoji — it's an asset.)
7. **Toast for important information.** Toasts are ephemeral confirmations ("Saved", "Sent"). Errors that block work go in cards. Successes that the user needs later go in the log.
8. **Modal-on-modal-on-modal.** Two layers maximum. If you need a third, your flow is wrong.
9. **Hover-only affordances.** Every hover state must also work on tap.
10. **Animated GIFs.** If we need motion, it's CSS or canvas.
11. **Fonts not in our three-face system.** No Inter, no Roboto, no Helvetica, no Space Grotesk. Outfit / DM Sans / JetBrains Mono only.
12. **Greens that aren't olive bronze, reds that aren't oxblood, amber that isn't gold.** The palette is closed.
13. **`!important` outside of utility classes.** If the cascade is fighting you, fix the cascade.
14. **Inline AI completions in the UI without a `--nx-gold-line` accent.** When AI generates copy in-line, it must be visually distinguishable from user-authored content.

---

## 16 · CSS architecture — the cleanup plan

### 16.1 Diagnosis

```
22 files, 940KB total. Critical issues:

┌─ nexus.css                  171KB  legacy mega-file, mixed concerns
├─ nx-system.css               42KB  the canonical design system (good!)
├─ equipment.css               67KB  ──┐
├─ equipment-fixes.css         69KB    │  these three are ONE feature, fragmented.
├─ equipment-system.css        17KB  ──┤  fixes.css overrides equipment.css.
├─ equipment-card-polish.css    3KB    │  polish.css overrides both. textbook drift.
├─ equipment-context-menu.css  22KB  ──┘
├─ equipment-public-pm.css     16KB  ──┐  public PM scan — two files,
└─ equipment-public-pm-system.css 21KB ┘  same feature, drifted.
```

### 16.2 Target file structure

```
css/
├── nx-tokens.css           tokens only (extracted from nx-system.css)
├── nx-base.css             reset + body + html + global typography
├── nx-components.css       all .nx-* primitives (pills, cards, stats, inputs, ask)
├── nx-layout.css           nav, masthead, bnav, page wrappers
├── views/
│   ├── home.css            Home view only
│   ├── brain.css           Brain (galaxy + chat + node panel) — consolidates galaxy.css, chat.css, composer.css
│   ├── duties.css          consolidated cleaning + duties
│   ├── log.css             Log view (extracted from nexus.css)
│   ├── board.css           Board (kanban) — consolidates board-system.css
│   ├── calendar.css        Cal view
│   ├── equipment.css       ALL equipment styling, ONE FILE
│   ├── inventory.css       Inventory, ONE FILE
│   └── ingest.css          Ingest (admin/admin-system.css)
├── public.css              public-views.css renamed; QR scan flow + public PM
└── overrides.css           THIS FILE EXISTS FOR ONE REASON: emergency hot-patches.
                            Every entry has a date, a reason, and a "remove by" date.
```

That's roughly **13 files** (down from 22), with a clear cascade order:

```html
<!-- in <head> -->
<link rel="stylesheet" href="css/nx-tokens.css">       <!-- 1. tokens -->
<link rel="stylesheet" href="css/nx-base.css">         <!-- 2. reset + html/body -->
<link rel="stylesheet" href="css/nx-components.css">   <!-- 3. primitives -->
<link rel="stylesheet" href="css/nx-layout.css">       <!-- 4. nav/masthead -->
<link rel="stylesheet" href="css/views/home.css">      <!-- 5..N. views -->
... (other views)
<link rel="stylesheet" href="css/public.css">          <!-- public scan flow -->
<link rel="stylesheet" href="css/overrides.css">       <!-- LAST. emergencies only. -->
```

**Or**, post-overhaul, build a single `nexus.bundle.css` that concatenates these in order. One file in production, multiple files in source. Mobile devs don't have a build step — that's fine, ship the source files; the GZIP win is small relative to the maintenance win.

### 16.3 Migration order (proposed)

This is the suggested order to avoid breakage. Each step is a separate PR.

1. **Extract tokens** — pull all `:root` into `nx-tokens.css`. Verify nothing visually changes. *(low risk, high leverage)*
2. **Deprecate the legacy token aliases** in `nexus.css` — point `--accent` etc. at `--nx-gold` etc. so legacy CSS still works. *(zero visual change, sets up the migration)*
3. **Consolidate equipment** — merge equipment.css + equipment-fixes.css + equipment-card-polish.css + equipment-system.css + equipment-context-menu.css into `views/equipment.css`. Delete the originals. *(this is the biggest win — ~178KB → ~80KB after dedup)*
4. **Consolidate public-PM** — merge equipment-public-pm.css + equipment-public-pm-system.css.
5. **Extract `nx-base.css` and `nx-layout.css`** from `nexus.css`. *(splits the mega-file)*
6. **Extract per-view CSS** from `nexus.css` into `views/*.css`.
7. **Final pass**: search every CSS file for `--accent`, `--bg`, `--surface`, etc. Replace with `--nx-*`. Delete the legacy aliases.
8. **Add `overrides.css`** as the documented emergency-only file. Empty at start.

After step 7, the codebase has one token system. After step 8, there is no excuse to introduce a "fixes" file again.

---

## 17 · Definition of done — the screen ships when…

Before any view, screen, or component is considered shipped:

- [ ] Renders correctly in **dark and light** themes
- [ ] All four states defined: loading skeleton, empty, error, populated
- [ ] All tappable elements ≥ 44 × 44px
- [ ] Reads naturally with a screen reader (test with VoiceOver / TalkBack)
- [ ] Honors `prefers-reduced-motion`
- [ ] No literal hex colors in CSS — only `--nx-*` tokens
- [ ] No literal pixel values for spacing — only `--nx-space-*` tokens
- [ ] Section heading copy reads as editorial, not as a label ("On the books," not "Events")
- [ ] One primary action; everything else is secondary or quiet
- [ ] Works one-handed in portrait on a 6.1" phone
- [ ] All copy passes the voice rules (§10) — calm, short, declarative, no `!`
- [ ] If async: real-time subscription wired (or explicit decision not to)
- [ ] Tested with a slow network (Chrome DevTools "Slow 3G") — skeletons appear, no layout shift
- [ ] At least one i18n translation key per user-facing string

A screen that fails any of these is unfinished, not "shippable with caveats."

---

## 18 · What we'll do next

This document is the contract. The overhaul plan that follows it should be:

1. **Audit pass** — walk through all 9 views and grade each one against §17. Identify the worst offender.
2. **CSS consolidation** — execute §16.3 over a series of small PRs. This unblocks every other improvement.
3. **Component extraction** — for each `.nx-*` primitive in §8, identify all the one-off versions sprinkled across the codebase, and replace them with the primitive.
4. **View-by-view overhaul** — in this order: Home → Equipment → Board → Brain → Duties → Log → Calendar → Inventory → Ingest. Home first because it sets the bar; Equipment second because it's the most-used and the most-broken.
5. **Performance pass** — measure CLS, TTI, bundle sizes against §14. Fix the top three.
6. **Accessibility pass** — full TalkBack + VoiceOver run through every view. Fix all blocker-level issues.
7. **Living document** — every overhaul lesson goes back into this file.

---

## Appendix A · Open questions for next decision pass

These are choices that should be made before the overhaul starts but aren't urgent enough to block this document:

- **Tab nav model**: keep both top-nav (desktop) and bottom-nav (mobile), or unify to bottom-nav-only? Currently bottom-nav has 5 items, top has 7+more — they should match.
- **Notification stack**: the masthead has a `listenDot` + `notifyCount` next to NEXUS, plus `ticketBadge` in the util tray. Decide: one source of truth for "you have unread things," or two distinct badges (alerts vs. tickets)?
- **Two personas (Trajan/Providentia) — do they affect the rest of the UI** beyond the masthead coin? Or stay localized to the chat surface? Right now the answer drifts.
- **Library card** on Home — is this a permanent fixture, or does it get displaced when there's high-priority content? (Currently it's always above the lede.)
- **Public scan flow visual identity**: should it match the manager UI exactly, or is there a "lighter, anonymous, contractor-facing" variant? `public-views.css` exists but isn't fully scoped.

---

## Appendix B · Glossary

- **Editorial × terminal** — the brand voice. Display sans + mono caps. Magazine restraint + command-line dignity.
- **The coin** — the Trajan ↔ Providentia 3D-flip artifact. PIN-screen hero and persistent masthead element.
- **The lede** — the large display headline at the top of Home (e.g., *"Morning, Orion."*). Borrowed from print journalism.
- **The kicker** — the small mono-caps label above content (e.g., `OVERDUE`, `INCOMING`). Borrowed from print journalism.
- **The mark** — the single-glyph symbol used in empty states (◇, ◎). The visual signature of "the system has nothing to show, and that's fine."
- **Calm state** — an empty state that's *good* (nothing urgent, all clear). Distinct from a "broken" empty state.
- **The ritual** — the PIN → coin → app reveal. The one moment where cinematic motion is allowed.

---

*"Astra monstrat."*

The criteria are the stars. They point.
