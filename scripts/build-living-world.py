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
TICK = """# Living World — long gentle days (28 min sun / 12 min night)
execute store result score #day lw run time query daytime
execute if score #day lw matches ..12999 run scoreboard players add #acc lw 387
execute if score #day lw matches 13000.. run scoreboard players add #acc lw 764
execute if score #acc lw matches 1000.. run time add 1t
execute if score #acc lw matches 1000.. run scoreboard players remove #acc lw 1000
"""
LOAD = """# Living World boots — take over the clock
scoreboard objectives add lw dummy
gamerule doDaylightCycle false
"""

def build(season):
    buf = io.BytesIO()
    z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    z.writestr("pack.mcmeta", json.dumps({"pack":{
        "pack_format": 94,
        "description": "Living World · %s — seasons in the leaves, long gentle days, wondrous zones (Clippy's world)" % season}}, indent=1))
    z.writestr("data/living/function/load.mcfunction", LOAD)
    z.writestr("data/living/function/tick.mcfunction", TICK)
    z.writestr("data/minecraft/tags/function/load.json", json.dumps({"values":["living:load"]}))
    z.writestr("data/minecraft/tags/function/tick.json", json.dumps({"values":["living:tick"]}))
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
