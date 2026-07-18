# 🍂 The Living World — seasons, long days, wondrous zones

A vanilla datapack for `clippys_world` (MC **1.21.11**, pack_format 94). No mods,
no client installs — server-side only, works for the child's vanilla Java client
and every bot.

## What it does
- **Seasons — only the leaves turn.** Weekly rotation (spring → summer → autumn
  → winter), deterministic from the calendar (week of 2026-07-13 = spring).
  Each season re-tints `foliage_color` per biome family (oaks gold, dark forest
  rust, birch amber in autumn...). **Grass is never touched** (keeper's rule).
  Note: spruce & birch leaf textures are hard-coded by the game and won't turn;
  oak/dark-oak/jungle/acacia/mangrove/vines all do.
- **Long gentle days.** `doDaylightCycle off` + a tick function paces time:
  **28 min of sun, 12 min of night** (40-min full day). Asymmetric on purpose —
  long play days, short kind nights.
- **Zone mood (Dota-style), warm & wondrous only.** Per-biome
  `minecraft:visual/sky_color` + `fog_color`: golden desert haze, green forest
  light, pink cherry air, crisp snowfields, bright teal swamp. Nothing dark,
  nothing spooky — a 3-year-old lives here.

## How it flows
1. Four zips live here: `living-world-<season>.zip` (built by
   `scripts/build-living-world.py`, which fetches vanilla 1.21.11 biome JSONs
   from misode/mcmeta and patches only what we own).
2. **Clippy installs his own seasons** (clippy_agent.js, soulWriter only):
   every 10 min he checks the calendar season vs `trainserver/lw-season.txt`;
   on change he downloads the season zip into
   `clippys_world/datapacks/living-world.zip`.
3. The server picks it up **at boot**. If the world is empty of humans, Clippy
   cycles the server himself so it applies immediately; otherwise it applies on
   the next natural restart. He announces the season in-game, once: *"look!!
   the leaves are turning gold!! 🍂"*
4. Removing the feature: delete the zip + `lw-season.txt`; vanilla returns at
   next boot (`gamerule doDaylightCycle true` to give the clock back).
