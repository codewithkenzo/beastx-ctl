---
version: alpha
name: beastx-ctl
colors:
  surface-1: "#EFE4D8"
  surface-2: "#F4E9DD"
  surface-3: "#F9EEE2"
  surface-4: "#F9EEE2"
  surface-5: "#F9EEE2"
  surface-6: "#F9EEE2"
  surface-7: "#F9EEE2"
  surface-8: "#F9EEE2"
  foreground: "#1F2633"
  muted-foreground: "#5E5850"
  border: "rgb(31 38 51 / 0.06)"
  primary: "#AE4700"
  primary-foreground: "#EFE4D8"
  destructive: "#9C3D2E"
  destructive-light: "#E5D0C4"
  hover: "rgb(31 38 51 / 0.04)"
  active: "rgb(31 38 51 / 0.07)"
  selected: "#E8D8C9"
  tint: "rgb(31 38 51 / 0.08)"
  tint-hover: "rgb(31 38 51 / 0.065)"
  focus-ring: "#AE4700"
  track: "#F9EEE2"
  hatch: "#BBC5D6"
  field-border: "#737C8C"
  chart-ink: "#1F2633"
  glyph-ground: "#EFE4D8"
  spot: "#4B607F"
  ok: "#306B16"
  warn: "#895200"
  group: "#E8D8C9"
  surface-1-dark: "#221D18"
  surface-2-dark: "#29241F"
  surface-3-dark: "#302B25"
  surface-4-dark: "#37322C"
  surface-5-dark: "#3E3933"
  surface-6-dark: "#45403A"
  surface-7-dark: "#4C4741"
  surface-8-dark: "#544F49"
  foreground-dark: "#E8D8C9"
  muted-foreground-dark: "#B2A79C"
  border-dark: "rgb(232 216 201 / 0.06)"
  primary-dark: "#FC782A"
  primary-foreground-dark: "#221D18"
  destructive-dark: "#FFAE96"
  destructive-light-dark: "#35302B"
  hover-dark: "rgb(232 216 201 / 0.06)"
  active-dark: "rgb(232 216 201 / 0.1)"
  selected-dark: "#2E2924"
  tint-dark: "rgb(232 216 201 / 0.25)"
  tint-hover-dark: "rgb(232 216 201 / 0.2)"
  focus-ring-dark: "#FC782A"
  track-dark: "#302B25"
  hatch-dark: "#534639"
  field-border-dark: "#817365"
  chart-ink-dark: "#E8D8C9"
  glyph-ground-dark: "#221D18"
  spot-dark: "#8FA3C4"
  ok-dark: "#56CB98"
  warn-dark: "#D5AB42"
  group-dark: "#302B25"
typography:
  display:
    fontFamily: "Newsreader"
    fontSize: 28px
    lineHeight: 34px
    fontWeight: 700
  title:
    fontFamily: "Newsreader"
    fontSize: 16px
    lineHeight: 22px
    fontWeight: 550
  subtitle:
    fontFamily: "Onest"
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 400
  body:
    fontFamily: "Onest"
    fontSize: 13px
    lineHeight: 20px
    fontWeight: 400
  caption:
    fontFamily: "Onest"
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 400
  micro:
    fontFamily: "Onest"
    fontSize: 11px
    lineHeight: 14px
    fontWeight: 400
rounded:
  xs: 2px
  control: 4px
  container: 10px
  ring: 6px
  merged: 4px
spacing:
  s2: 2px
  s4: 4px
  s8: 8px
  s12: 12px
  s16: 16px
  s24: 24px
  s32: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    typography: "{typography.body}"
    height: 36px
  text-muted:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
  text-error:
    backgroundColor: "{colors.destructive-light}"
    textColor: "{colors.destructive}"
    typography: "{typography.caption}"
---

## Overview

beastx-ctl is a local web app that configures the WLMouse Beast X 4K receiver on Linux, in place of the Windows driver. It runs in Chromium or Helium, talks to the receiver over WebHID, and has no server and no accounts. Version 1 covers three screens: Connect, Mouse and DPI. Every write is read back from the mouse.

The page is a print. Warm paper or ink ground, one living glyph-art subject per screen, and figures set beside it like margin notes.

## Colors

The ground is paper (light) or ink (dark). Both are warm and flat, with no blue cast, grid, glow or vignette on the page itself. Every mark is ink on paper: ink fill for what is used, done or true, and etched hatch for what is left, possible or empty. On a usage meter the used fill takes the plate colour.

Colour comes from four families: ink, paper, one subject ramp and one plate. Error and status hues appear on data only. A group is a fill step up the surface ladder; selection is one more step. A field has a 1 px `field-border` boundary, 3:1 against the page, because a fill step alone disappears on paper.

### Themes

Three palettes ship, each in a paper and an ink mode. The default is `gao-ji-gan` (persimmon plate).

- `flexoki`: blue plate.
- `gao-ji-gan`: persimmon plate. Default.
- `everforest`: green plate.

The plate also colours the dormouse's coat. The ground follows the system by default, and the shell can set paper or ink. The palette and ground choice are stored on the device. Palettes change colour roles only; spacing, radius, type and motion are shared.

## Typography

Newsreader sets H1 and H2 with its optical size axis: upright, sentence case, tracking 0. Onest sets all other text, and every figure is `tabular-nums`. Fragment Mono sets IDs, keys, times, hex values and the write log. It never sets a heading.

| Role     | Size / line | Font       | Weight |
| -------- | ----------- | ---------- | ------ |
| display  | 28 / 34 px  | Newsreader | 700    |
| title    | 16 / 22 px  | Onest      | 550    |
| subtitle | 14 / 20 px  | Onest      | 400    |
| body     | 13 / 20 px  | Onest      | 400    |
| caption  | 12 / 16 px  | Onest      | 400    |
| micro    | 11 / 14 px  | Onest      | 400    |

The scale is the template scale. Latin only.

## Layout

Density is airy: a control is 36 px tall, and the gap between controls is 8 px. Spacing steps are 2, 4, 8, 12, 16, 24 and 32 px on a 4 px base. Groups take at most two levels of nesting, with no card inside a card and no border or divider between groups. Space and fill steps separate content.

## Elevation & Depth

Depth comes from fill steps. A shadow appears only on a layer that floats above the page: a menu, a dialog or a tooltip. Stacking uses the token z-layers: base 0, link 20, action 30, popup 50, drag 200.

## Shapes

One radius family, by role: groups and nav selection use 10 px; fields and buttons use 4 px; focus rings use 6 px. Meters and chart cells are square-ended. A screen uses at most three radii.

## Components

- **Usage meter.** A track 8 px high with square ends, one ladder step above its surface. Inside the track, etched hatch at 45 degrees, one ink step above the track. Used is the fill from the start edge, in the plate colour. A margin note beside or above the bar gives the figure (`62%`, `6.2 of 10 GB`), and the figure is the non-colour cue. Above 90%, the fill and the figure take the error role. With no data, asleep or off: an empty hatched track, the figure is an en dash, and the row text is muted.
- **Status dot.** An 8 px static circle, always followed by a word (`Online`, `Asleep`, `Failing`). It appears only on a row with a live state and never pulses.
- **Dashed slot.** A 1 px dashed outline means nothing is here yet and something can go here: an empty slot or a drop target. It never groups content.
- **Icons.** kubai-icons-react, 16 px in the default size and 14 px in the compact size. Every action, nav item and tab has one, and it plays on state.

## Do's and Don'ts

These exceptions hold only in the role each names. Anywhere else they do not apply.

- Do: a living glyph-art subject on every surface, acting by state: one live stage per page, other subjects as loop videos, posters first.
- Do: ink fill for used, etched hatch for remaining, on usage meters only.
- Do: stipple, screentone and woodblock tiers inside subjects and chart marks only.
- Do: error role on fill and figure above 90%.
- Do: Newsreader for H1 and H2; Onest for text and figures; Fragment Mono for IDs and times.
- Do: kubai icons on every action, nav item and tab; played on state.
- Do: paper and ink grounds; one plate colour with a 1 px register offset on bright subject cells.
- Do: 1 px dashed outline on empty slots and drop targets only.
- Don't: scanlines, HUD readouts, hatch or dither on a background, card or button; no ASCII or noise field on the ground.

## Motion

Subjects act on 8 s seamless loops: a hazel dormouse holding a nut on a hazel twig. It is asleep on Connect, awake on Mouse, and sheltering on a write error. Icons play on state. A meter may fill once on first view.

UI motion uses the token springs: fast 80 ms, moderate 160 ms, slow 240 ms (bounce 0.12). Enters use ease-out; exits use ease-in. An icon swap blurs 4 px and scales to 0.6.

Reduced motion: every subject shows its poster, values appear at once, and UI motion reduces to fades. The app root sets `MotionConfig reducedMotion="user"`. There is no route transition, no counting number, no pulse, no scroll reveal and no custom cursor.

## Copy

Voice: precise, technical, terse. Precise: exact values, units and states (`Battery 72%. Charging.`). Technical: the protocol fact where it helps verify a write (`Polling 2000 Hz, written to block[11], read back 2000 Hz`). Terse: the result first, nothing else. Every error says whether the mouse changed.

Defaults: contractions yes, em dashes no, exclamation marks never, the person is "you", Oxford comma yes. Hex, opcodes and offsets appear where they help verify (write log, experimental switch, backup), never as the only label. Strings live in the message catalogue in ICU form. The locale is en only.

| Concept | Use | Never use |
| --- | --- | --- |
| The Beast X 4K itself | mouse | device (in UI), peripheral |
| The USB dongle | receiver | dongle, adapter |
| One configurable value | setting | option, preference |
| One DPI step | stage | level, preset |
| Stored settings set on the mouse | profile | slot, mode |
| Saved JSON of the read settings | backup | snapshot, export |
| Send a setting / read it again | write / read back | apply, save, sync |
| Code-proven, not yet verified on the mouse | experimental | beta, unsafe, unverified |

## Scope

Version 1 has three screens:

- **Connect.** First run. No mouse connected; a WebHID pick for the receiver; a forced settings backup before the first write. The subject is asleep.
- **Mouse.** The dense overview: battery meter, polling, lift-off, sleep, motion sync, debounce and the experimental switch. The subject is awake.
- **DPI.** A form with eight stages: X, Y, colour and the active stage. Each row reads `Stage {index}`.

later: Lighting; Buttons; Profiles; Display (OLED); Firmware; Electrobun desktop shell.
