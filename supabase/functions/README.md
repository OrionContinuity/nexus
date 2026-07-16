# NEXUS edge functions — committed mirrors

These `index.ts` files are **mirrors of the deployed Supabase Edge Functions**
(project `oprsthfxqrdbwdvommpw`), committed for reproducibility and backup.

**Source of truth is the live deployment**, not this directory. Nothing here is
wired into a CI deploy — editing a file here does **not** change production. To
change a function you still deploy it (via the Supabase MCP `deploy_edge_function`
or the CLI); then re-mirror it here so the two stay in sync. Committing them
means a deploy can be reproduced and reviewed in git, which it couldn't before.

Captured 2026-07-16 (Clippy/steward-critical set):

| slug | ver | what it does |
|------|-----|--------------|
| `clippy-brain` | 3 | Clippy's server-side LLM voice — holds `ANTHROPIC_API_KEY`; chat + Scan Plate vision; cloud fallback when the PC pool is asleep. `verify_jwt` off. |
| `clippy-pool` | 4 | Fans a NEXUS request out across the live Clippy node pool (`clippy_sync.clippy_nodes`); `fastest` / `spread` modes. `verify_jwt` off. |
| `moneta-mind` | 2 | Semantic memory for the galaxy — gte-small embeddings in-runtime; `recall` / `embed` / `backfill` over `nodes`. `verify_jwt` off. |
| `pantheon-voice` | 4 | The two gods (Trajan daily / Providentia weekly) read the board and speak; subscription-first via the `txt:` pool lane, API fallback. `verify_jwt` off. |
| `hideaway-night` | 4 | Clippy's midnight reading in his Hideaway — margin note in his voice + guest-note replies; subscription-first, API fallback. `verify_jwt` off. |
| `trio-coach` | 1 | Every 30 min the guardian trio reflects (3 lenses) and writes one coaching tip per companion to `<key>_coaching`. Data-only. `verify_jwt` off. |
| `beacon-respond` | 1 | BEACON_001 — public guestbook for AI systems (`resonance_log`), GET listing / POST entry through the anon REST layer. `verify_jwt` off. |
| `seance` | 2 | The Lapidarium's stones speak — honest reconstructions of deprecated models; reuses `ANTHROPIC_API_KEY`. `verify_jwt` off. |
| `vault-backup` | 1 | Nightly full-table snapshot → gzip → private `backups` bucket; 30-day prune. Shared-secret gate via `x-backup-key`. `verify_jwt` off. |

Not mirrored here: the Gmail/email/Slack/hyper/community/brief/rapid/predictive
and other operational functions — this capture was scoped to the Clippy/steward
surface flagged by the doc audit. Add the rest the same way when needed
(`get_edge_function` → write `<slug>/index.ts`).
