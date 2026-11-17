# PROTOCOL: WLMouse Beast X 4K receiver (`36a7:a887`), driver-side wire format

Date: 2026-11-17. Session `protocol`, ticket tic-82fb. Static analysis only: nothing here was executed against the device and no vendor binary was run.
Sources: `refs/driver/app/WLmouse.exe` (PE32 i386, ImageBase `0x00400000`; addresses below are image VAs, listing `~/.cache/beastx-triage/wlmouse.dis`), `refs/wlmouse-beastx/README.md` (third-party sniffed packets, 10 blocks), `device/rdesc.txt`, `device/lsusb-v.txt`, `docs/TRIAGE.md`, `.pi/research/checksum.md`, `.pi/research/gm-web-protocol.md`.
Tags: **fact** = address, string or capture; **inference**; **unknown**. A command is "cleared" only when this document cites code for both its purpose and its payload. Nothing here is cleared for sending by itself: AGENTS.md read-before-write and one-setting-per-write still apply.

## TL;DR

1. The Beast X is driven by **output/input reports with report ID 4 on interface 00, vendor collection `0xFF1C/0x92`**. Every message is one 64-byte buffer (ID + 63), request and reply have the same layout.
2. Frame: `[0]=04 | [1..2]=CRC-16/MODBUS LE over [3..32) | [3]=cmd | [4]=chunk length | [5..6]=u16 LE address | [7]=0 (reply: status) | [8..]=data`. The sniffed `04 .. .. 06 18 ..` and `04 .. .. 36 0d ..` packets are exactly this, offset 0.
3. Settings are a **memory-mapped block**, not per-setting commands: `0x05` reads and `0x06` writes a config region in chunks of at most 24 bytes; `0x35` / `0x36` do the same for the display block. The current settings are read with `0xaa` (ping), `0x05` len 1 @ 0 (active profile), `0x05` len 0x75 @ `profile<<7` (settings block), `0x35` len 13 @ `profile<<7` (display block). That is the whole read path (`0x4b6e99`..`0x4b6f66`).
4. The driver always brackets writes with `0x01` (before) and `0x02` (after) and always sends `0xaa` first. The read path sends no `0x01`/`0x02`.
5. Reply validation in the driver is weak (high CRC byte only, status byte `0xff`/`0xfe` = error). See Transaction.

## Interfaces and reports

| Item | Evidence | Tag |
|---|---|---|
| if00 = HID, 64-byte max packet, one endpoint `0x81 IN`, no OUT endpoint | `device/lsusb-v.txt:34,54,59` | fact |
| if00 vendor collection: usage page `0xFF1C`, usage `0x92`, report ID 4, Output 63 bytes (`91 00`), Input 63 bytes (`81 00`) | `device/rdesc.txt` if00: `06 1c ff 09 92 a1 01 85 04 ... 95 3f 91 00 ... 81 00` | fact |
| if00 also holds keyboard (ID 1), mouse (ID 5), vendor-mouse (ID 2), consumer (ID 3) collections | `device/rdesc.txt` if00 | fact |
| if01 = plain mouse report, if02 = consumer page 0x0C, one unnumbered 64-byte Feature report | `device/rdesc.txt` if01, if02 | fact |
| Driver device table records 6 (`0x6fee20`, page `0xff1c`, usage `0x92`) and 7 (`0x6feebc`, page `0x0c`, usage 1) both carry PID `0xa887`, built at `0x402ce5`..`0x402d7e` | TRIAGE section 3 | fact |
| The exe never imports `HidD_SetFeature`/`HidD_GetFeature`; commands go through `WriteFile` (`0x4d2bf2`, in `0x4d2ba0`) and `ReadFile` (`0x4d2b32`, in `0x4d2ae0`) on the overlapped handle at `[port+0x1c]` (`0x4d2a10` opens it) | TRIAGE F2 | fact |
| Therefore commands go to **if00 / vendor collection report ID 4**, and if02 (feature-only) is not a command channel of this driver | the two rows above plus rdesc: a feature-only collection cannot take `WriteFile` | inference (strong) |
| The code path that picks the record-6 path string for the CRC port (`0x46c4e2`..`0x46c597`, `0x46c5d0`) was read but not fully traced | | unknown |
| Report-ID handling: the driver buffer includes byte 0 = `04`, 64 bytes per `WriteFile`/`ReadFile` (`push 0x40` at `0x484933`, `[ebp-0x100]=0x40` at `0x48411d`) | `0x4840e0` | fact |
| On Linux hidraw / WebHID: write = `04` + 63 bytes; if00 has no OUT endpoint, so the kernel sends it as a control SET_REPORT (Output); the reply arrives as an input report ID 4 on EP `0x81`. In WebHID `sendReport(4, data)` takes the 63 bytes **without** the ID, and `inputreport.data` is the 63 bytes after the ID, so every index below minus 1 | lsusb (no OUT EP), rdesc | inference |
| if02 role: no driver code uses it (no feature-report import). The sibling web hub does use a 64-byte feature report with a different frame and no CRC (`.pi/research/gm-web-protocol.md` section 1-2). Whether a887 answers that on if02 is unknown | | unknown |

## Frame

64 bytes, request and reply identical in layout. All offsets are zero-based in the 64-byte buffer (byte 0 = report ID).

| Byte | Request | Reply | Evidence |
|---|---|---|---|
| 0 | `0x04` report ID | `0x04` | wrapper `mov [buf],4`, e.g. `0x488175` (cmd 0x06), `0x4883f5` (0x36), `0x486a45` (0x15); rdesc ID 4 | fact |
| 1 | CRC low byte | CRC low | patched by the transaction at `0x484647` | fact |
| 2 | CRC high byte | CRC high | patched at `0x48465b` | fact |
| 3 | **command** | echoed (the transaction compares `tx[3]` with `rx[3]` at `0x4848d9`..`0x4848f5`) | fact |
| 4 | **chunk length** n (data bytes in this frame), `<= 0x18` in CRC mode | not checked by the driver | wrappers store `min(chunk, total-i)` at `0x488228`, `0x4884a8`, `0x4889c8`; chunk limit byte `[this+0x658]` = `0x18` set in the constructor `0x484002` and by the mode setter at `0x4891bc` (`0x38` in the other mode, `0x48919d`/`0x4891d5`) | fact |
| 5 | address low | not checked | `(i + base) % 0x100` at `0x488242`..`0x48824c` | fact |
| 6 | address high | not checked | `(i + base) >> 8` at `0x488256`..`0x488264` | fact |
| 7 | `0x00` | **status**: `0xff` => error `-102` (`0xffffff9a`, e.g. `0x488371`..`0x488379`), `0xfe` => error `-103` (`0xffffff99`, `0x488390`..`0x488398`); any other value passes | fact |
| 8.. | data (n bytes, from the caller buffer at `base`-relative index i; `memcpy` at `0x488286`) | data (n bytes copied to the caller buffer by read wrappers, e.g. `0x488b38` for cmd 0x05) | fact |
| 8+n..63 | zero | | `memset` of the 0x40 buffer at `0x48816a` | fact |

- Address = `base + i`, where `i` runs `0, 0x18, 0x30, ...` and `base` is the caller's third argument. For the settings block `base = profileIndex << 7` (`shl eax,7` at `0x4b6f0f`, `0x4baa73`). fact
- `byte 4` is therefore a chunk length, not a total length. The two sniffed commands fit: `0x06 0x18` is chunk 0 of a 0x75-byte block, `0x36 0x0d` is the whole 13-byte display block in one chunk. fact (code `0x4baa95`/`0x4baabf` pass lengths `0x75` and `0x0d`; capture bytes 4..7)
- Before the CRC the wrappers store a **byte sum** of `[3..64)` in bytes 1..2 (loop `0x488e58`..`0x488e87`, store `0x488e91`/`0x488eab`, also in `0x488140` at `0x4882a4`..`0x4882f7`). In CRC mode the transaction overwrites it (see below). In the other mode (legacy sum) it is sent as is. The sniffed Beast X frames carry the CRC, so the Beast X runs the CRC mode (inference: from the captures; the branch selection in the open code `0x46c615`..`0x46c76e` was not traced to the end).
- Request frames the driver builds are always 64 bytes with report ID 4; bytes beyond `8+n` are zero. In all 10 sniffed packets bytes 32..63 are zero. fact (capture)

## Checksum

- **fact**: CRC-16/MODBUS: reflected, poly `0xA001` (table `{0x0000, 0xA001}` at `0x6f0b64`), init `0xFFFF` (`0x483e86`), no xorout, function `0x483e80(ptr, len)`.
- **fact**: window = `buf[3 .. 32)`, 29 bytes: the transaction copies `buf+3` into a local (`rep movs` at `0x48461f`), pushes `0x1d` (`0x484622`) and calls `0x483e80` (`0x484628`). The window does **not** depend on byte 4 (so a 13-byte display chunk and a 24-byte config chunk both use `[3..32)`).
- **fact**: stored little-endian: low byte to `buf[1]` (`0x484647`), high byte to `buf[2]` (`0x48465b`), on the transaction's own 0x40-byte copy at `[ebp-0x50]`.
- **fact**: offline fit 10/10 sniffed packets (`bun ~/.cache/beastx-protocol/checksum.ts`, output below). Independent search found the same function from the captures alone (`.pi/research/checksum.md`).
- **fact**: the same window and routine are used to check replies (`0x4847dc`..`0x4847f5` copies `rx+3` for `0x1d` bytes and calls `0x483e80`).

### Sketch (TypeScript, pure)

```ts
export const FRAME_LEN = 64; // report ID + 63 bytes
export const CRC_START = 3;
export const CRC_END = 32; // exclusive: 29 bytes, push 0x1d @0x484622

/** CRC-16/MODBUS (reflected poly 0xA001, init 0xFFFF, no xorout). */
export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

/** Returns a copy of the 64-byte frame with bytes 1 (low) and 2 (high) filled. */
export function withChecksum(frame: Uint8Array): Uint8Array {
  if (frame.length !== FRAME_LEN) throw new Error(`frame must be ${FRAME_LEN} bytes`);
  const out = Uint8Array.from(frame);
  const crc = crc16Modbus(out.subarray(CRC_START, CRC_END));
  out[1] = crc & 0xff;
  out[2] = crc >>> 8;
  return out;
}

/** Request builder: [4, crcLo, crcHi, cmd, len, offLo, offHi, 0, data...]. */
export function buildFrame(cmd: number, len: number, offset: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (len > 0x18 || data.length > len) throw new Error("bad len"); // 0x18 = chunk size, this+0x658
  const f = new Uint8Array(FRAME_LEN);
  f[0] = 0x04;
  f[3] = cmd;
  f[4] = len;
  f[5] = offset & 0xff;
  f[6] = (offset >>> 8) & 0xff;
  f[7] = 0x00;
  f.set(data, 8);
  return withChecksum(f);
}
```

Runnable copy with the sniffed-packet check: `~/.cache/beastx-protocol/checksum.ts`. Run (`bun ~/.cache/beastx-protocol/checksum.ts`, verbatim, 2026-11-17):

```text
ok Default [0]    cs=96c0 len=64
ok Custom [1]     cs=6a91 len=64
ok 1mm [0]        cs=c176 len=64
ok 2mm [1]        cs=3d72 len=64
ok 125Hz [0]      cs=0273 len=64
ok 250Hz [1]      cs=8371 len=64
ok 500Hz [2]      cs=4074 len=64
ok 1000Hz [3]     cs=c176 len=64
ok 2000Hz [4]     cs=867d len=64
ok 4000Hz [5]     cs=077f len=64
10/10
derived D1 0xaa ping        04 6b 6b aa 00 00 00 00 00 00 00 00
derived D2 0x01 begin       04 2b bf 01 00 00 00 00 00 00 00 00
derived D3 0x02 end         04 6b bd 02 00 00 00 00 00 00 00 00
derived D4 0x05 rd 1@0      04 28 38 05 01 00 00 00 00 00 00 00
derived D5 0x05 rd 24@0     04 12 78 05 18 00 00 00 00 00 00 00
derived D6 0x05 rd 24@24    04 13 80 05 18 18 00 00 00 00 00 00
derived D7 0x05 rd 24@48    04 13 c8 05 18 30 00 00 00 00 00 00
derived D8 0x05 rd 24@72    04 13 10 05 18 48 00 00 00 00 00 00
derived D9 0x05 rd 21@96    04 0d 18 05 15 60 00 00 00 00 00 00
derived D10 0x35 rd 13@0    04 35 dc 35 0d 00 00 00 00 00 00 00
derived D11 0x03 rd 24@0    04 92 7c 03 18 00 00 00 00 00 00 00
buildFrame reproduces sniffed 0x36 and 0x06 frames: true
```

Caveats carried over from `.pi/research/checksum.md` (fact): the samples cannot show that the device ignores a different window; the driver code does fix `0x1d` for every command (single call site `0x484628`, immediate), which closes the window question for driver-built frames. Frames the sibling transactions `0x484d90`/`0x485850` build use their own call sites (`0x4852ce`, `0x485954`, `0x485a4f`), not read here (unknown, they do not serve the 20 command wrappers).

## Transaction

`0x4840e0` is a `thiscall` (`ecx` = protocol object, embedded at `owner+0x87c`), `ret 0x14`: `(txbuf, txlen, rxbuf, rxlen, &outCount)`. All 20 command wrappers funnel here (call sites `0x485ce5`..`0x4890ea`, table below). fact

Object layout used here (fact unless marked): `+0x04` busy byte (set `1` at `0x484119`, cleared `0x484d43`), `+0x10`/`+0x14` ready fields (proceed only if `[+0x14]!=0 && [+0x10]==0`, `0x484186`..`0x4841a8`), `+0x1c` port A and `+0x2f4` port B (each `0x2d8`-ish bytes, `HANDLE` at `port+0x1c`), `+0x5cc`/`+0x60c`/`+0x62c` mutex objects (lock `0x480970`, unlock via vtable `+0x14`), `+0x64c` CRC-mode flag (cleared `0x483fee`, set `0x4891af`), `+0x658` chunk size.

Steps:

1. Copy `min(txlen, 0x40)` bytes into the local frame `[ebp-0x50]`, zero-pad to `0x40` (`0x4841ad`..`0x484201`). Then it logs the bytes with `0x495230` (about 80 lines of disassembly, no wire effect).
2. Lock (`0x480970`). If `[+0x64c] != 0` (CRC mode): CRC over `frame[3..32)`, patch `frame[1]`, `frame[2]` (`0x484628`..`0x48465b`). If `frame[3] == 0x15`: write timeout **2000 ms** (`0x484671`), else **500 ms** (`0x4846a1`, followed by `GetLastError` `0x4846cf`). Write = `0x4d2ba0(frame, 0x40, &written, timeout)` on port B (`+0x2f4`) (`0x484694`, `0x4846c4`). fact
3. If `[+0x64c] == 0` (legacy mode): no CRC patch (the wrapper's byte sum stays), 1000 ms timeout, port A (`+0x1c`) (`0x4846e9`..`0x484709`). fact
4. Unlock; if the write returned `<= 0`: return `-1` (`0x4846e9`..`0x484744`, `0xffffffff`).
5. Read (`0x4d2ae0(rxbuf, 0x40, &read, timeout)`): CRC mode: 2000 ms if `frame[3]==0x15` (`0x48477f`..`0x48479c`) else 500 ms (`0x4847a9`..`0x4847c6`); legacy: 1000 ms (`0x4848b4`..`0x4848ce`). The read is a plain `ReadFile` of the next input report on the handle (overlapped; `0x4d2b32`) with `GetOverlappedResult` (`0x4d2b6f`); returns 1 on success. fact
6. Reply validation (CRC mode only, `0x4847d1`..`0x4848b2`): copy `rx[3..32)`, CRC again with `0x483e80` (`0x4847ed`). **Skipped** when `rx[3]` is `0xaa`, `0x1a` or `0x35` (`0x48480d`..`0x484840`). Otherwise the reply is accepted if `rx[1] == crc` (compared against the full 16-bit value, `0x484854`) **or** `rx[2] == crc>>8` (`0x484873`); both false => result `-101` (`0xffffff9b`, `0x484877`). **Effectively only the CRC high byte is checked.** fact
7. If `rx[3] == 0x50` (`0x484890`): treat as retry marker, **re-send** the same frame, at most 3 times (counter `[ebp-0x108]`, `0x484895`..`0x4848ad`, jumps to `0x4845f8`). inference for the meaning "busy"; the loop is fact.
8. After the read: if `tx[3] != rx[3]` (`0x4848e1`..`0x4848f5`) the transaction **re-reads** (does not resend) up to 3 times (counter `[ebp-0x10c]`, `0x484902`..`0x484911`, jumps to `0x48475a`). After 3 misses it still returns the last read result: a wrong echo is not an error. fact
9. Return the read result (1 = success) or the error code from step 4/6 (`0x484d3d`..`0x484d86`). Each wrapper then requires `== 1`, then checks `rx[7]` against `0xff` / `0xfe` (see Frame), then copies `rx[8..]` out for read wrappers.

Net protocol: **strict request/response**, one outstanding frame, reply = next input report ID 4. The reply to a request has the same `cmd` in byte 3. No unsolicited reports were seen in the driver path (inference: the async listeners `0x49bcd0` etc. parse other HID classes, TRIAGE I7).

### Reply layout (fact for bytes used by code, inference for the rest)

`04 | crcLo crcHi | cmd | len? | addrLo? addrHi? | status | data[0..n)` : bytes 4..6 are not read by any wrapper (so whether the device echoes them is unknown); status at 7 (`0xff`, `0xfe` errors; the success value is not tested for, no reply capture exists: unknown); data starts at 8. Extra: `0xaa` returns success only if `rx[8] == 0xff` (`0x488f22`..`0x488f2a`) and `rx[7]` is neither `0xff` nor `0xfe` (`0x488f5a`..`0x488f89`).

## First read (2026-11-17)

Evidence: `device/backup-2026-11-17.json`, read 2026-11-17 05:08 UTC through the app's read path (`0xaa` ping, `0x05` x6, `0x35`, `0x1a`), profile 0. A second read 19 s later returned identical bytes (lead's report; the second file is not kept). The owner reports read, backup and battery work in Helium. Nothing was written to the device. The app never logged raw reply frames: only the decoded payloads are in the backup, so frame bytes 0..7 of a reply (CRC, echo of command, length, address, status) are still unseen.

**Proven by this read (fact, was code-only):**

- The `0xaa` ping was answered with `rx[8] == 0xff` (the app would have shown the mouse asleep otherwise).
- Replies to `0x05`, `0x35` and `0x1a` passed `decodeReplyFrame` (CRC high byte rule, status not `0xff`/`0xfe`, chunk length at most 56) and reassembled to 117 and 13 bytes.
- Active profile is 0; battery percent is at `rx[8]` (64, not charging).

**Decode, config block (117 B hex in the backup, `config`):**

| Byte | Value | Reads as | Verdict vs `docs/settings/config-block.md` |
|---|---|---|---|
| block[0] | `00` | profile 0 | consistent |
| block[1..3] | `05 03 04` | effect raw 5, brightness 3, speed byte 4 (= Speed 0) | consistent; effect raw 5 is "reaction" in the inferred 12-entry map (earlier capture had raw 4) |
| block[4] | `00` | `Fx` | consistent with capture |
| block[5] | `01` | MultiColor on | new value; RGB at block[6..8] is `00 00 ff` while multi-colour is on: meaning of RGB then unknown |
| block[9] | `01` | stage count (code) | **contradicts** "count = enabled stages", see below |
| block[10] | `00` | High Mode off | consistent |
| block[11] | `03` | polling index 3 = 1000 Hz | consistent |
| block[12] | `00` | active stage 0 | consistent |
| block[13] | `00` | LOD 1 mm | consistent |
| block[14+9s] | `01` for s = 0..7 | all 8 stage enable flags set | consistent with layout |
| block[15+9s] | `00` for s = 0..7 | StageXY 0 | consistent |
| block[16..17+9s] | 1200, 800, 1600, 3200, 6400, 12000, 16000, 26000 | DPI X, u16 LE | consistent; 26000 equals the UI clamp maximum |
| block[18..19+9s] | 1600, 3200, 5000, 6500, 400, 400, 400, 400 | second u16 | layout holds (u16 LE at the Y offset); "Y" is a name from code, not proven |
| block[20..22+9s] | s0 `00 ff 00`, s1 `00 00 ff`, s2 `ff 00 00`, s3 `9d 00 7e`, s4 `14 ff ff`, s5 `ff 61 00`, s6 `ff a1 50`, s7 `96 c8 fe` | stage colours RGB | consistent with layout (order R, G, B unproven, see map below) |
| block[86..87] | `3c 00` | sleep 60 s | consistent |
| block[88..89] | `58 02` | 600, the constant the serializer writes | consistent |
| block[90] | `0a` | debounce 10 ms | consistent (JSON default 10) |
| block[91], [92] | `01`, `01` | Slam Click Prevention on, Motion Sync on | consistent |
| block[93..103] | all `00` | not decoded by anything | nothing to compare |
| block[104] | `01` | serializer argument 2 | new: value 1, meaning unknown |
| block[107..112] | `32 36 21 06 04 10` | clock, BCD: 32 s, 36 min, 21 h, weekday 6, day 4, month 10 | consistent as BCD; the clock is not the read time (05:08 UTC, 17 Nov), so it is stored, last set by something earlier; weekday not checked |
| block[105..106], [113..116] | `00` | | nothing to compare |

**Decode, display block (13 B hex, `display`):** `05 03 04 00 00 ff 00 00 64 00 00 01 00`.

| Byte | Value | Verdict |
|---|---|---|
| disp[0..2] | `05 03 04` | equals block[1..3], as the serializer copy rule says |
| disp[3..5] | `00 00 ff` | equals block[6..8], same order as the copy rule (the lead's first decode read it as `00 ff 00`; that was a slip) |
| disp[6] | `00` | screen mode Default |
| disp[7] | `00` | earlier capture had `32`; meaning still unknown |
| disp[8..9] | `64 00` | 100, equals JSON default `FrameIntervalTime`; earlier capture had 60 |
| disp[10] | `00` | constant |
| disp[11] | `01` | as in the earlier capture |
| disp[12] | `00` | echo byte |

**Contradiction: block[9] = 1 with 8 enabled stages.** What the evidence supports:

- Fact: block[9] is `01`; block[14+9s] is `01` for all 8 stages; the 8 X values are distinct and look configured (not defaults: the JSON default is X 400).
- Fact: the earlier sniffed capture (another unit, `refs/wlmouse-beastx/README.md`) also had block[9] = `01`.
- Code (fact): the driver writes block[9] from `DPIStages.StageCount` and parses it back, so the vendor UI would take 1 as the stage count. Whether it then shows or cycles one stage is not traced.
- So "count = number of enabled stages" (app DPI screen, commit `658c6ca`) is **not supported**. Candidates, none proven: the firmware ignores block[9] and cycles by enable flags; block[9] counts something else; the DPI button cycles only `block[9]` stages; the value is a stale default. Stage-count meaning: **unknown**. A one-setting write test (not run) could separate these.

## Settings read path

All in `0x4b6e60`..`0x4b74b0` (fact; the function loads the model from the device). Branch `[this+0xec8] != 0` is the CRC/`0xaa` branch; the `== 0` branch (`0x4b6f8f`) skips `0xaa` and the display read (inference: older device type). The sniffed frames are CRC frames, so the Beast X is on the first branch (inference).

| Step | Wrapper call | Frame | Result | Evidence |
|---|---|---|---|---|
| 1 | `0x488d50` (cmd `0xaa`) | `04 cs cs aa 00 00 00 00 ...` | true if `rx[8]==0xff` | `0x4b6ea5`; wrapper `0x488d99` | fact |
| 2 | `0x4888d0` (cmd `0x05`) len 1, base 0 | `05 01 00 00 00 ...` (D4) | `rx[8]` = active profile index, stored at `this+0x2190` | `0x4b6eb5`..`0x4b6efc` | fact |
| 3 | `0x4888d0` len `0x75`, base `profile<<7` | five frames: `05 18 00`, `05 18 18`, `05 18 30`, `05 18 48`, `05 15 60` (profile 0; D5..D9) | 117 bytes `block[0..116]`, copied to `this+0x21a5` (`0x4b7050`..`0x4b7063`) | `0x4b6f12`..`0x4b6f28` | fact |
| 4 | `0x488640` (cmd `0x35`) len `0x0d`, base `profile<<7` | `35 0d 00 00` (D10) | 13 bytes `disp[0..12]`, copied to `this+0x2252` (`0x4b7070`..`0x4b7084`) | `0x4b6f53`..`0x4b6f66` | fact |

So **`0x05` returns the `0x06` block** and **`0x35` returns the `0x36` block** (fact: same lengths, same `base = profile<<7`, and the parser in `0x4b7045`..`0x4b7490` uses bytes `block[11]`, `block[13]` as polling and LOD, matching the captured `0x06` frames). The "read = write opcode minus 1" pattern is an inference from the pair adjacency (`0x05/0x06`, `0x35/0x36`); the code facts above carry the proof for these two pairs only.

The write path (`0x4ba9a0`..`0x4bab28`, fact): `0xaa` (`0x4ba9b0`) => `0x01` (`0x4ba9d7`) => `0x06` len `0x75` base `profile<<7` (`0x4baa95`) => `0x36` len `0x0d` base `profile<<7` (`0x4baabf`) => `0x02` (`0x4bab7f`). When `0xaa` fails and `[this+0x23354]==0` the function returns without sending anything (`0x4baac6`). **A full write always rewrites all 117 + 13 bytes**; the model's current block (read earlier) is re-serialized.

Observed sniffed frames are chunk 0 only (`0x06 0x18 offset 0`) from a third-party tool (`hidapitester`), i.e. the device took a **single chunk write without `0x01`/`0x02`** in that capture (fact: README; whether it persisted is unknown).

## Commands

Direction is derived from code: **read** = the wrapper copies `rx[8..]` to the caller buffer; **write** = the wrapper copies caller data into `frame[8..]`. "Purpose" is the caller context; names are inferences unless a string ties them. All wrapper bytes are `[0]=04`, `[3]=cmd`, zeros elsewhere.

| cmd | Wrapper | Callers (context) | Direction | Payload (code) | Purpose | Tag / status |
|---|---|---|---|---|---|---|
| `0xaa` | `0x488d50` | `0x46c697` (connect loop, up to 26 tries, 50 ms sleeps, `0x46c6a3`..`0x46c6c1`), before every read/write (`0x4b6ea5`, `0x4ba9b0`, 14 more) | read (probe) | `[4..7]=0`, no data; own byte-sum, then CRC | handshake / readiness; true iff `rx[8]==0xff` | frame fact; purpose **inference**. Not cleared |
| `0x01` | `0x485b60` | before each write sequence (`0x4ba9d7`, `0x498601`, `0x4a2488`, ...) | write (no data) | `[4..7]=0` (`0x485bcb`..`0x485c46`) | begin/lock config session | frame fact; purpose **inference**. Not cleared |
| `0x02` | `0x485d70` (`ret 4`, argument unused) | after each write sequence and after the connect-time reads (`0x4b6c96`) | write (no data) | `[4..7]=0` (`0x485ddb`..`0x485e56`); a `Sleep` call at `0x485eca` | end/commit session | frame fact; purpose **inference**. Not cleared |
| `0x03` | `0x4861a0` | `0x4b6b8d`, `0x4a2499`, `0x4cb8c4`, ... right after `0x01` | read, total `0x22` (34) bytes in chunks | `[4]=chunk len`, `[5..6]=offset` from 0 | device info record copied to `this+0x1534`; its byte 5 (`this+0x1539`) times 3 sizes the `0x07` read | read shape fact; purpose **inference** (connect-time info). Not cleared |
| `0x05` | `0x4888d0` | `0x4b6ecc`, `0x4b6f28`, `0x4b6fa6`, `0x4b7002`, `0x4982e8`, `0x4a25f2`, `0x4cb998` (len 1) and len `0x75` / `0x22` | **read**, `(buf, len, base)` | `[4]=n`, `[5..6]=base+i`, no data; data copied out at `0x488b38` | read config memory (settings block, active profile) | **fact** shape + parse (`0x4b7045`..`0x4b7490`) |
| `0x06` | `0x488140` | `0x4baa95`, `0x4bab23`, `0x498625`, `0x4a4867`, `0x4cbbd5` | **write**, `(buf, len, base)` | lens seen: `0x75` base `profile<<7`; `0x15` base `idx<<6`; `0x22` base `idx*0x21` (other device variants, inference) | write config memory (settings block) | **fact** shape; captured twice (LOD/polling). See Danger notes on use |
| `0x07` | `0x486ed0` (`ret 4`) | `0x4b6c3c`, `0x4a24e9` after `0x489150` sets size `= 3*[this+0x1539]` (max `0x200`) | read | no data; size from object | table read into `this+0x1d10` (`0x4b6c55`, `0x200` bytes) | read shape fact; purpose **unknown**. Not cleared |
| `0x09` | `0x486480` (`ret 8`) | `0x4a3443`, `0x4b8151`, `0x4b81f0` | write | `(ptr, n)`: `ptr` points to a record starting with a u16 count | unknown (writes a counted record, followed by `0x02`) | **unknown**. Forbidden |
| `0x0a` | `0x487420` (`ret 0x10`) | `0x4a6ee8` | read | `(buf, len, a, b)`, address `a*b + chunk` | indexed table read | shape fact; purpose **unknown**. Not cleared |
| `0x0b` | `0x487bf0` (`ret 0x10`) | `0x4b1534`, `0x4b172c`, `0x4b19f0` | write | `(buf, len, a, b)`, address `a*b + chunk`; uses mutex `+0x62c` (not `+0x60c`) | indexed table write | **unknown**. Forbidden |
| `0x15` | `0x486a00` (`ret 8`) | `0x4a45e4`, `0x4b910f`, `0x4b9204` | write, `(buf, len)`, chunk 24, address = chunk start | data copied into frame at `0x486b50` | unknown bulk write; **only command with a 2 s timeout** (`0x48466c`) | **Danger** |
| `0x17` | `0x486c90` (`ret 8`) | `0x4b9ec7`, `0x4b9fa0` | write, chunk `0x38` | no address field written | unknown bulk write | **unknown**. Forbidden |
| `0x1a` | `0x488b60` (`ret 0xc`) | `0x498448`, `0x4a2ac3`, `0x4b7544` (args `0, 6, ptr`) | read, 6 bytes | `[5]=a`, `[6]=b` (byte args), reply copied out | unknown 6-byte read (id/addr-like); reply CRC is **not** validated (`0x48481b`..`0x48482b`) | **unknown**. Not cleared |
| `0x1b` | `0x487170` (`ret 4`) | `0x4a251a` | read | length = `[this]` u16 (default `0x200`, setter `0x489150`) | unknown table read | **unknown**. Not cleared |
| `0x1c` | `0x485f90` | `0x4d0da4` after setting `this+0x18f0` | write (no data) | `[4..7]=0` | unknown mode/state command driven by a flag | **unknown**. Forbidden |
| `0x27` | `0x486740` (`ret 8`) | `0x4a39b8` | write | same shape as `0x09` | unknown | **unknown**. Forbidden |
| `0x35` | `0x488640` (`ret 0xc`) | `0x4b6f66` | **read**, `(buf, len, base)` | `[4]=n`, `[5..6]=base+i`; reply CRC not validated | read display block | **fact** (see read path) |
| `0x36` | `0x4883c0` (`ret 0xc`) | `0x4baabf` | **write**, `(buf, len, base)` | lens seen: `0x0d` base `profile<<7` | write display block | **fact** shape; captured twice (Default/Custom) |
| `0x37` | `0x487950` (`ret 8`) | `0x4c5979` (arg `2`) | write, `Sleep` after (`0x487bc3`) | chunk `0x38` | unknown, long-running | **unknown**. Forbidden |
| `0xc0` | `0x488fb0` (`ret 0xc`) | `0x4b6c83` with `(0x6fd028, 2, 0)`, once per connect | read-shaped: `tx[4]=len`, `tx[5..6]=offset`, reply copied out | `[4]=2 [5..6]=0` | connect-time 2-byte read into a global | shape fact; **unknown purpose**; the sibling hub uses cmd `0xC0` for factory default (different frame), so name clash. **Forbidden** |

Count: 20 wrappers (`TRIAGE` section 4) = `0x01 0x02 0x03 0x05 0x06 0x07 0x09 0x0a 0x0b 0x15 0x17 0x1a 0x1b 0x1c 0x27 0x35 0x36 0x37 0xaa 0xc0`. Call-site map checked with `grep 'call   0x<wrapper>'` on the listing (callers table in `~/.cache/beastx-protocol/callers.txt`).

## Settings blocks (cmds `0x06`/`0x05` and `0x36`/`0x35`)

### Config block, 117 bytes (`block[0..0x74]`), profile `p` at address `p*0x80`

Chunks: `[0,24)`, `[24,48)`, `[48,72)`, `[72,96)`, `[96,117)` (the last has len 21). Captured chunk 0 for profile 0 (`04 .. .. 06 18 00 00 00 | block[0..23]`):

```
off  0  1  2  3  4  5  6  7   8  9 10 11 12 13 14 15  16 17 18 19 20 21 22 23
    00 04 04 04 00 00 21 00  95 01 00 PP 00 LL 01 00  40 06 40 06 10 00 c8 01
```

| `block[i]` | Value in captures | Decode | Evidence | Tag |
|---|---|---|---|---|
| 0 | `00` | active profile index; the read path stores `rx[8]` of a separate `0x05` len-1 @0 read into `this+0x2190` and the block read starts with the same byte at address 0 for profile 0 | `0x4b6efc`, `0x4b7050` | inference (for profile > 0 the first byte of the block lives at `p*0x80`, not at 0) |
| 1 | `04` | raw value looked up in a model vector (`this+0x1aa8`), stored as an index (`0x4b70a2`..`0x4b710c`) | | fact (parse); semantics **unknown** |
| 2 | `04` | copied verbatim to `this+0x2192` -> `0x1835` (`0x4b711e`) | | fact (parse); **unknown** |
| 3 | `04` | stored as `4 - block[3]` (`0x4b7130`..`0x4b7144`) | | fact (parse); **unknown** |
| 5, 6, 7, 8 | `00 21 00 95` | copied verbatim to `this+0x2195..0x2198` -> `0x1838..0x183b` (`0x4b714a`..`0x4b71a4`) | | fact (parse); **unknown** (identical to display bytes 3..5 pattern `21 00 95`) |
| 9 | `01` | to `this+0x2234` (dword) and the profile object setter `0x457b20` (`0x4b7258`, `0x4b7436`) | | fact (parse); **unknown** |
| **11** | `00..05` | **polling-rate index**: stored as word at `this+0x2242` (`0x4b7271`..`0x4b727f`). Captures: `0`=125, `1`=250, `2`=500, `3`=1000, `4`=2000, `5`=4000 Hz | README polling blocks; code `0x4b7271` | fact (capture) |
| 12 | `00` | profile object setter `0x457a80` (`0x4b7417`); UI writers at `0x4c245e`, `0x4c24f4` | | fact (parse); **unknown** |
| **13** | `00` / `01` | **lift-off distance**: word at `this+0x224a` (`0x4b728c`). Captures: `0` = "1mm", `1` = "2mm" | README LOD blocks | fact (capture); further values **unknown** |
| 14, 15 | `01 00` | unmapped in the read parse | | unknown |
| 16..19 | `40 06 40 06` | u16 LE pair `0x0640`,`0x0640` = 1600, 1600 | | inference (looks like X/Y DPI of the active stage; not varied in any capture) |
| 20..23 | `10 00 c8 01` | unmapped | | unknown |
| 24..`0x55` | not captured | not decoded here | | unknown |
| `0x56..0x57` | not captured | sleep time, u16 LE seconds: `1e 00` 30 s, `3c 00` 60 s, `2c 01` 300 s (serializer `0x4ba31c`..`0x4ba367`; parse `0x4b72a7`..`0x4b7333` reads the low byte only) | `docs/settings/config-block.md` | fact |
| `0x5a` | not captured | debounce (`AntiShake`), u8 ms | `docs/settings/config-block.md` | fact (location) |
| `0x6b..0x70` | not captured | written by the write path as BCD digits `(v/10)<<4 + v%10` of five date/time-like getters (`0x4c9bd0`, `0x4c9b80`, `0x4c9b30`, `0x4c9ae0`, `0x4c9a90`-1) into the outgoing block (`0x4ba700`..`0x4ba838`, stores at frame offsets `0x6b..0x70`) | | inference: a timestamp is part of every full write |

### Display block, 13 bytes (`disp[0..12]`), one chunk

Captured `04 .. .. 36 0d 00 00 00 | disp[0..12]`:

```
off  0  1  2  3  4  5  6  7  8  9 10 11 12
    04 04 04 21 00 95 MM 32 3c 00 00 01 00      MM = 00 Default, 01 Custom
```

| `disp[i]` | Value | Decode | Evidence | Tag |
|---|---|---|---|---|
| 0..5 | `04 04 04 21 00 95` | copied from the model (`0x4ba894`..`0x4ba8d6`); the read path copies the block straight to `this+0x2252` | | fact (flow); semantics **unknown** |
| 6 | `00` / `01` | **display mode**: Default / Custom (stored at `this+0x2258` on write `0x4ba8e2`) | README display blocks | fact (capture); other values unknown (README: "n ~ [0,1]") |
| 7 | `0x32` | `this+0x2259` | `0x4ba8f4` | unknown (50 decimal) |
| 8, 9 | `3c 00` | **u16 LE** value 60 at `this+0x225a/0x225b` = model word `this+0x3350` (`0x4b7367`..`0x4b7391`, `0x4ba83e`..`0x4ba877`) | | fact (parse); semantics **unknown** (60 looks like seconds) |
| 10 | `00` | constant 0 on write (`0x4ba924`) | | fact |
| 11 | `01` | `this+0x225d` | `0x4ba931` | unknown |
| 12 | `00` | uninitialised local on write (`0x4ba966`) | | unknown |

README says the display block affects the OLED; the exe key names `ScreenStages`, `OledMode`, `PictureCount` (`0x6a1ac4`, `0x6a1ad4`, `0x6a1af0`) support that (inference).

## Golden packets

Source: `refs/wlmouse-beastx/README.md` (CRLF file, third-party sniffing; **unknown** how they were captured and whether a device applied them). All are 64 bytes; bytes 32..63 are `00` in every one (fact), so only bytes 0..31 are shown. CRC verified by the sketch above, 10/10.

| Name | Bytes 0..31 (hex) | CRC | cmd | Fields changed |
|---|---|---|---|---|
| Display Default [0] | `04 c0 96 36 0d 00 00 00 04 04 04 21 00 95 00 32 3c 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00` | `0x96c0` | `0x36` | `disp[6]=0` |
| Display Custom [1] | `04 91 6a 36 0d 00 00 00 04 04 04 21 00 95 01 32 3c 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00` | `0x6a91` | `0x36` | `disp[6]=1` |
| LOD 1mm [0] | `04 76 c1 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 03 00 00 01 00 40 06 40 06 10 00 c8 01` | `0xc176` | `0x06` | `block[13]=0` (and `block[11]=3`) |
| LOD 2mm [1] | `04 72 3d 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 03 00 01 01 00 40 06 40 06 10 00 c8 01` | `0x3d72` | `0x06` | `block[13]=1` |
| Poll 125Hz [0] | `04 73 02 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 00 00 00 01 00 40 06 40 06 10 00 c8 01` | `0x0273` | `0x06` | `block[11]=0` |
| Poll 250Hz [1] | `04 71 83 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 01 00 00 01 00 40 06 40 06 10 00 c8 01` | `0x8371` | `0x06` | `block[11]=1` |
| Poll 500Hz [2] | `04 74 40 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 02 00 00 01 00 40 06 40 06 10 00 c8 01` | `0x4074` | `0x06` | `block[11]=2` |
| Poll 1000Hz [3] | `04 76 c1 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 03 00 00 01 00 40 06 40 06 10 00 c8 01` | `0xc176` | `0x06` | `block[11]=3` (identical to LOD 1mm) |
| Poll 2000Hz [4] | `04 7d 86 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 04 00 00 01 00 40 06 40 06 10 00 c8 01` | `0x867d` | `0x06` | `block[11]=4` |
| Poll 4000Hz [5] | `04 7f 07 06 18 00 00 00 00 04 04 04 00 00 21 00 95 01 00 05 00 00 01 00 40 06 40 06 10 00 c8 01` | `0x077f` | `0x06` | `block[11]=5` |

Note: the Display captures carry byte 3..7 as `36 0d 00 00 00` = cmd, len 13, address 0, status field 0. The LOD capture is the 1000 Hz capture with LOD 2mm toggled, so a 0x06 chunk write replaces polling and LOD together; any chunk write must start from a **freshly read** `block[0..23]` (read-modify-write), otherwise the other fields revert to the capture's values. inference

### Derived frames (never sniffed; derived from code, CRC from the sketch)

Each uses `buildFrame` and the wrapper facts cited in Commands/Settings read path. Bytes 12..63 are zero. These are **not cleared for sending**; they document the read path.

| ID | Frame, bytes 0..11 | Derivation |
|---|---|---|
| D1 `0xaa` ping | `04 6b 6b aa 00 00 00 00 00 00 00 00` | wrapper `0x488d50`: `[3]=0xaa`, `[4..7]=0` (`0x488d99`..`0x488e42`) |
| D2 `0x01` begin | `04 2b bf 01 00 00 00 00 00 00 00 00` | `0x485b60`: `[3]=1`, `[4..7]=0` (`0x485ba2`..`0x485c46`) |
| D3 `0x02` end | `04 6b bd 02 00 00 00 00 00 00 00 00` | `0x485d70`: `[3]=2`, `[4..7]=0` |
| D4 `0x05` read 1 @ 0 | `04 28 38 05 01 00 00 00 00 00 00 00` | `0x4888d0` called `(buf, 1, 0)` at `0x4b6ecc` |
| D5..D8 `0x05` read 24 @ 0/24/48/72 | `04 12 78 05 18 00 00 00`, `04 13 80 05 18 18 00 00`, `04 13 c8 05 18 30 00 00`, `04 13 10 05 18 48 00 00` | `(buf, 0x75, 0)` at `0x4b6f28`, chunk loop `0x488975`..`0x488a04` |
| D9 `0x05` read 21 @ 96 | `04 0d 18 05 15 60 00 00 00 00 00 00` | last chunk, `0x75-96 = 21` |
| D10 `0x35` read 13 @ 0 | `04 35 dc 35 0d 00 00 00 00 00 00 00` | `0x488640` `(buf, 0xd, 0)` at `0x4b6f66` |
| D11 `0x03` read 24 @ 0 | `04 92 7c 03 18 00 00 00 00 00 00 00` | `0x4861a0` first chunk (total `0x22`, chunk limit `0x18`, `0x4861fa`) |

## Settings map

Full byte-level map with UI-to-byte evidence chains: `docs/settings/config-block.md`. Battery: `docs/settings/battery.md`. Summary (lead spot-checked the sleep serializer `0x4ba31c`..`0x4ba367` and the `0x1a` call sites):

| Setting | Location | Encoding | Tag |
|---|---|---|---|
| Polling rate | `block[11]` | index 0..5 = 125/250/500/1000/2000/4000 Hz | fact (capture + code); write 1000 -> 500 Hz (index 3 -> 2) accepted on the device, second device session 2026-11-17: app read-back of the full block matched, UI showed 500. Persistence across a receiver power cycle: unknown |
| Lift-off distance | `block[13]` | 0 = 1 mm, 1 = 2 mm | fact (capture) |
| DPI stage s (0..7) | `block[14+9s .. 22+9s]` | enable u8, XY-linked u8, X u16 LE, Y u16 LE, R, G, B | fact (code); stage 0 matches capture (`01 00 40 06 40 06 10 00 c8`); stage 0 X (`block[16..17]`) write accepted on the device, second device session 2026-11-17 (single `0x06` chunk 0, read-back matched; owner observation: cursor speed changed). Other stages, Y, colour, enable: not written |
| Stage count | `block[9]` | 1..8 | fact (code); meaning on the device unknown (read `01` with 8 enabled stages), not written |
| Active stage | `block[12]` | 0-based | fact (code) |
| High mode | `block[10]` | 0/1, exclusive with 2K/4K polling | fact (code) |
| Sleep | `block[86..87]` | u16 LE seconds (30, 60, 300) | fact (code) |
| Debounce | `block[90]` | u8 ms, UI list 0..12 | location fact, range inference |
| Slam click prevention (`SensorLif`) | `block[91]` | 0/1 | fact (code) |
| Motion sync | `block[92]` | 0/1 | fact (code) |
| Lighting | `block[1..8]` | effect, brightness, `4 - speed`, ... | fact (model to byte), effect map partly inferred |
| Clock | `block[107..112]` | BCD | fact (code) |
| Display mode | `disp[6]` | 0 Default, 1 Custom | fact (capture) |
| Button mapping | cmd `0x0b`, not in the blocks | layout unknown | forbidden |
| Ripple control, angle snap | absent from exe, `Mouse.json` and skin | n/a | absence fact |
| Battery | cmd `0x1a`, frame `04 64 6f 1a 06 00 00 00 ...`; reply `rx[8]` percent, `rx[9]==1` charging | read-only by evidence; wlmouse-cli sends the same opcode | fact (driver `0x488b60` called `(ptr, 6, 0)` at `0x498448`, `0x4a2ac3`, `0x4b7544`) |

## Danger

Never send any of these; AGENTS.md: unknown purpose = do not send. The driver's flash/boot path was **not located** in the exe; every command not cleared below might be on it.

1. **`0x15`** (wrapper `0x486a00`, callers `0x4a45e4`, `0x4b910f`, `0x4b9204`): data-bearing bulk write with the only 2000 ms timeout (`0x48466c`, `0x484671`, `0x48477f`). Always followed by `0x02`. Treat as flash/commit-class until proven otherwise (inference).
2. **`0xc0`** (wrapper `0x488fb0`, caller `0x4b6c83`): code shape is a 2-byte read, but the sibling web hub uses `0xC0` for factory default (`.pi/research/gm-web-protocol.md` section 5). Different frame, so not proven to be the same, yet a collision. Do not send.
3. **`0xaa`** is **not** Danger by code (zero payload, return value only), but its purpose is inferred; it is the driver's first packet every time. Decision (lead): allowed as the first read-session packet (`pingFrame`, `packages/protocol/src/read.ts`); it is never sent before a write on its own.
4. **Unknown writes**: `0x09`, `0x0b`, `0x17`, `0x1c`, `0x27`, `0x37`. `0x37` is followed by a `Sleep` (`0x487bc3`), `0x1c` is a flag-driven zero-payload command (`0x4d0da4`).
5. **Unknown reads** `0x07`, `0x0a`, `0x1b`, `0x03`: shape is read, purpose unproven. (`0x1a` left this list: `docs/settings/battery.md` shows its reply feeds only the power UI; it is allowed as the exact battery frame below, lead sign-off 2026-11-17.) In a protocol where read and write share the opcode space, a mistaken payload could be a write; do not probe.
6. **Session commands `0x01`/`0x02`**: zero payload, but purpose inferred only. Only valid as the bracket around `0x06`/`0x36` writes.
7. **Reset to defaults**: UI text `message_text_22` (`Skin/lan_en.xml:72`), handler not traced; none of the 20 wrappers is labelled with it. If it exists, it is one of the unknown commands above. Not traced: unknown.
8. **Pairing, DFU, bootloader**: no code or string found (TRIAGE F9). The hub has `0xB0` bootloader and `0x0A/0x0B/0x26/0x0F` RF-address commands on its own frame; **do not assume the Beast X frame lacks equivalents**.
9. **if01** (plain mouse): never write. **if02**: no driver evidence; do not write.
10. **Chunk write notes for `0x06`/`0x36`**: a partial write (chunk 0) appeared in the sniffed packets (fact); later chunks, and chunks of other lengths than `0x18` / `0x15` (last chunk), are unobserved. Out-of-range address (`>= 0x75` within a profile block, other profile numbers, `0x15`/`0x22`-length variants) is unknown. Decision (lead, not fact): unproven chunk writes are allowed behind the Experimental writes switch, see Enforced gating. The code writes only the chunks whose bytes changed, at the active profile's base (`writeConfigPatch`, `packages/protocol/src/write.ts`), with no `0x01`/`0x02` bracket; whether the firmware accepts that is unknown (U2).

### Enforced gating (`packages/protocol`, `apps/web/src/device/device.ts`)

Code state: commit `35d4609` plus the device layer in the working tree. Reads were proven by the first read ("First read", `device/backup-2026-11-17.json`). Second device session (2026-11-17, owner relayed by the lead): two writes were sent, polling `block[11]` and stage 0 X `block[16..17]`, each as one `0x06` chunk 0 (len `0x18`, addr 0) with no `0x01`/`0x02` bracket and no preceding `0xaa`; read-back passed for both (the app shows a mismatch toast otherwise; none appeared). Every other write below stays a code expectation (U2). Raw reply frames were not captured (U1).

**Frame allowlist** (`ALLOWED` and `buildFrame`, `packages/protocol/src/frame.ts`). Only these opcodes can be built; any other returns `UnsupportedCommand`: `0x01`, `0x02`, `0x05`, `0x06`, `0x1a`, `0x35`, `0x36`, `0xaa`. Chunk length is at most `0x18`, address at most `0xffff`, data empty or exactly the chunk length. `device.ts` does not send `0x01`/`0x02`. Forbidden: `0x03 0x07 0x09 0x0a 0x0b 0x15 0x17 0x1b 0x1c 0x27 0x37 0xc0` and all unknown opcodes. fact (code)

| Tier | Commands | Condition | Tag |
|---|---|---|---|
| Read | `0xaa` (`pingFrame`), `0x05` len 1 @ 0 (active profile), `0x05` 5 chunks of the active profile block (`readConfigFrames`), `0x35` len `0x0d` @ `profile<<7` (`readDisplayFrame`) | Frames built in `packages/protocol/src/read.ts`; no switch | fact (code); read proven 2026-11-17 (`device/backup-2026-11-17.json`); raw reply frames unseen (U1) |
| Read, battery | `0x1a`, frame `04 64 6f 1a 06 00 00 00 ...` (zero after byte 7), built by `readBatteryFrame` in `packages/protocol/src/read.ts` | Not the CRC-less wlmouse-cli form. Evidence: `docs/settings/battery.md`. Lead sign-off 2026-11-17 | fact (frame); read-only by evidence, not proof |
| Write, confirmed | `0x06` polling index (byte 11, `0..5`) and lift-off (byte 13, `0/1`); `0x36` display mode (byte 6, `0/1`) | Backup done this session | fact (sniffed frames); polling index fact on the device, second device session 2026-11-17 (1000 -> 500 Hz, read-back matched; owner observation: LED flashed yellow, no difference felt by hand). Lift-off and display mode: not written yet |
| Write, experimental | `0x06` sleep seconds (bytes 86..87), debounce (90), motion sync (92), active stage (12) | Backup done this session and Experimental writes switch on (`setExperimental(true)`) | decision (lead): "3 and we test out it works"; tier unchanged in code, no device evidence for these fields yet |

DPI stage values and stage count are planned experimental fields. Device evidence, second device session 2026-11-17: with Experimental writes on, a DPI X edit on the first stage (stage 0, `block[16..17]`) was written as a single `0x06` chunk 0 and read back equal; owner said "dpi works", "only with it on", and saw the cursor speed change (owner observation). Stage count is not written.

Rules for every write (`writeSettings`, `writeDisplay` in `device.ts`):

1. Backup first: `backup` reads the active profile and opens the gate; without it the write fails with `BackupRequired`. The file `device/backup-<date>.json` (AGENTS.md) is the app layer's job.
2. Experimental fields without the switch fail with `ExperimentalOff`.
3. Reads and writes serialize on one semaphore.
4. Read-modify-write: read the active profile, patch bytes, send only the chunks whose bytes changed (`writeConfigPatch`) at the active profile's address base. Display writes send the 13-byte block (`writeDisplayFrame`).
5. Read back after the write and compare; a different value fails with `WriteMismatch`.
6. Reply validation (`decodeReplyFrame`, `packages/protocol/src/reply.ts`): report ID 4; CRC high byte checked as in Transaction step 6, skipped for `0xaa`, `0x1a`, `0x35`; status `0xff` or `0xfe` fails; chunk length at most 56.

Single `0x06` chunk writes without the `0x01`/`0x02` bracket and without a preceding `0xaa` match the sniffed frames (none show a bracket, fact). Device fact, second device session 2026-11-17: the firmware accepted and applied such a bare single-chunk write twice (polling, stage 0 X); see U2 for what remains open. The switch stays. decision

## Facts

- F1. The Beast X command channel is the vendor collection `0xFF1C/0x92`, report ID 4, Output and Input 63 bytes (`device/rdesc.txt` if00); the driver uses `WriteFile` `0x4d2bf2` / `ReadFile` `0x4d2b32`, no feature reports (TRIAGE F2).
- F2. Frame bytes: `[0]=4`, `[1..2]` CRC LE, `[3]` cmd, `[4]` chunk len, `[5..6]` address LE, `[7]` request 0 / reply status, `[8..]` data (wrappers `0x488140`, `0x4883c0`, `0x4888d0`, `0x488640`; captures).
- F3. Checksum: CRC-16/MODBUS over `buf[3..32)`, fixed 29 bytes (`0x483e80`, `push 0x1d` `0x484622`, call `0x484628`, patch `0x484647`/`0x48465b`); 10/10 sniffed packets (script output above).
- F4. Wrapper byte-sum (`0x488e58`) is overwritten by the CRC in CRC mode; legacy mode sends the byte sum and uses the other port and 1000 ms timeouts (`0x4846e9`).
- F5. Transaction `0x4840e0`: lock, send on port B in CRC mode, timeouts 500 ms (2000 ms for `0x15`), read, validate (CRC high byte only; skipped for rx cmd `0xaa`, `0x1a`, `0x35`), rx cmd `0x50` => resend up to 3 (`0x484890`), tx/rx cmd mismatch => re-read up to 3 (`0x4848e1`), wrapper status `rx[7] == 0xff` => -102, `0xfe` => -103.
- F6. `0x05` (read) and `0x06` (write) address the settings block with `(len 0x75, base profile<<7)`; `0x35` and `0x36` address the 13-byte display block with `(len 0x0d, base profile<<7)`; chunk limit `0x18` (`0x484002`, `0x4891bc`); full read path `0x4b6e99`..`0x4b6f66`, full write path `0x4ba9a0`..`0x4bab7f`.
- F7. Polling rate is `block[11]` = index `0..5` for 125/250/500/1000/2000/4000 Hz; LOD is `block[13]` = 0/1 for 1mm/2mm; display mode is `disp[6]` = 0/1 (captures `refs/wlmouse-beastx/README.md`; code reads `block[11]` at `0x4b7271` and `block[13]` at `0x4b728c`).
- F8. Connect-time sequence: `0xaa` loop, `0x01`, `0x03` (34 B), `0x07` (size from info), `0xc0` (2 B), `0x02` (`0x4b6b64`..`0x4b6c96`).
- F9. Command byte list of the 20 wrappers and their direction (read/write by `memcpy` direction) in Commands.
- F10. Driver validates replies only weakly (high CRC byte), so a reply from the device may be accepted by the driver even if its low CRC byte differs (`0x484854`, `0x484873`).

## Inferences

- I1. Command `0x05` is the read counterpart of `0x06`, `0x35` of `0x36` (same lengths and bases, parse matches captures). The general "read = write - 1" rule is not claimed.
- I2. Beast X runs the CRC mode / port B, because the sniffed frames carry the CRC. The branch selection at `0x46c615`..`0x46c76e` toggles `[this+0xec8]` and was not fully traced.
- I3. `0xaa` is a readiness handshake; `0x01`/`0x02` begin/end a session. Evidence: call pattern only.
- I4. Superseded by `docs/settings/config-block.md`: `block[16..19]` is DPI stage 0 X/Y (not the active stage), `block[0x56..0x57]` is sleep in seconds, `block[0x5a]` is debounce, `block[0x6b..0x70]` is a BCD clock.
- I5. The `0x15` and `0x22` block lengths (`0x4982d7`, `0x4a4867`, `0x498625`) are other device variants of the same shared driver; Beast X uses `0x75` + display (`0x36`).
- I6. `rx[3]==0x50` means "retry/busy".
- I7. A single chunk-0 `0x06` write (as sniffed) takes effect without `0x01`/`0x02`. Verified on the device until the next read (second device session 2026-11-17, see U2); persistence beyond that is unverified.
- I8. WebHID/hidraw index shift of one byte for replies (report ID stripped).

## Unknowns

- U1. Reply frame on the wire, partly observed. Proven by `device/backup-2026-11-17.json`: `0xaa` answered with `rx[8] == 0xff`, and `0x05`, `0x35`, `0x1a` replies passed `decodeReplyFrame` and decoded to 117, 13 and battery bytes. Not proven: the app never logged raw reply frames, so the success status value at `rx[7]`, the echo of bytes 3..6, the CRC low byte and the reply's `0x1a` bytes other than `rx[8]` are unseen. Next step: log one raw frame per command. The second device session (2026-11-17) captured none: the clipboard was lost.
  - First raw frames (2026-11-17, hidraw via `apps/cli` diagnostic, receiver on, mouse asleep): the `0xaa` ping was answered `04 aa 00 aa 00 ...` (bytes 1-2 `aa 00`, cmd echo `aa` at `rx[3]`, status 0, `rx[8] = 00`, so not ready); the `0x1a` battery request was answered `04 00 00 50 00 ...` (cmd `0x50`, the retry marker of Transaction step 7, bytes 1-2 zero). Still unseen: an awake reply, its status byte, the 3..6 echo and the CRC low byte.
- U2. Single chunk write tolerance, second device session 2026-11-17.
  - Proven (device session, said by owner): a bare single `0x06` chunk 0 write (len `0x18`, addr 0, no `0x01`/`0x02`, no preceding `0xaa`) is accepted and applied by the firmware at least until the next read. Evidence: polling `block[11]` 3 -> 2 and stage 0 X `block[16..17]`, each followed by a full-block read-back that matched. Owner observations, not measurements: the mouse LED flashed yellow after the polling write; the cursor speed changed after the DPI write; no felt difference at 500 Hz.
  - Not proven: whether the value survives a receiver power cycle (persistence without `0x02`); whether `0x01`/`0x02` would change that; whether the firmware checks the request CRC (our frames carry a valid CRC, so acceptance says nothing about it); whether the LED flash means "applied", "saved" or something else (inference at most); chunks other than 0 and profile > 0 (U6).
  - Next step: after a receiver power cycle, read the block and compare `block[11]` with 2; log one raw reply frame of the write (U1).
- U3. Names of `block[1..3]`, `block[5..10]`, `block[12]`, `block[14..15]`, `block[20..0x74]` (except `0x56`, `0x5a`, `0x6b..0x70` by parse), and `disp[0..5, 7..12]`. DPI stage tables, debounce, sleep, motion sync, lighting, buttons: not located in this block by this pass.
- U4. Which port string/collection the open code assigns to port B (`+0x2f4`), beyond the report-descriptor inference (`0x46c4e2`..`0x46c597`).
- U5. Purpose of `0x03`, `0x07`, `0x09`, `0x0a`, `0x0b`, `0x15`, `0x17`, `0x1a`, `0x1b`, `0x1c`, `0x27`, `0x37`, `0xc0`; battery read (the exe has no battery string; maybe `0x03` or a reply field); firmware version; flash / DFU / pair / reset opcodes.
- U6. What happens on `0x06` writes with `profile > 0`, with the other chunk addresses, and with the `0x15` / `0x22` lengths.
- U7. The sibling transactions `0x484d90` / `0x485850` (called from `0x487880` and `0x48809a`, outside the 20 wrappers) were not read; whether they use a different window or opcodes is unknown.
- U8. Whether if02 (feature report) accepts hub-style frames (gm-web) on this PID.

## Files

`~/.cache/beastx-protocol/checksum.ts` (runnable, 10/10), `run-output.txt` (output), `txn.dis`, `w06.dis`, `w05.dis`, `w15.dis`, `rd.dis`, `rd2.dis`, `open.dis`, `wr0.dis`, `ui06.dis`, `callers.txt`, `wrappers.txt` (disassembly slices of the cited ranges).
