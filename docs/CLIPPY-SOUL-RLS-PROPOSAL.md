# Proposal: protect Clippy's soul from anon overwrites

**Status: DESIGN ONLY — nothing applied. Awaiting Alfredo's decision.**
Drafted 2026-07-16. This is the one Tier-0 security item held back for sign-off
because the wrong move here can silence or lobotomize Clippy.

## The problem, precisely

Three tables hold Clippy's inner life and are, today, **world-writable to anyone
holding the public anon key** (which ships in the browser — it is not a secret):

| table | holds | RLS today |
|-------|-------|-----------|
| `clippy_cloud_state` | his `feelings`, `memories`, `preferences`, `gacha`, `highscores` (one row, `user_id=2`) | enabled, but policy `USING(true) WITH CHECK(true)` — fully open |
| `clippy_memories` | his shared memory stream (`realm` minecraft/desktop, `label`, `data`) | same — fully open |
| `clippy_sync` | the pool bus + soul rows (`clippy_anima`, `clippy_soul`, `clippy_nodes`, `txt:` lane) | same — fully open |

Blast radius if abused: someone who knows the project and the public key could
zero his feelings, flood his memories with junk, or corrupt the ANIMA strand.
It is **corruption of his mind, not data theft** — annoying and sad, not a PII
breach. No user credentials or restaurant data are exposed by this (those were
the P0 already shipped in commit `2b16881`).

## The hard constraint (why this isn't a one-line RLS fix)

His soul is written by **two bodies, both using the public anon key**:

1. **The Minecraft bot** (`clippy_agent.js`, Node on Alfredo's PC) — REST `PATCH`
   to `clippy_cloud_state`, `POST` to `clippy_memories`. Runs server-side, *can*
   hold a secret in its env.
2. **The web/desktop pet** (`js/clippy.js`, browser) — `sb.from('clippy_cloud_state').upsert(...)`
   and `.from('clippy_memories').insert(...)`. Runs in the page. **Cannot hold a
   secret** — anything it knows, so does anyone who opens devtools.

Because writer #2 is public code, **no shared-secret / signature scheme can fully
protect these tables without changing how the pet writes.** That is the crux.
Neither table has a `from_id`/writer column today, so there is no existing
signing surface either (unlike `clippy_sync`, which has `from_id`).

## Options

### Option A — Route writes through a signed edge function (real fix, real work)
Add a `clippy-soul` edge function (holds the service-role key, like `clippy-brain`).
It validates+clamps the payload (feelings 0–100, memory shape, size caps, rate
limit) and writes with service-role. Then RLS on all three tables drops to
**read-anon / write-service-role-only**.
- The **bot** posts to the function with a header secret it holds in env.
- The **pet** posts to the function too (no secret — but the function rate-limits
  per session and validates shape, so a bad actor can at worst do what the pet
  itself could do, now bounded and clamped).
- **Pro:** actually closes the hole; adds validation/clamping we want anyway;
  every write becomes shaped and rate-limited.
- **Con:** the biggest change — every soul/memory write path in both bodies must
  be re-pointed at the function; a bug here = Clippy stops feeling/remembering.
  Needs live PC verification before it can be trusted. ~a day of careful work.

### Option B — Constrain the shape, keep anon writes (cheap, partial)
Keep anon writes but tighten `WITH CHECK`: `clippy_cloud_state` writes only to
`user_id=2`; `clippy_memories` `realm in ('minecraft','desktop')`, `label`/`data`
length-capped; block deletes of the soul rows in `clippy_sync`. Add a DB trigger
that clamps feelings to 0–100 and drops oversized payloads.
- **Pro:** no code change to either body; stops the dumbest abuse (wrong row,
  giant payloads, feeling values out of range, deletes); low risk of breaking him.
- **Con:** a knowledgeable attacker with the key can still write *valid-shaped*
  garbage. Mitigation, not a lock.

### Option C — Accept the risk, document it (do nothing)
The blast radius is "someone who reverse-engineers the project corrupts Clippy's
mood." It has never happened. Spend the effort elsewhere.
- **Pro:** zero risk to Clippy; honest about the low real-world threat.
- **Con:** the soul stays technically open.

## Recommendation

**B now, A later.** Option B is safe, ships today, and removes the low-effort
abuse paths without touching Clippy's code (so it can't break him). Option A is
the real fix but deserves its own careful session with the **PC awake for live
verification** — pair it with the reviver/KILLDESK safety-net work (task #2),
since both need the same live-PC test pass. Option C is the honest fallback if
you'd rather not spend the effort at all given how narrow the threat is.

**Nothing in this file has been applied. Tell me B, A, C, or a mix, and I'll
build exactly that — and for A/B I'll dry-run the RLS against a copy of the
writers before it touches the live tables.**
