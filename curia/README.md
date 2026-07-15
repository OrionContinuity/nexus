# The Curia — Clippy's local, tiered brain

Standalone modules for running Clippy's cognition locally on one GPU (the RTX 3070 on N6). Not yet wired into `clippy_agent.js` / the clippy-pool — reviewed, tested design, staged for integration behind a flag.

- `curia_formulary.js` — the Formulary: reusable task-drafts with fill-in `{blanks}`. Dependency-free. 18 tests pass.
- `curia_brain.js` — the Consul (router) + tier clients (Ollama :11434 / llama.cpp :8080) + tick loop. 21 tests pass.
- `curia_up.ps1` — launch sheet: model picks for 8 GB, llama.cpp Augur (speculative decoding), VRAM budget, keep-warm loop.

Eight parts: Vigil (reflex/VRAM) · Senate (deliberation/RAM) · Augur (speculative decoding) · Consul (router) · Formulary (reusable drafts) · Watch (small VLM) · Archive (RAG memory) · Vesta (keep-warm). Before it drives the live companion: structured world-state, per-step verification + rollback, an independent safety check per replayed step, draft invalidation.
