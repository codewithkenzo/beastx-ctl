# apps/cli

`beastx status` (one JSON line) and `beastx watch` (a line per change, 5 s checks) for a Wayle custom module. Built with `bun build --compile` to `dist/beastx`.

## Shape

- `src/main.ts`: composition root. Wires `Sysfs` and `HidRaw` layers, prints the line, sets the exit code.
- `src/status.ts`: `Reading` to `ModuleLine` mapping, and the ping, battery, active-profile, stage-chunk exchange.
- `src/watch.ts`: the 5 s loop; prints only changed lines; a failed check goes to stderr and the loop continues.
- `src/receiver.ts`: finds the receiver by `HID_ID` and interface `00`, checks the vendor collection `06 1c ff`, matches replies by report ID, length, and cmd.
- `src/sysfs.ts`, `src/hidraw.ts`: the two IO services (`beastx/Sysfs`, `beastx/HidRaw`). Only these touch `node:fs`.
- `src/errors.ts`: `IoError` and the Node error decoding.
- Protocol bytes come from `@beastx-ctl/protocol`. Do not rebuild frames here.

## Device rules

- Only the read-only commands `0xaa` (ping), `0x1a` (battery) and `0x05` (config read) are sent. Never open interface 01 or 02.
- Keylogger safe: the hidraw fd is open only inside one check (`Effect.scoped`), never between checks.
- Foreign reports (keyboard collection, other readers) are dropped after reading bytes 0 and 3: never stored, printed, logged or put in an error, on any path. No raw-frame debug output in shipped code.
- No files written, no network.
- Never hardcode hidraw numbers. Discovery goes through sysfs.
- Reports from other readers and other commands are skipped, because hidraw delivers every input report to every reader.

## Checks

- `bun run --filter ./apps/cli test`
- `bun run --filter ./apps/cli typecheck`
- `bun run --filter ./apps/cli build` (the output is a binary; keep it in `dist/`, do not install it)
