# Battery and device status: Beast X 4K receiver (`36a7:a887`)

Date: 2026-11-17. Session `battery`, ticket tic-a6f2. Static only: no device contact, no vendor binary run, wlmouse-cli not built or run.
Sources: `refs/wlmouse-cli` (HEAD `36541f66e0b43e4bf13e7f9b05fb0ee194287f8c`, `src/wlmouse/mod.rs`, `src/main.rs`, `README.md`), driver listing `~/.cache/beastx-triage/wlmouse.dis` (`WLmouse.exe`, image VAs), `refs/driver/app/Skin/XML/CustomControlXML/MpDevicePower.xml`, `device/rdesc.txt`, `docs/PROTOCOL.md`.
Tags: **fact** (code line / address / capture), **inference**, **unknown**.

## Answer

The battery is read with **command `0x1a`**, a zero-payload request on the vendor collection (if00, report ID 4, Output report), and the reply carries 6 status bytes at `rx[8..13]`:

| rx byte | Meaning | Tag |
|---|---|---|
| `rx[8]` | battery percent 0..100 | fact (both sources) |
| `rx[9]` | charge state: `1` = charging; `0` / `2` = not charging | fact (UI code), semantics of 0 vs 2 unknown |
| `rx[11]` | wireless link flag: non-zero selects the `WiFi_down.png` icon | fact (UI code), meaning "link down" is inference |
| `rx[10]`, `rx[12]`, `rx[13]` | `rx[13]` selects phone-type icon (mode 3 only, not a Beast X feature); `rx[12]` posted in window message `0xd01`; `rx[10]` unused | fact (code), purpose unknown |

Request to send (read-only by evidence, see Safety): `04 64 6f 1a 06 00 00 00` then 56 zero bytes (driver form, CRC patched). wlmouse-cli sends the same frame with no CRC and length 0 (below).

## 1. wlmouse-cli (third-party)

### Request frame (fact)

`src/wlmouse/mod.rs:108-112`, branch `BeastXReceiver | BeastX` (`BeastXReceiver = 0xA887`, `mod.rs:16`):

```
let mut input_buffer = [0x00_u8; 64];   // :109
input_buffer[0] = 0x04_u8;              // :110
input_buffer[3] = 0x1a_u8;              // :111
self.battery = self.from_interrupt(&mut input_buffer, 8);   // :112
```

64 bytes (report ID + 63):

```
04 00 00 1a 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

Bytes: `[0]=04` report ID, `[1..2]=00 00` (no checksum), `[3]=1a` command, `[4]=00` length, `[5..6]=00` address, `[7]=00`.

### Interface, report type, timing (fact)

- Transport `from_interrupt` (`mod.rs:165-171`): `self.device.write(&input_buffer)` (hidapi `write` = **Output report**, first byte = report ID 4, `:166`), `sleep(100 ms)` (`:168`), `self.device.read(&mut output_buffer)` of 64 bytes (**Input report** read, `:167`, `:169`), returns `output_buffer[8]` (`:170`).
- The README calls this "direct reading from interrupt endpoint" (`README.md` Supported Devices, Beast X row). It does not use feature reports for this PID. The feature-report path (`send_feature_report` / `get_feature_report`, `mod.rs:94-106`, frame `[3]=02 [4]=02 [6]=83`, reply `[8]`) is only for the 8K models `0xA883/0xA884`; unrelated to our PID.
- Interface choice (`mod.rs:51-71`): for PID `0xA887`/`0xA888` it opens **every** device-list entry with that PID (`:55-57`, `unwrap` on open), reads its report descriptor into a 40-byte buffer (`:58-59`) and keeps the first whose `buff[0] == 0x06` (`:60-63`); `0x06` is the first byte of a `Usage Page (16-bit)` item, which is how a vendor-page collection (`06 1c ff`) starts. No match returns the error "Nowhere to read/write, everything is protected" (`:68-72`).
- **Mismatch with our unit (fact + inference)**: our captured descriptors (`device/rdesc.txt`) start with `05 01 ...` on if00, if01 and if02, so no interface has `buff[0] == 0x06` and wlmouse-cli would return that error on this receiver as captured. The vendor collection (`06 1c ff 09 92 a1 01 85 04 ...`) is in the middle of if00's descriptor. The author's unit must have exposed it first; whether that is another firmware or another PID revision is unknown.
- Report ID 4, Output 63 B and Input 63 B match the if00 vendor collection (`device/rdesc.txt`: `85 04 ... 95 3f 91 00 ... 81 00`, PROTOCOL Interfaces table). fact

### Reply decode (fact for the byte, inference for the unit)

- `battery = output_buffer[8]` (`mod.rs:112`, `:170`), printed as `Battery: {}%` (`src/main.rs:30-31`). With hidapi, a numbered report is returned with the ID in byte 0, so `[8]` is the first data byte of the 8-byte header layout in PROTOCOL Frame (`[8..]` = data). Value is a percent (printed with `%`); range not stated in the source.
- The author notes the device "can sometimes output incorrect values, possibly repeat report multiple times?" (`mod.rs:89-92`). Cause inference: `read()` takes the next report on the whole if00 node, which also carries keyboard/mouse/consumer reports (IDs 1, 5, 2, 3 in `device/rdesc.txt`), not necessarily the reply to the `0x1a` write. No cmd echo check at `[3]` in wlmouse-cli.

### Checksum check (fact)

`bun ~/.cache/beastx-battery/frames.ts`, verbatim:

```text
mod.rs:110: input_buffer[0] = 0x04
mod.rs:111: input_buffer[3] = 0x1a
wlmouse-cli frame (64 B):
04 00 00 1a 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
CRC-16/MODBUS [3..32) = 0xaf6b -> bytes[1..2] would be 6b af
frame bytes[1..2] = 00 00
bytes 1-2 equal CRC-16/MODBUS LE over [3..32): false
same frame with CRC patched: 04 6b af 1a 00 00 00 00 00 00 00 00 ...
driver 0x488b60(ptr,6,0) frame (CRC patched by 0x4840e0): 04 64 6f 1a 06 00 00 00 00 00 00 00 ...
control: commented-out wlmouse frame mod.rs:150-153 has 04 6b bd 02; recomputed 0x02 frame CRC bytes = 6b bd
```

- The wlmouse-cli battery frame does **not** carry the CRC (bytes 1-2 = `00 00`, CRC would be `6b af`). The author knew the CRC: a commented-out polling frame (`mod.rs:150-153`: `04 6b bd 02`) equals PROTOCOL D3 (`0x02`) including CRC (control line above). So the battery frame was either sent without CRC and answered anyway, or the author's firmware did not check it. Whether our firmware checks the CRC on requests is unknown (PROTOCOL U2).
- Reply CRC: the driver skips reply CRC validation for `rx[3] == 0x1a` (PROTOCOL Transaction step 6, `0x48480d`..`0x484840`; `0x48481b`..`0x48482b`), consistent with a reply that has no valid CRC. inference

## 2. Vendor driver (`WLmouse.exe`)

TRIAGE F9 (no battery strings) is incomplete: the exe has **power-UI** strings and a class `CMpDevicePowerUI` (`0x69abf4` `MpDevicePower`, RTTI `0x6f5e08`, `device_power_value` `0x69b0ac`, `device_Power_progress` `0x69b028`, `device_power_status` `0x69b000`, `device_powering_status*` `0x69afd0`/`0x69af98`, `power/*.png`, `0x69ac2c`..`0x69ae6c`). They are named "power", not "battery", which is why the string scan missed them (fact, `allstrings.txt`).

### The read: command `0x1a`, wrapper `0x488b60` (fact)

- Prologue/frame (`0x488b60`..`0x488c6d`): zero 0x3f bytes (`0x488b85`), `[0]=0x04` (`0x488b95`), `[3]=0x1a` (`0x488ba2`), `[7]=0` (`0x488bcb`), `[4]=` arg2 low byte (`0x488bd8`..`0x488bdb`), `[5]=` arg3 low byte, `[6]=` arg3 high byte (`0x488be4`..`0x488bfc`). Byte sum into `[1..2]` (`0x488c00`..`0x488c69`) is overwritten by the CRC in the transaction (PROTOCOL Checksum).
- Sent through the common transaction `0x4840e0` (`0x488c9a`), under the mutex at `this+0x60c` (`0x488c79`). Status checks `rx[7]`: `0xff` -> -102, `0xfe` -> -103 (`0x488ce3`..`0x488d0f`). On success it copies `arg2` bytes from `rx[8]` to the caller buffer: `memcpy(arg1, rx+8, arg2)` (`0x488d11`..`0x488d29`, `0x614240`).
- Callers all pass `(ptr, 6, 0)`: `push 0` / `push 6` / `lea [ebp-0xc]` at `0x498437`..`0x498448`, `0x4a2ab2`..`0x4a2ac3`, `0x4b7533`..`0x4b7544`. So the request is `[3]=1a [4]=06 [5..6]=0000`, a 6-byte read at address 0 and the reply data is `rx[8..13]` (fact). Frame with CRC: `04 64 6f 1a 06 00 00 00 ...` (script above).
- The callers (`0x498400`, `0x4a2a50`, `0x4b74c0`) are three variants of one routine (called from thin stubs `0x495fa0`, `0x4a0b90`, `0x4b48a0`); the `0x4a2a50` and `0x4b74c0` variants call `0xaa` (`0x488d50`) first (`0x4a2aa1`, `0x4b7522`). Which variant and which event triggers the poll (timer vs connect) was not traced: unknown.

### Post-read handling (fact)

Caller `0x498400` after the read (`0x49845b`..`0x4984e7`; same in the other two):
1. `buf[3]` is **overwritten**: `1` when `[this+0xec8] != 0` (the CRC/`0xaa` branch, i.e. Beast X per PROTOCOL I2) else `0` (`0x498465`..`0x49846f`, `0x498476`..`0x49848e`). So on the Beast X the UI sees `b3 = 1` regardless of the device byte (inference: the overwrite makes the wireless flag constant on this branch; the device byte `rx[11]` is ignored there).
2. If `[this+0x1568]` (the power-UI object) is set: `call 0x43a120(buf, 6)` (`0x4984a2`..`0x4984b1`).
3. If `[this+0x15f8]` (a window handle) is set: `PostMessage(hwnd, 0xd01, buf[4], 0)` (`0x4984c2`..`0x4984e1`; `0x655d9c` is the imported call, assumed PostMessage/SendMessage: inference). Purpose of `rx[12]` unknown.

### UI decode: `0x43a120` (fact; labels from XML and image names are inference)

Local copy of the 6 bytes `b0..b5` at `[ebp-0x50]` (`0x43a167`..`0x43a1ab`), `rx[8+i] = b_i`:

| Byte | Code | Effect |
|---|---|---|
| `b0` | `0x43a4b0`..`0x43a4f5`, `0x43a839`..`0x43a8cf` | progress value `b0` (`0x6554cc` on control `+0x884` = `device_Power_progress`); text `"%d%s"` (`0x69ac30`) with `b0` into `device_power_value`. Five bar segments `device_power_value_0..4` (`0x69aca0` + `"%s%d"`): bars shown = 0 if `b0==0`, 1 if `<=20` (`0x14`), 2 if `<=40` (`0x28`), 3 if `<=60` (`0x3c`), 4 if `<=80` (`0x50`), 5 if `<=100` (`0x64`) |
| `b1` | `0x43a5b5`..`0x43a6ec`, `0x43a954`..`0x43a984` | `b1 == 1`: bar images `power/powering_value.png` (`0x69ad10`) and icon `power/powering.png` (`0x69adec`), i.e. **charging**. `b1 == 0` or `2`: `power/power_value.png` (`0x69acd4`) and icon `power/powered.png` (`0x69ae6c`): **not charging**. Both branches hide the progress control (`+0x118` called with 0) |
| `b3` | `0x43a524`..`0x43a5b5` | `!= 0`: `power/WiFi_down.png` (`0x69ac3c`) on `device_wuxian_logo`; `== 0`: `power/WiFi.png` (`0x69ac74`). Only when `[this+0x88c]` is 1 or 2 (device-mode field, meaning unknown). **Wireless link up/down**: inference from image names |
| `b5` | `0x43a6ec`..`0x43a839` | only when `[this+0x88c] == 3`: `1` iPhone, `2` Samsung, `3` other, else no-device phone icons (`Phone_type_*`). Not relevant to a mouse (shared control) |
| `b2`, `b4` | not read in `0x43a120` | `b4` goes to message `0xd01` (above); `b2` unused |

Also in `MpDevicePower.xml`: `device_powering_status_text` `"Charging"` (hidden by default), `device_wuxian_logo_text` `"Wireless Mode"`, `power/lightning.png`, `power/WiFi.png`, `device_Power_progress` min 0 max 100, default text `70%`. The 0..100 range is stated in the XML (fact).

### Other candidates (fact: not battery)

- `0x03` (34-byte info read, `0x4861a0`), `0xc0` (2-byte read, `0x488fb0`): their destinations are `this+0x1534` (device info) and a global (`0x6fd028`); neither is passed to `0x43a120` or the power UI. Not battery. `0x1a` is the only command whose output feeds the power UI (callers pass the buffer to `[this+0x1568]`).
- Unsolicited input reports (listeners `0x49bcd0`, `0x4aef50`, `0x4bdf90`, `0x4ce380`, parser `0x4d2c60`): not traced here. No evidence that battery is pushed; the request/response `0x1a` is sufficient. unknown whether the device also pushes status.
- Connection/online state: no separate command found. The only wireless signal is `b3` (above); `0xaa` returning `rx[8]==0xff` is the driver's readiness probe (PROTOCOL), which is a reachability test but not documented as "mouse online" (inference).

## 3. Cross-check verdict

| Item | wlmouse-cli | Driver | Match |
|---|---|---|---|
| Report ID, type | `04`, Output (hidapi `write`) then Input read | `04`, `WriteFile`/`ReadFile` on the vendor handle | yes |
| Command | `[3] = 0x1a` | `[3] = 0x1a` (`0x488ba2`) | yes |
| Length / address | `[4..6] = 0` | `[4] = 6`, `[5..6] = 0` | **differs** (length 0 vs 6) |
| Checksum | none (`00 00`) | CRC patched by `0x4840e0` | **differs** |
| Battery byte | `output_buffer[8]` (`mod.rs:170`) | `b0 = rx[8]` -> progress / `"%d%"` (`0x43a4b0`..`0x43a4f5`) | yes |
| Range | percent | 0..100 (XML, thresholds to `0x64`) | yes |
| Charging, link | not decoded | `rx[9]==1` charging; `rx[11]` link flag | driver only |
| Interface selector | descriptor `buff[0]==0x06` | n/a (vendor handle) | wlmouse-cli would not select if00 of our captured descriptors |

Verdict: the two independent sources agree on report ID 4, command `0x1a`, and battery percent at `rx[8]`. The request layout differs in length (0 vs 6) and CRC. The driver form (`len 6`, CRC) is the one with code evidence for our PID; the wlmouse-cli form is evidence from a different unit. Neither is captured on the wire with a reply: reply bytes and the success status value are code expectations (PROTOCOL U1). Confidence: battery percent at `rx[8]`: high; charging at `rx[9]==1`: medium (UI code, no capture); link flag `rx[11]`: low.

## Safety

- Command `0x1a` was in PROTOCOL's Forbidden tier ("unknown reads") only because its purpose was unproven; it is now in the allowed read tier. This pass gives the purpose: the reply feeds the power UI only (fact above).
- **Read-only by evidence, not proven**: (a) the driver wrapper writes no data bytes, only `[4]=6`, `[5..6]=0`, and copies the reply out (`0x488b60`..`0x488d29`); (b) wlmouse-cli sends it with an all-zero payload; (c) both are used for periodic UI/CLI polling. Not proven: firmware behaviour on a request that is not byte-exact, and that the device does not treat length `6`/`0` differently.
- Gate: allow exactly `04 64 6f 1a 06 00 00 00 ...` (zero elsewhere). Lead sign-off happened 2026-11-17; enforced by `readBatteryFrame` in `packages/protocol/src/read.ts` (PROTOCOL Enforced gating). Do not send the CRC-less wlmouse-cli form (unverified for our firmware).

## First read (2026-11-17)

`device/backup-2026-11-17.json` holds `battery.percent` 64 and `charging` false from the app's `0x1a` read (`04 64 6f 1a 06 00 00 00 ...`), taken with the config read at 05:08 UTC. fact: the `0x1a` reply decoded and percent came from `rx[8]`. The second read 19 s later was identical (lead's report). Not proven: that 64 % matches the real battery (no second source), `charging` = `rx[9] == 1` (false is consistent with any other value; raw `rx[9..12]` were not logged), and the link flag `rx[11]`. No write was sent.

## Unknown

- U1. Reply wire layout and success status byte: the decoded percent at `rx[8]` is proven by `device/backup-2026-11-17.json`; the raw frame (status byte, echo of `[3..7]`) was not logged. Whether the reply echoes `[3] = 0x1a` and bytes 4..7.
- U2. Whether the firmware validates the request CRC (the wlmouse-cli form sends none).
- U3. Meaning of `rx[9] == 0` vs `2`, `rx[10]`, `rx[12]` (message `0xd01`), and of `[this+0x88c]`.
- U4. Poll cadence / trigger in the driver (not traced from callers `0x495fa0`, `0x4a0b90`, `0x4b48a0`).
- U5. Whether the device pushes status unsolicited on if00 (listener code not traced for this).
- U6. Why wlmouse-cli's descriptor-first-byte test fits the author's unit but not our captured descriptors.

## Files

`~/.cache/beastx-battery/frames.ts` (runnable, reads `mod.rs` for the frame bytes), `run-output.txt` (its output), `powerui.dis` (disassembly slice of `0x43a1fe`..`0x43a9cf`, the UI half of `0x43a120`).
