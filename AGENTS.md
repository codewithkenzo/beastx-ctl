# beastx-ctl

Local configurator for the WLMouse Beast X 4K receiver (`36a7:a887`, wch.cn "Wireless Gaming Mouse") on Linux. The official web hub (gm.wlmouse.gg) does not list this PID; the vendor ships only a Windows desktop driver. We recover the HID protocol from our own copies of the vendor software and our own device, then reimplement it clean-room.

## Shape

- `apps/web`: TanStack Router SPA (Vite 8, React 19.3, Tailwind 4, Base UI), WebHID in Chromium/Helium. Local only: no server, no SSR, so Router without Start.
- `packages/protocol`: pure TS, no DOM. Packet build/parse, checksum, Effect `Schema` for every report decoded from the device. Unit tested with golden packets from `docs/PROTOCOL.md`.
- No Electron: Chromium already exposes WebHID here and the nixos-config udev rule `70-wlmouse-hid.rules` gives the seat user rw on all three interfaces. A desktop shell later, if ever, is Electrobun.
- Stack picks and gates: `~/.agents/skills/kenzo-stack/SKILL.md`, `references/web.md`, `references/scaffold.md`.

## Inputs (read-only)

- `device/`: live captures from the real receiver (lsusb -v, report descriptors per interface, udev props). Facts, not guesses.
- `refs/` (gitignored, see `refs/SOURCES.md`): vendor Windows driver unpacked (`refs/driver/app/WLmouse.exe`, native C++/DuiLib), gm.wlmouse.gg JS bundles (sibling models, same vendor), `rrroyal/wlmouse-beastx` (sniffed packets for this exact PID), `mee7ya/wlmouse-cli` (Rust, battery read).

## Device safety (hard rules)

- Never send anything on a firmware update, DFU, bootloader, pairing or factory-reset path. If a command's purpose is unknown, do not send it.
- Static analysis first. A packet goes to the device only when its layout and checksum are proven from code or captures, and `docs/PROTOCOL.md` cites the evidence.
- Read before write: a backup (`device/backup-<date>.json`) must exist before the first write. The app remembers the backup and the Experimental switch across reloads (owner decision 2026-11-17), so this is once per browser, not per session. One setting per write, read back after.
- Interface 01 is the plain mouse report; never write to it.
- Interface 00 mixes a keyboard collection with vendor page 0xFF1C (report ID 4, 63-byte output/input): Chromium hides the keyboard collection, the vendor one stays usable. Interface 02 is consumer page 0x0C with a 64-byte feature report.

## Work

- Plans and notes in `.pi/` (gitignored); tickets via `tk`.
- Facts, inferences and unknowns stay separate in `docs/PROTOCOL.md`, each with file+function/address or capture evidence.
- One dev server at a time; agents never start a second one.
- Commits: `type(scope): subject`, one verified change each.

## Commands

- `bun install` at the root; `lefthook` hooks install on `prepare`.
- `bun run --filter ./packages/protocol test`: package tests (vitest).
- `bun run --filter ./packages/protocol typecheck`: tsrs; `typecheck:effect` runs effect-tsrs.
- `bun run check`: full gate (lead only; subagents never run it).
- `bun run lint`, `bun run format:check`, `bun run knip`, `bun run complexity`.
