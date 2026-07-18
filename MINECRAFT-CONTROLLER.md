# Minecraft controller (Logitech F310) — integrated into Clippy

Goal: the child plays Minecraft with a **Logitech F310** gamepad, and the whole
controller layer is managed by the **Clippy daemon** so it lives in one place.

## Two facts that shape everything

1. **The mineflayer bot (Clippy) needs no controller.** It's a headless Node
   bot that speaks the protocol directly — it never opens the graphical client.
   The F310 work touches **only the child's Java client**, fully independent of
   the bot. Zero risk to Clippy.
2. **Java Edition has no native controller support** (Bedrock does). So you
   either add an in-game mod or run an external gamepad→keyboard/mouse mapper.

## F310 hardware

- Keep the **rear switch on `X` (XInput)** for every approach — it enumerates as
  a standard Xbox 360 controller and needs **no driver install** (Windows'
  built-in XInput handles it). `D` (DirectInput) is only for legacy tools; don't
  use it here. — [Logitech support](https://support.logi.com/hc/en-us/articles/360023398693)

## The two paths

| | **antimicrox** (chosen default) | **Controllable mod** (best feel) |
|---|---|---|
| Works with | **vanilla Java** (no mods) | **modded Java** only (Forge/NeoForge/Fabric) |
| Cost / license | Free, GPL-3, open-source | Free, open-source |
| Camera feel | stick→mouse is slightly floaty | native analog (best for a 3yo) |
| Automatable | **yes** — `winget` install + `--profile` launch | yes — drop a version-matched `.jar` in `mods/` |
| Install | `winget install -e --id AntiMicroX.antimicrox` | copy pinned jar → `%APPDATA%\.minecraft\mods\` |

**We integrated the antimicrox path** because it's universal (works on vanilla
Java, no mod-loader/version matching) and fully scriptable. If the child's
client is modded, **Controllable** (drop the jar) gives noticeably better camera
control — switch to it then.

## What the daemon does (opt-in, already wired in `clippy-daemon.ps1`)

Guarded exactly like the grok bridge — **no-op on every machine** until you
enable it on the PC:

```
enable:   create  %LOCALAPPDATA%\NexusClippy\controller.on   (or  ~\.clippy\controller.on)
```

Once enabled, the daemon's supervisor loop (`Tick-Controller`):
- installs antimicrox via winget the first time,
- **detects which registered game is running** (see *Multiple games* below) and
  **starts** the hidden mapper with **that game's profile**,
- **swaps the profile** (mapper restart) when the child switches games,
- **stops** it when the game (or the opt-in flag) goes away.

## Multiple games — the registry (`controller-profiles.json`)

The controller layer is game-agnostic. `controller-profiles.json` (repo root,
synced to nodes like everything else) lists every supported game:

```json
{ "games": [ { "name": "minecraft", "title": "Minecraft Java",
    "profile": "minecraft.gamecontroller.amgp",
    "proc": "^javaw?\\.exe$", "cmdline": "(?i)minecraft" } ] }
```

- `proc` — regex on the process name; `cmdline` — optional regex the command
  line must also match. First match wins, top to bottom.
- **Adding a game = commit its `.amgp` profile + one registry entry.** The
  daemon syncs any profile the registry names — no daemon edits, no reinstall.
- A missing/broken registry falls back to the built-in Minecraft entry, so play
  never bricks.

If no committed profile is present it loads antimicrox's own saved/default
profile — so creating the mapping once in the GUI (below) is enough; the daemon
just turns it on/off with the game.

## The toddler button map (F310 in X mode)

Encode this once in the antimicrox GUI (mirrors the Bedrock/Xbox default so it
feels like console Minecraft). The six that matter most for the youngest player
are **bold**.

| F310 control | Action | Keyboard/mouse |
|---|---|---|
| **Left stick** | **Move** | W / A / S / D |
| Left stick press (L3) | Sprint | Left-Ctrl |
| **Right stick** | **Look** | Mouse X / Y |
| **A** | **Jump** | Space |
| **B** | **Sneak** | Left-Shift (hold) |
| X | Inventory | E |
| Y | Swap hand | F |
| **RT** | **Break / attack** | Left mouse |
| **LT** | **Use / place** | Right mouse |
| LB / RB | Hotbar prev / next | Wheel up / down |
| D-pad Down | Drop | Q |
| Start (≡) | Pause | Esc |

For the youngest player, start with only the six bold rows and add the rest as
they grow.

## Bring-up steps (do these live on the PC — e.g. the 4pm session)

The button map is **already committed** as `minecraft.gamecontroller.amgp` (repo
root → pulled to `%LOCALAPPDATA%\NexusClippy` by the daemon), so this is a
**verify**, not a build.

1. F310 rear switch → **X**. Plug in; confirm Windows sees "Xbox 360 Controller".
2. `New-Item "$env:LOCALAPPDATA\NexusClippy\controller.on" -Force` (enables the
   daemon integration).
3. Launch Minecraft once — the daemon installs antimicrox (**machine-scope: accept
   the one-time UAC prompt**) and starts it hidden with the committed profile.
4. In-game, spot-check the map: **left stick walks, right stick looks, A jumps,
   RT breaks, LT places, B sneaks.** If a control is off, it's a one-index tweak
   in the antimicrox GUI (the indices were derived from a reference Xbox 360
   profile, not this exact F310) — then `Save` over the same file.
5. Tune stick sensitivity (`mousespeed`/`deadZone`) in the GUI if the camera
   feels too fast/slow for the child.

## Sources
- Controllable — mrcrayfish.com/mods/controllable · MidnightControls — github.com/TeamMidnightDust/MidnightControls
- antimicrox — github.com/AntiMicroX/antimicrox (CLI: antimicrox.github.io/guide/commandline.html)
- JoyToKey ($7 alt, scriptable) — joytokey.net/en/advanced
- F310 X/D switch — support.logi.com/hc/en-us/articles/360023398693
- Bedrock/controller default layout — minecraft.wiki/w/Tutorial:Playing_with_a_controller
