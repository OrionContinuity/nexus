#!/usr/bin/env python3
"""Build the Living World datapack — 4 seasonal zips for clippys_world (MC 1.21.11).
Seasons change ONLY foliage (leaves/vines); grass untouched (Alfredo's ask).
Zones get warm-and-wondrous sky/fog tints (no dark or spooky anywhere).
Time engine: 40-min day/night — 28 min of sun, 12 min of gentle night."""
import json, zipfile, os, io

BIOMES = ["plains","sunflower_plains","forest","flower_forest","birch_forest",
          "old_growth_birch_forest","dark_forest","swamp","jungle","sparse_jungle",
          "savanna","taiga","meadow","cherry_grove","desert","river","beach","snowy_plains"]

# ── Warm & wondrous zone moods (season-independent) — subtle Dota-style area feel
ZONE = {  # biome -> {sky, fog} hex (None = leave vanilla)
  "desert":        {"sky":"#8fb8ff","fog":"#f5ddab"},   # warm golden haze
  "savanna":       {"sky":"#8fc0ff","fog":"#f0d9a8"},
  "beach":         {"sky":"#8cc0ff","fog":"#f0e6c8"},
  "jungle":        {"sky":"#79c1ff","fog":"#cfe8b8"},   # vivid green-gold light
  "sparse_jungle": {"sky":"#79c1ff","fog":"#d4e8bc"},
  "forest":        {"sky":"#7db3ff","fog":"#cfe6c2"},   # soft green-tinted light
  "flower_forest": {"sky":"#84b6ff","fog":"#dcead0"},
  "birch_forest":  {"sky":"#82b8ff","fog":"#e8ecc8"},   # amber-green glow
  "old_growth_birch_forest": {"sky":"#82b8ff","fog":"#e8ecc8"},
  "dark_forest":   {"sky":"#7db0ff","fog":"#c8dcc0"},   # kept BRIGHT (warm-only rule)
  "swamp":         {"sky":"#80b8ff","fog":"#cfe3c9"},   # bright teal-green, not murky
  "taiga":         {"sky":"#86bcff","fog":"#d4e4ec"},   # crisp
  "snowy_plains":  {"sky":"#9cc8ff","fog":"#e6f0fa"},   # bright crystalline
  "meadow":        {"sky":"#84baff","fog":"#dcebd2"},
  "cherry_grove":  {"sky":"#8caaff","fog":"#f2dcea"},   # soft pink air
  "plains":        {"sky":"#82b8ff","fog":"#dbeccc"},
  "sunflower_plains": {"sky":"#82b8ff","fog":"#e2eec8"},
  "river":         {"sky":"#80b6ff","fog":"#d8e8d8"},
}

# ── Seasonal foliage (leaves/vines ONLY — grass untouched)
def foliage(season, biome):
    fam = ("dark"  if biome=="dark_forest" else
           "birch" if "birch" in biome else
           "jungle" if "jungle" in biome else
           "conifer" if biome in ("taiga","snowy_plains") else
           "swamp" if biome=="swamp" else
           "cherry" if biome=="cherry_grove" else
           "warm" if biome in ("desert","savanna","beach") else "green")
    T = {
      "spring": {"green":"#6fce4d","dark":"#5cbf49","birch":"#77d355","jungle":"#5ecb52","conifer":"#63b558","swamp":"#79a24e","cherry":"#a8dd6a","warm":"#8fca57"},
      "summer": {"green":"#3f9636","dark":"#357f2e","birch":"#4da03c","jungle":"#3d9c3a","conifer":"#3f7d3a","swamp":"#647c38","cherry":"#8cc94f","warm":"#7fae43"},
      "autumn": {"green":"#d98a2b","dark":"#b5541f","birch":"#dfa93a","jungle":"#97a53a","conifer":"#a97833","swamp":"#8a7a3a","cherry":"#d9a25a","warm":"#c9922e"},
      "winter": {"green":"#7d8a5c","dark":"#6f7d52","birch":"#8a9161","jungle":"#6f8a52","conifer":"#6d7d55","swamp":"#707a4a","cherry":"#96a06a","warm":"#8f8f5c"},
    }
    return T[season][fam]

# ── Time engine (pack_format 94; 1.21 uses singular 'function' dirs)
# day 0..12999 (13000 ticks) over 28 min (33600 rt) -> 387 per-mille
# night 13000..23999 (11000 ticks) over 12 min (14400 rt) -> 764 per-mille
# NOTE: .mcfunction files are kept STRICTLY ASCII - a non-ASCII byte (an em-dash
# in a comment) made MC 1.21.11 treat living:load as unparseable => "missing
# reference" => the load-tag error is FATAL and the server refuses to start.
# TIME ENGINE v2 - ABSOLUTE control via a macro `time set`, so it needs NO
# `gamerule` (which can't parse in a function on this server) and works whether
# doDaylightCycle is on or off (we pin the time every tick, fully overriding
# vanilla). #dt = our slow daytime; it advances 1 game-tick every 2 real ticks
# => a 40-minute full day. #rt = the 0/1 real-tick divider.
TICK = """# Living World - long gentle days (~40 min), absolute clock
scoreboard players add #rt lw 1
execute if score #rt lw matches 2.. run function living:adv
execute store result storage living:clock Time int 1 run scoreboard players get #dt lw
function living:settime with storage living:clock
"""
ADV = """# advance our daytime by one game-tick, wrap at a full day
scoreboard players set #rt lw 0
scoreboard players add #dt lw 1
execute if score #dt lw matches 24000.. run scoreboard players set #dt lw 0
"""
SETTIME = """$time set $(Time)
"""
# LOAD seeds the counters from the world's current time so the clock continues
# smoothly across restarts (no jarring jump to dawn). NO gamerule here.
LOAD = """# Living World boots - set up the slow clock
scoreboard objectives add lw dummy
execute store result score #dt lw run time query daytime
scoreboard players set #rt lw 0
"""

def build(season):
    buf = io.BytesIO()
    z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    # MC 1.21.11: for pack_format > 81 the pack.mcmeta MUST carry min_format +
    # max_format ([major,minor]) or MC refuses the metadata ("missing mandatory
    # fields min_format and max_format") and never loads the pack's functions -
    # which made living:load "missing" and the load-tag error FATAL. 94.0..94.1
    # covers 1.21.11 (data_pack_version 94, minor 1).
    z.writestr("pack.mcmeta", json.dumps({"pack":{
        "pack_format": 94,
        "min_format": [94, 0],
        "max_format": [94, 1],
        "description": "Living World · %s — seasons in the leaves, long gentle days, wondrous zones (Clippy's world)" % season}}, indent=1))
    # Ship functions + tags in BOTH the singular (1.21+) and plural (<1.21)
    # directory names so the pack resolves regardless of how this exact server
    # build reads them - the living:load "missing reference" persisted even with
    # valid metadata + ASCII, which points at a function-dir resolution quirk.
    for fdir in ("function", "functions"):
        z.writestr("data/living/%s/load.mcfunction" % fdir, LOAD)
        z.writestr("data/living/%s/tick.mcfunction" % fdir, TICK)
        z.writestr("data/living/%s/adv.mcfunction" % fdir, ADV)
        z.writestr("data/living/%s/settime.mcfunction" % fdir, SETTIME)
        z.writestr("data/minecraft/tags/%s/load.json" % fdir, json.dumps({"values":["living:load"]}))
        z.writestr("data/minecraft/tags/%s/tick.json" % fdir, json.dumps({"values":["living:tick"]}))
    for b in BIOMES:
        d = json.load(open("biomes/%s.json" % b))
        d.setdefault("effects", {})["foliage_color"] = foliage(season, b)
        zt = ZONE.get(b)
        if zt:
            attrs = d.setdefault("attributes", {})
            if zt.get("sky"): attrs["minecraft:visual/sky_color"] = zt["sky"]
            if zt.get("fog"): attrs["minecraft:visual/fog_color"] = zt["fog"]
        z.writestr("data/minecraft/worldgen/biome/%s.json" % b, json.dumps(d, indent=1, sort_keys=True))
    z.close()
    out = "/home/user/nexus/world/living-world-%s.zip" % season
    open(out, "wb").write(buf.getvalue())
    return out, len(buf.getvalue())

for s in ("spring","summer","autumn","winter"):
    p, n = build(s)
    print("built", p, n, "bytes")
