# Block map: config block (cmd 0x05/0x06, 117 B) and display block (0x35/0x36, 13 B)

Session blockmap, ticket tic-a6f2. Static RE of `refs/driver/app/WLmouse.exe` (32-bit, image base 0x400000), listing `~/.cache/beastx-triage/wlmouse.dis`, strings `allstrings.txt`, UI `refs/driver/app/Skin/**`, defaults `refs/driver/app/DefaultData/*.json`. Work files: `~/.cache/beastx-blockmap/` (`a_<addr>.txt` = annotated function dumps, `ann.py`). Nothing was run against the device or the vendor binary.

Tags: **fact** = read from code/strings/UI file at the cited address; **inference** = deduced, not proven; **unknown**.

## 0. How the evidence chain works

The driver keeps its settings in a JSON model (`Mouse.json`, template in `DefaultData/`) held by a profile object at `this+0x2270` (JSON root at `+0x360` of it). Three functions turn that model into the block, and one function turns the block back into the model:

| Role | Address | Fact |
|---|---|---|
| **Serializer** (model -> 117 + 13 bytes), function `0x4ba180`..`0x4bac19` (`ret 0x14`) | local block buffer `B = ebp-0x1c4` (117 B), local display buffer `D = ebp-0x120` (13 B). `block[i]` = `[ebp-0x1c4+i]`, `disp[i]` = `[ebp-0x120+i]` | The function first **copies the block last read from the device** into `B` (`0x4ba22c`..`0x4ba23f`, `this+0x21a5`, 117 B) and the display block into `D` (`0x4ba246`..`0x4ba269`, `this+0x2252`), then overwrites the bytes it knows. Bytes it does not overwrite are echoed back unchanged (read-modify-write). fact |
| Model getters feeding it | `0x4572f0` (DPI stage vector), `0x458000` (SystemStages struct, 26 B, 13 words), `0x44bf40` (LightInfo struct, 14 B), `0x458610` (CorrectInfo), `0x40ff50` (StageCount, `this+0x1090`), `0x40ff10` (StageActive, `this+0x108c`) | JSON key strings pushed at the cited addresses, see section per setting. fact |
| Model setters (UI -> model) | `0x457bc0` (SystemStages), `0x457a80` (`DPIStages.StageActive`), `0x457b20` (`DPIStages.StageCount`), `0x457700` (stage vector) | each pushes the same JSON key strings (`0x457c24`..`0x457fba`, `0x457adb`, `0x457b7b`, `0x4577b1`..`0x457a0f`). fact |
| **Parse** (block -> model), `0x4b7045`..`0x4b74b9` (function starts `0x4b6de0`) | block copied to `this+0x21a5`; the only reads of that buffer are `0x4b70c1`..`0x4b7339`; no other instruction in the exe addresses `this+0x21a5..0x221a` except the copy at `0x4ba22c` and two writers (`0x4c245e`, `0x4c24f4`) | grep of the listing for `0x21a5`..`0x221f`, 57 hits, all classified. fact |

**SystemStages struct** (`0x458000`, 13 words at `ebp-0x20`, copy at `this+0x1094` of the profile object, UI-side copy at `this+0x2238`; struct offset in bytes):

| +off | JSON key (string @) | serializer destination | UI-side copy |
|---|---|---|---|
| +0x0 | `DoubleClickTime` `0x6a1954` | not in block (host Windows setting) | `0x2238` |
| +0x2 | `MouseSpeed` `0x6a1974` | host | `0x223a` |
| +0x4 | `PointerPrecision` `0x6a1990` | host | `0x223c` |
| +0x6 | `ScorllPage` `0x6a19b4` | host | `0x223e` |
| +0x8 | `WheelScorlllinse` `0x6a19d0` | host | `0x2240` |
| +0xa | `ReportStages.StageActive` `0x6a19e4`/`0x6a1a04` (polling) | `block[11]` | `0x2242` |
| +0xc | `DormancyTime` `0x6a1a20` | `block[86..87]` | `0x2244` |
| +0xe | (never loaded, stays 0) | not written | `0x2246` |
| +0x10 | `AntiShake` `0x6a1a64` | `block[90]` | `0x2248` |
| +0x12 | `SilentAltitudeItem` `0x6a1a40` | `block[13]` | `0x224a` |
| +0x14 | `SensorLif` `0x6a1a80` | `block[91]` | `0x224c` |
| +0x16 | `MotionSync` `0x6a1a9c` | `block[92]` | `0x224e` |
| +0x18 | `HighMode` `0x6a1ab8` | `block[10]` | `0x2250` |

All tagged fact; offsets from the load code `0x458097`..`0x458296` (stores to `[ebp-0x20+off]`) and the serializer reads `0x4ba2d4`..`0x4ba316` (`[ebp-0x14c+off]`).

**UI click handler** for the settings page: function `0x462d90` (name-prefix dispatch via `CDuiString::StartWith` `ds:0x6551a0`; control name strings are wide strings in `.rdata`). Every settings branch has the same shape: get device object (`0x46ab40`), check device type `0x4cfdb0 == 2`, store the choice in the UI helper, fetch the struct (`0x4b6a30`), patch one word, store it (`0x4b6770` copies it to `this+0x2238` and calls `0x457bc0` = setter into the model), then virtual `+0x2d4` and `+0x2a8` (UI refresh). fact. The call that actually sends the block is the serializer `0x4ba180`, reached through a virtual call that I did not locate (no direct `call 0x4ba180` in the listing; its address occurs once as data at file offset `0x2bc558` = VA `0x6bd158`, vtable at `0x6bcf48`, slot `+0x210`). unknown: which UI action triggers it and with which arguments (see `block[0]`, `block[93..96]`, `block[104]`).

## 1. Byte table, config block (117 bytes)

Row format: `block[i]`. "Raw capture" = the 64-byte `0x06` frames in `refs/wlmouse-beastx/README.md` (profile 0, chunk 0 = `block[0..23]` = `04 CS CS 06 18 00 00 00 | block[0..23]`). Capture values for `block[0..23]`: `00 04 04 04 00 00 21 00 95 01 00 PP 00 LL 01 00 40 06 40 06 10 00 c8 01` (`PP` polling, `LL` LOD).

| Byte | Meaning | Encoding / range | Serializer writes (fact) | Parse reads | Tag |
|---|---|---|---|---|---|
| block[0] | profile / session index (arg 1) | u8; capture `00` | `0x4ba5ac`/`0x4ba5b5`: `[ebp-0x1c4] = [ebp+0xc]` (caller argument) | not parsed; a separate len-1 read at address 0 fills `this+0x2190` (`0x4b6eb5`..`0x4b6efc`) | value fact; meaning inference (profile index) |
| block[1] | lighting effect (raw) | u8; model index `SelectItem` 0..11, raw = `vec[idx]` from `this+0x1aa8` (section 8); capture `04` | `0x4ba510`..`0x4ba54a` | `0x4b70c1`..`0x4b70f0`: raw -> index, stored `this+0x2191`/`0x1834` | fact |
| block[2] | lighting brightness (`Light`) | u8; capture `04`; default JSON `Light`=3 | `0x4ba550`: `[-0x1c2] = LightInfo.Light` | `0x4b711e` -> `0x2192`/`0x1835` | fact (value range unknown) |
| block[3] | lighting speed | u8 = `4 - Speed`; capture `04` => Speed 0; default JSON `Speed`=2 => `02` | `0x4ba55c`..`0x4ba56a` | `0x4b7130`..`0x4b7144`: `4 - block[3]` | fact |
| block[4] | lighting `Fx` field | u8; capture `00` | `0x4ba57c`: `[-0x1c0] = LightInfo.Fx` (key string `0x69d2ac` = "Fx") | not parsed (not copied to the model) | fact; meaning unknown |
| block[5] | lighting `MultiColor` | 0/1 (bool getter `0x4d45f0`); capture `00` | `0x4ba570` | `0x4b714a` -> `0x2195`/`0x1838` | fact |
| block[6] | lighting R (`Red`, `0x69d298`) | u8; capture `21` | `0x4ba5a0` (`[-0x1be] = LightInfo.Red`) | `0x4b7162` -> `0x2196`/`0x1839` | fact |
| block[7] | lighting G (`Green`, `0x69d29c`) | u8; capture `00` | `0x4ba594` | `0x4b717a` -> `0x2197`/`0x183a` | fact |
| block[8] | lighting B (`Blue`, `0x69d2a4`) | u8; capture `95` | `0x4ba588` | `0x4b7192` -> `0x2198`/`0x183b` | fact |
| block[9] | DPI stage count (`DPIStages.StageCount`) | u8 1..8; capture `01`; JSON default 8 | `0x4ba2b7`: `[-0x1bb] = 0x40ff50()` (`this+0x1090`), set at `0x4573a4`..`0x4573c8` | `0x4b7258` -> `this+0x2234` -> setter `0x457b20` (`0x4b7436`..`0x4b744a`) | fact (range 1..8 from the 8-iteration loops `0x4ba397`, `0x4c8e07`; inference for the minimum) |
| block[10] | High Mode (`HighMode`) | 0/1; capture `00` | `0x4ba310`: `[-0x1ba] = struct+0x18` | **not parsed** | fact |
| block[11] | polling rate index | u8 0..5 = 125, 250, 500, 1000, 2000, 4000 Hz; captures `00..05` | `0x4ba2d4`: `[-0x1b9] = struct+0xa` | `0x4b7271` -> word `this+0x2242` | fact |
| block[12] | active DPI stage index (`DPIStages.StageActive`) | u8 0-based; capture `00`; JSON default 2 | `0x4ba2c9`: `[-0x1b8] = 0x40ff10()` (`this+0x108c`) | `0x4b7417` -> setter `0x457a80`; also overwritten live by device events at `0x4c245e`/`0x4c24f4` (function `0x4c23e0`, high nibble of the event word) | fact |
| block[13] | **lift-off distance** (`SilentAltitudeItem`) | 0 = 1 mm, 1 = 2 mm; captures `00`/`01` | `0x4ba2e0`: `[-0x1b7] = struct+0x12` | `0x4b728c` -> word `this+0x224a` | fact |
| block[14+9s] | stage `s` (s = 0..7): enable flag (`StageActive`) | 0/1; capture stage 0 = `01` | loop `0x4ba397`..`0x4ba4f3`, `[ebp+i*9-0x1b6]` (`0x4ba3d4`), source `rec[0]` | not parsed | fact (loop); flag meaning from handler `DPI_enable_check_N` (section 3) |
| block[15+9s] | stage `s`: `StageXY` | 0/1; capture `00` | `0x4ba3f7`, source `rec[1]` | not parsed | fact; semantics unknown (JSON default 0) |
| block[16+9s] .. [17+9s] | stage `s`: DPI X | u16 LE, 50..26000 (UI clamp), capture stage 0 = `40 06` = 1600 | `0x4ba483`, `0x4ba3d4`+: sources `rec[2]`, `rec[3]` | not parsed | fact |
| block[18+9s] .. [19+9s] | stage `s`: DPI Y | u16 LE; capture stage 0 = `40 06` = 1600 | `0x4ba4a3`, `0x4ba4c6`, sources `rec[4]`, `rec[5]` | not parsed | fact |
| block[20+9s] | stage `s`: colour R (`StageColorR`) | u8; capture stage 0 = `10` | `0x4ba41a`, source `rec[6]` | not parsed | fact |
| block[21+9s] | stage `s`: colour G (`StageColorG`) | u8; capture `00` | `0x4ba43d`, `rec[7]` | not parsed | fact |
| block[22+9s] | stage `s`: colour B (`StageColorB`) | u8; capture `c8` | `0x4ba460`, `rec[8]` | not parsed | fact |
| block[23..85] | stages 1..7 (`9*s` for s=1..7) | same record, 63 bytes | same loop | not parsed | fact (loop), not captured |
| block[86..87] | sleep time | u16 LE seconds: idx 1 -> `1e 00` (30 s), idx 2 -> `3c 00` (60 s), idx 3 -> `2c 01` (300 s); idx 0 / other: bytes left as read | `0x4ba31c`..`0x4ba36e`: `[-0x16e],[-0x16d]` | `0x4b72a7`..`0x4b7333`: low byte `0->0, 0x1e->1, 0x3c->2, 0x2c->3` -> `this+0x2244` | fact |
| block[88..89] | constant `58 02` (= 600) | always written | `0x4ba36e` `[-0x16c]=0x58`, `0x4ba375` `[-0x16b]=0x02` | not parsed | fact (constant); purpose unknown |
| block[90] | debounce (`AntiShake`) | u8; UI list 0..12 ms (control is hidden); JSON default 10 | `0x4ba2ec`..`0x4ba2f2`: `[-0x16a] = struct+0x10` (low byte) | `0x4b7339`: `block[0x5a]` -> word `this+0x2248` | fact (location), range inference |
| block[91] | Slam Click Prevention (`SensorLif`) | 0/1; JSON default 1 | `0x4ba2f8`: `[-0x169] = struct+0x14` | not parsed | fact |
| block[92] | Motion Sync (`MotionSync`) | 0/1; JSON default 1 | `0x4ba304`: `[-0x168] = struct+0x16` | not parsed | fact |
| block[93..94] | u16 LE, argument 3 of the serializer | caller supplied | `0x4ba5be`..`0x4ba5cd` (`[ebp+0x14]`, `sar 8`) | not parsed | fact (location); meaning unknown |
| block[95..96] | u16 LE, argument 4 | caller supplied | `0x4ba5d3`..`0x4ba5e2` (`[ebp+0x18]`) | not parsed | fact; unknown |
| block[97] | surface-calibration `CorrectMinSq` of the selected item | u8 | `0x4ba66c`: `[-0x163] = item[1]` of the first `CorrectInfo` entry whose `Select` (`item[2]`) != 0, else `00` | not parsed | fact (key order `0x458759`..`0x4587cd`); meaning inference (calibration) |
| block[98] | surface-calibration `CorrectPixThresh` | u8 | `0x4ba687`: `[-0x162] = item[0]` | not parsed | fact |
| block[99..103] | not written by the serializer | echoed from the last read | none | none | fact (echo); unknown |
| block[104] | argument 2 of the serializer | caller supplied | `0x4ba5b5`: `[-0x15c] = [ebp+0x10]` | not parsed | fact (location); unknown |
| block[105..106] | not written | echoed | none | none | unknown |
| block[107] | clock: seconds, BCD | `(v/10)<<4 + v%10` | `0x4ba759`..`0x4ba772`: getter `0x4c9b80` = `tm_sec` (`[ecx+0]`) | not parsed | fact |
| block[108] | clock: minutes, BCD | | `0x4ba700`..`0x4ba733`: `0x4c9bd0` = `tm_min` (`[ecx+4]`) | not parsed | fact |
| block[109] | clock: hours, BCD | | `0x4ba6c1`..`0x4ba6f4`: `0x4c9cc0` = `tm_hour` (`[ecx+8]`) | not parsed | fact |
| block[110] | clock: weekday 0..6 (BCD of `wday+1`, minus 1) | | `0x4ba7fc`..`0x4ba832`: `0x4c9a90` = `tm_wday+1`, then `-1` | not parsed | fact |
| block[111] | clock: day of month, BCD | | `0x4ba7bd`..`0x4ba7f0`: `0x4c9ae0` = `tm_mday` | not parsed | fact |
| block[112] | clock: month 1..12, BCD | | `0x4ba77e`..`0x4ba7b1`: `0x4c9b30` = `tm_mon+1` | not parsed | fact (year is not stored) |
| block[113..116] | not written | echoed | none | none | unknown |

**block[90] is read and written.** The parse reads `0x21ff` = `this+0x21a5+0x5a` at `0x4b7339`, into `this+0x2248` = the UI-side `AntiShake` word; the serializer writes it at `0x4ba2f2`. fact.

**Parse coverage (fact, section 0).** The driver loads from the device only: `block[1]`, `[2]`, `[3]`, `[5..8]` (lighting), `[9]` (stage count), `[11]` (polling), `[12]` (active stage), `[13]` (LOD), `[86]` low byte (sleep), `[90]` (debounce), plus `disp[6]`, `disp[8..9]`. It never loads `block[4]`, `[10]` HighMode, `[14..85]` DPI stages, `[91]` Slam Click, `[92]` Motion Sync from the device; those come from the JSON and are only written. For the client this means: a faithful reader must decode every byte itself, and a writer must start from a freshly read block.

## 2. Byte table, display block (13 bytes)

`disp[i]` = `[ebp-0x120+i]` in the serializer (`0x4ba894`..`0x4ba966`); read path copies `0x35` reply to `this+0x2252` (`0x4b7070`..`0x4b7084`).

| Byte | Meaning | Encoding / range | Evidence | Tag |
|---|---|---|---|---|
| disp[0] | copy of `block[1]` (lighting effect raw) | u8; capture `04` | `0x4ba894`: `[-0x120] = [-0x1c3]` | fact |
| disp[1] | copy of `block[2]` (brightness) | u8; capture `04` | `0x4ba8a0`: `[-0x11f] = [-0x1c2]` | fact |
| disp[2] | copy of `block[3]` (`4 - Speed`) | u8; capture `04` | `0x4ba8ac` | fact |
| disp[3] | copy of `block[6]` (R) | u8; capture `21` | `0x4ba8b8`: `[-0x11d] = [-0x1be]` | fact |
| disp[4] | copy of `block[7]` (G) | u8; capture `00` | `0x4ba8c4` | fact |
| disp[5] | copy of `block[8]` (B) | u8; capture `95` | `0x4ba8d0` | fact |
| disp[6] | screen mode (`Screen_mode_combo_Select` item value) | 0 = Default, 1 = Custom (captures); stored `this+0x2258` | writer `0x4c66d7` (function `0x4c6650`: combo `0x6b38b4`, value `0x4c4bb0`); set to `1` by `0x4bd495`/`0x4bd614`, to `0` by `0x4c3bfb`/`0x4c3f48` (`screen_view_tab` `0x6b3980` handlers); serializer `0x4ba8dc`..`0x4ba8e8` | fact; other values unknown |
| disp[7] | screen byte `this+0x2259` | u8; capture `32` (50); writers set `1` (`0x4bd49f`, `0x4c3c08`) or a register (`0x4bd627`, `0x4c3f61`) | serializer `0x4ba8ee`..`0x4ba8fa` | fact (location); meaning unknown |
| disp[8..9] | frame interval | u16 LE; capture `3c 00` = 60; JSON default `FrameIntervalTime` 100 | serializer `0x4ba83e`..`0x4ba877` (low/high byte of `this+0x3350` -> `this+0x225a/b`), `0x4ba906`/`0x4ba918`; setter `0x4c8100` (`this+0x3350`, profile `0x458900`), UI edit `frame_interval_time_edit` `0x6a5f34`/`0x6b372c`; parse `0x4b7354`..`0x4b7391` | fact (location); unit (ms) inference |
| disp[10] | constant `00` | | `0x4ba924` | fact |
| disp[11] | screen byte `this+0x225d` | u8; capture `01`; setter `0x4c6610` (callers `0x4675f6`, `0x4b47ee`) | serializer `0x4ba931` | fact (location); meaning unknown |
| disp[12] | echo of the byte read from the device | u8; capture `00` | `0x4ba266`..`0x4ba269` copies read `[ecx+0xc]` to `[ebp-0x114]`; the serializer never assigns it; `0x4ba966` copies it to the output | fact |

## 3. DPI stages and the active stage

- **Location.** Stage `s` occupies `block[14+9s .. 22+9s]`, 8 stages = `block[14..85]`. Record = `{enable u8, XY u8, X u16 LE, Y u16 LE, R u8, G u8, B u8}`. Count in `block[9]`, active index in `block[12]`. fact (serializer loop `0x4ba383`..`0x4ba4f8`, `rec` field reads `[eax+0..8]`, destination `[ebp+i*9-0x1b6 ...]` => block offset `0x1c4-0x1b6 = 14`; model side `0x4572f0` fills `rec` at `ebp-0x1c..-0x14` from JSON keys `StageActive`(+0) `StageXY`(+1) `StageDPIX`(+2,+3) `StageDPIY`(+4,+5) `StageColorR`(+6) `StageColorG`(+7) `StageColorB`(+8), strings `0x6a15bc`..`0x6a1690`).
- **Encoding.** DPI is the plain DPI value as u16 LE (capture `40 06` = 0x0640 = 1600, equal to the UI default 1600; no scaling code between the edit control and the byte: `0x4c1290` returns `atoi` clamped to `[0x32, 0x6590]` = **50..26000**, then `0x465617`..`0x46563b` store low/high byte into `rec[2]`,`rec[3]`; `0x4c143d`/`0x4c1426` bound check). fact. The clamp is a UI limit; the device's accepted range is unknown.
- **Y.** The edit handler (`0x46557b`, `DPI_edit_` `0x6a7304`) writes only `rec[2..3]` (X); no handler found that writes `rec[4..5]` (Y) or `rec[1]` (XY). So the Y bytes in the block are whatever the model holds (JSON default differs: X 400 / Y 1600). Whether the device uses Y when `XY`=0: unknown.
- **Enable flag.** `DPI_enable_check_N` (`0x6a7330`, branch `0x462e3d`): `0x4c0a80(N)` reads the checkbox, `0x4c06c0` updates the UI, `0x4b64a0` fetches the vector, `vec[N][0] = state` (`0x462ed9`..`0x462edf`), `0x4b64e0` stores it (-> `0x457700`, JSON `StageActive` `0x6a16b4`). Block byte `block[14+9N]`. fact.
- **Colour.** `DPI_color_option_N` (`0x6a72e0`, dispatcher `0x46148a`) -> `0x4737a0(N)` opens `PalletDialog` (`0x6a4df4`) and stores the result: `rec[6]` = bits 16..23, `rec[7]` = bits 8..15, `rec[8]` = bits 0..7 (`0x473940`..`0x473998`). Block `block[20+9N .. 22+9N]`. fact; whether the dialog value is `0xRRGGBB` or `0xBBGGRR` is inference (the JSON/serializer name `rec[6]` as `StageColorR`, so `0xRRGGBB`).
- **Count.** `DPI_number_edit` (`0x6a7354`, handler branch `0x4658e0` -> `0x47e290`): `0x4c8c70` (`atoi` of the edit), `0x4b6730` stores into `this+0x2234` and the profile (`0x457b20`, JSON `DPIStages.StageCount` `0x6a17b8`), then if the active stage >= count `0x4b61d0` resets it. Block `block[9]`. fact. Maximum 8 (the control has `DPI_layout_%d` for 8 stages, loop `cmp 8` at `0x4c8e07`).
- **Active stage.** UI `DPI_select_check_N` (`0x6a72bc`) -> `0x4b61d0(N)` -> `0x457a80` (JSON `DPIStages.StageActive` `0x6a17a0`) -> model `this+0x108c` -> `block[12]` (`0x4ba2c9`). The mouse also pushes stage changes: `0x4c23e0` takes a 16-bit event, high byte `0x11` => `this+0x21b1 = (low byte >> 4)` (`0x4c245b`), i.e. writes `block[12]` in the host copy. fact.

Examples, stage 0 (`block[14..22]`), and stage 2 (`block[32..40]`):

| Input | Bytes | Trace |
|---|---|---|
| X=Y=1600, colour `(0x10,0x00,0xc8)`, enabled, XY=0 (the captured stage 0) | `block[14..22]` = `01 00 40 06 40 06 10 00 c8` | capture; `0x4ba3d4`..`0x4ba4f3` |
| stage 2, X = 800 | `block[32]=01 block[33]=00 block[34..35]=20 03` (Y bytes block[36..37] from the model) | `DPI_edit_2` -> `0x4c1290` -> `rec[2]=0x20`, `rec[3]=0x03` -> `block[16+9*2]=block[34]` |
| stage 7, X = 26000 | `block[79..80]` = `90 65` | clamp `0x6590`; `block[16+63]=block[79]` |
| count = 3 | `block[9]=03` | `DPI_number_edit` -> `0x4b6730` -> `block[9]` |
| active = 2 (the JSON default) | `block[12]=02` | `DPI_select_check_2` -> `0x4b61d0(2)` -> `block[12]` |

Device read, `device/backup-2026-11-17.json`: all 8 records decode with this layout (enable `01`, XY `00`, X = 1200, 800, 1600, 3200, 6400, 12000, 16000, 26000, second u16 = 1600, 3200, 5000, 6500, 400, 400, 400, 400). fact. **block[9] = `01` while all 8 enable bytes are `01`**: the count is not the number of enabled stages; its meaning on the device is unknown (the earlier sniffed capture also had `01`). The "Y" reading is unproven: with XY = 0 the second u16 differs from X for stages 0..3 and is 400 for stages 4..7; whether the firmware uses it is unknown. Write of stage 0 X (`block[16..17]`), second device session 2026-11-17: single `0x06` chunk 0 write accepted, full-block read-back matched; the value and the result are not recorded in the repo (no capture). Owner observation: the cursor speed changed. fact (device session, said by owner). Other stage fields: not written.

## 4. Polling rate (`block[11]`)

- Control names `polling_rate_option_0..5` (`mousedevice.xml:536`..; wide `0x6a7290`, ASCII `0x6b3d5c` in `0x4c14f0`); labels 125/250/500/1000/2000/4000 Hz. fact.
- Chain: click branch `0x462f77` (function `0x462d90`) -> `0x4c14f0(idx)` (selects the option; range-limits `idx >= 6 -> 0` at `0x4c153d`..`0x4c1559`) -> `0x4b6a30` fetches struct -> `[ebp-0xe2] = idx` (`struct+0xa`) -> `0x4b6770` (`this+0x2242`, setter `0x457bc0`, JSON `ReportStages.StageActive` `0x6a1874`) -> serializer `0x4ba2d4` -> `block[11]`. fact.
- Interlock (fact): if High Mode is on (`0x4c2050`, control `highmode_option`) and `idx > 3`, the branch turns High Mode off (`0x463027`..`0x463048`: `0x4c1fd0(0)`, `[ebp-0xd4]=0`); in the High Mode branch, `highmode on` and current polling `> 3` sets polling to 3 (`0x463a91`..`0x463ab5`). UI text `highmodetips` (`lan_en.xml:302`): High Mode cannot be enabled with 2K/4K.
- Range: 0..5. Examples: 1000 Hz => `block[11]=03` (capture "Poll 1000Hz" `... 95 01 00 03 ...`, CRC `0xc176`), 4000 Hz => `block[11]=05` (capture `... 95 01 00 05 ...`, CRC `0x077f`). Other captures `00`, `01`, `02`, `04`. fact (captures + code).

## 5. Lift-off distance (`block[13]`)

- UI: label `Silent_Altitude` = "LOD-Lift Off Distance" (`lan_en.xml:310`), options `Silent_Altitude_option_0` ("1 mm") and `_1` ("2 mm") (`mousedevice.xml:476`..`477`; wide `0x6a7180`; the hidden combo `Silent_Altitude_combo` lists `userdata` 2/3, unused). fact.
- Chain: branch `0x46326b` -> `0x4c1960(idx)` -> `[ebp-0x23e] = idx` (`struct+0x12`) -> `0x4b6770` (`this+0x224a`; JSON `SilentAltitudeItem` `0x6a18b0`) -> serializer `0x4ba2e0` -> `block[13]`. Parse: `0x4b728c`. fact.
- **Correction of TRIAGE section 3:** `SilentAltitudeItem` is LOD; `SensorLif` is not LOD (section 7).
- Range: 0/1. Examples: 1 mm => `block[13]=00` (capture "LOD 1mm"), 2 mm => `block[13]=01` (capture "LOD 2mm", CRC `0x3d72`). fact.

## 6. Debounce (`block[90]`)

- UI: label `Anti_Shake` = "Debounce" (`lan_en.xml:298`), combo `Anti_Shake_combo_timeSelect` with items 0..12 ms (`mousedevice.xml:497`..); the containing layouts are `visible="false"` (`mousedevice.xml:494`..`:496`), so the stock UI does not expose it. String for the control wide `0x6a7146` (`tAnti_Shake_combo_timeSelect`). fact. Handler for the combo: not located (its name string has no code xref; `Anti_Shake` `0x6a7146` unreferenced). unknown.
- Model/block chain without the UI: JSON `AntiShake` (`0x6a1a64`, default 10) -> struct `+0x10` -> `block[90]` (`0x4ba2f2`); parse `0x4b7339` (`block[0x5a]` -> `this+0x2248`). fact.
- Range: u8; UI list 0..12 (inference for the device limit). Examples: 10 ms (JSON default) => `block[90]=0a`; 0 => `00`. Never captured: unknown on device.

## 7. Sleep, Slam Click Prevention, Motion Sync, High Mode

| Setting | Control (string @) | Handler | Model | Block | Encoding / range | Examples |
|---|---|---|---|---|---|---|
| Sleep | `Dormancy_option_1..3` (`0x6a6ec4`; "30s", "1min", "5min", `mousedevice.xml:454`..`456`), hidden combo `Dormancy_combo_timeSelect` (items 0..3 hidden) | `0x463169` -> `0x4c17d0(idx)` -> `[ebp-0x260] = idx` (`struct+0xc`) -> `0x4b6770` | JSON `DormancyTime` `0x6a1a20` (default 1) | `block[86..87]` | model idx 1/2/3 -> u16 LE seconds 30/60/300; idx 0 leaves the old bytes | 30 s => `1e 00`; 5 min => `2c 01`; 1 min => `3c 00` (code `0x4ba31c`..`0x4ba36e`) |
| Slam Click Prevention (`SensorLif`; `lan_en.xml:300`) | `sensor_lif_optioncheck` (`0x6a7014`, `mousedevice.xml:516`; visible) | `0x4638d5` -> `0x4c1f70` reads the checkbox, `0x4c1ef0` updates UI -> `[ebp-0x1cc] = state` (`struct+0x14`) -> `0x4b6770` | `SensorLif` `0x6a18f0` (default 1; getter `0x45822f` is a bool) | `block[91]` | 0/1 | on => `01`; off => `00` (`0x4ba2f8`) |
| Motion Sync | `motion_sync_optioncheck` (`0x6a7044`, `mousedevice.xml:487`; visible) | `0x4637cd` -> `0x4c1d00` reads the checkbox, `0x4c1c80` updates UI -> `[ebp-0x1e6] = state` (`struct+0x16`) -> `0x4b6770` | `MotionSync` `0x6a190c` (default 1) | `block[92]` | 0/1 | on => `01`; off => `00` (`0x4ba304`) |
| High Mode | `highmode_option` (`0x6a6ccc`, `mousedevice.xml:526`; visible) | `0x4639dc` -> `0x4c2050` reads the checkbox, `0x4c1fd0` updates UI -> `[ebp-0x10c] = state` (`struct+0x18`) -> `0x4b6770`; polling interlock in section 4 | `HighMode` `0x6a1ab8` (default 0) | `block[10]` | 0/1 | on => `01` and forces polling index <= 3; off => `00` (`0x4ba310`) |

All fact except: the unit/meaning of High Mode on the device (UI tip says it raises performance and power draw; effect unknown), and that Sleep idx 0 leaves the previous bytes (fact in code, but UI never emits idx 0: the item is `visible="false"`).

Capture status: none of block[10], [86..87], [90..92] appears in the sniffed frames beyond the zeros in `block[0..23]` (`block[10]=00` is in the captures: High Mode off). unknown on device otherwise.

## 8. Lighting (`block[1..8]`, `disp[0..5]`)

Lighting **is present in the driver's model** for this device family: `LightInfo` (`0x69d258`, `0x69d264`) with keys `SelectItem` `0x69d270`, `Light` `0x69d27c`, `Speed` `0x69d284`, `Fx` `0x69d2ac`, `MultiColor` `0x69d28c`, `Red` `0x69d298`, `Green` `0x69d29c`, `Blue` `0x69d2a4`, `ZZCCLedMode` `0x69d2b0`, `CustomGroup` `0x69d2bc`, `OldLedmode` `0x69d2c8` (loader `0x44bf40`, struct `ebp-0x20`: +0 SelectItem, +1 Light, +2 Speed, +3 Fx, +4 MultiColor, +5 Red, +6 Green, +7 Blue, +0xb ZZCC, +0xc CustomGroup, +0xd Old). `Mouse.json` default: `Light 3, Speed 2, MultiColor false, Red 255, SelectItem 0`. fact. The UI has a full lighting panel (`lighteffect_layout`, `light_combo_modeSelect`, `deng_light_slider`, `deng_speed_slider`, `R/G/B_light_slider`; wide strings `0x6925ec`.., `0x6935a0`, `0x693540`, `0x69351c`, `0x6a3bc0`). Whether this physical mouse has an LED that responds: **unknown** (the capture shows non-zero values `04 04 04 .. 21 00 95`, which are the driver's echo of what the device returned).

| Setting | Byte | Encoding | Example |
|---|---|---|---|
| effect | `block[1]` (and `disp[0]`) | raw = `vec[SelectItem]`, `vec` = `this+0x1aa8`, filled from `default_light.json` (`0x4b5440`, `DefaultLightName` group, `value` fields) | capture raw `04` (parse maps it back to the first index whose value is 4) |
| brightness | `block[2]` (`disp[1]`) | u8 | `Light`=3 => `03`; capture `04` |
| speed | `block[3]` (`disp[2]`) | `4 - Speed` | `Speed`=2 => `02`; capture `04` => 0 |
| multi-colour | `block[5]` | bool | capture `00` |
| RGB | `block[6..8]` (`disp[3..5]`) | R, G, B | `Red`=255 => `ff 00 00`; capture `21 00 95` |

Effect map. `vec` has 12 entries on the path the serializer uses (`cmp 0xc` at `0x4ba523`; `idx >= 12 -> 0`). The 12-entry group in `default_light.json` is the second group (inference that this device uses it; the selector `this+0x1b58` was not traced): index -> raw: 0:3 wave, 1:2 mix colour, 2:1 breath, 3:0 static, 4:-1 (invisible), 5:4 pulse ("Single Wave", `lan_en.xml:380`), 6:5 reaction, 7:-1, 8:-1, 9:6 off, 10:-1, 11:7 audio-record. The captured raw `04` then means index 5 (pulse). inference. Raw `-1` would be written as `0xff`: inference.

Chain, effect: UI `light_combo_modeSelect` (`0x6935a0`) -> LightInfo `SelectItem` -> `0x44bf40` -> serializer `0x4ba510`..`0x4ba54a` -> `block[1]`; the display block echoes it (`disp[0]`, `0x4ba894`). I traced the byte path from the model, not the combo handler. fact (model->byte), unknown (handler address).

## 9. Button mapping

**Not in either block.** Evidence:

1. The serializer writes every byte of the 117-byte block it owns (sections 1) and no byte range holds per-button data: stages `14..85`, lighting `1..8`, system `86..98`, clock `107..112`; the unwritten bytes (`99..103`, `105..106`, `113..116`) are echoed, 11 bytes total, too few for 20+ buttons at 3 bytes each. fact (arithmetic from the table).
2. The button list lives in `Mouse.json` as `KeyList[]` with `Assignment`/`DefaultAssignment` (`0x69d6d8`, `0x69d6ec`), 114 entries in the template (`grep -c Assignment`), each a 32-bit value (e.g. `1052672` = `0x101000`... as a 3-byte value). fact.
3. The `0x0b` write wrapper (`0x487bf0`, indexed table write `(buf, len, a, b)`) is called from `0x4b1270`..`0x4b1534` with a **3-byte-per-key** buffer: `buf[i*3+0..2]` from vector lookups `0x421440` stored with `imul i,3` (`0x4b1466`, `0x4b14a2`, `0x4b14de`), key index guarded by `cmp 0x14` (`0x4b1296`) and `0xff` (`0x4b1431`). So the key map goes through `0x0b` (write) and presumably `0x0a` (read); not through `0x05/0x06`. fact (write shape); the 3-byte layout of one assignment and the address scheme are **not decoded here**: unknown.

Both `0x0a` and `0x0b` stay "Forbidden/unknown" in `docs/PROTOCOL.md`; this study does not clear them.

## 10. Settings not present on this device (or not decoded)

- **Ripple control, angle snap, line correction.** No string in the exe (case-insensitive ASCII + UTF-16 scan of `allstrings.txt`: no `ripple`, `angle`, `snap`, `straight`), no key in `Mouse.json`, no control in `Skin/XML/DeviceXml/mousedevice.xml`. The only hit for "Ripples" is a **lighting effect** name (`lan_en.xml:386`, `light_mode_stone_text`, effect value 8 in group 0), not a sensor setting. fact (absence in the shipped driver); the firmware may still have such a byte: unknown. No block byte is assigned to them by the serializer.
- **Surface calibration** (`CorrectInfo`: `CorrectPixThresh`, `CorrectMinSq`, `CorrectSelect`, `CorrectName`; UI text "Calibration", `lan_en.xml:33`): `block[97]`, `block[98]` carry the selected item. This is a possible stand-in for a sensor tuning feature but the semantics are inference.
- **Report-rate high mode / 8K**: UI offers only up to 4000 Hz.
- **Battery**: not in these blocks (see `.pi/research/battery.md`).

## 11. Confidence and gaps

First read (2026-11-17, `device/backup-2026-11-17.json`, decode in `docs/PROTOCOL.md` "First read"): every offset below that the read touches matched this table: block[1..3], [11], [12], [13], stage records `14..85` (8 enabled, X 1200..26000, colours), [86..87], [88..89], [90..92], clock [107..112], disp[0..2], disp[3..5], disp[6], disp[8..9]. These are now fact on the device (read only, no write sent). Exceptions: block[9] = 1 with 8 enabled stages contradicts the count reading (see section 3 note); the second u16 per stage is bytes at the Y offset but "Y" is unproven (stage 0 has XY = 0 and Y 1600 against X 1200; stages 4..7 have Y 400); block[5] = 1 (MultiColor) with RGB `00 00 ff`; block[104] = 1; the clock holds a stored time (21:36:32, day 4, month 10), not the read time.

- Block offsets for polling (`11`), LOD (`13`) and display mode (`disp[6]`): fact (captures + code).
- Second device session (2026-11-17, said by owner): `block[11]` written 1000 -> 500 Hz (index 3 -> 2) as a single `0x06` chunk 0 write; read-back matched, UI showed 500; owner observation: LED flashed yellow, no felt difference. fact on the device until the next read; persistence across a receiver power cycle unknown. `block[9]` meaning still unknown, not written.
- Offsets the first read did not exercise (block[93..103], [105..106], [113..116] all zero there) stay code-only. Writes: only `block[11]` and `block[16..17]` are verified (previous bullet); all other offsets are unwritten.
- Open: caller of the serializer (arguments for `block[0]`, `block[93..96]`, `block[104]`), the combo handler for debounce, the effect-map selector, the keymap table layout, the meaning of `block[4]`, `block[88..89]`, `disp[7]`, `disp[11]`.
- Corrections to `docs/PROTOCOL.md` (do not edit here, `docs/**` not owned): `block[16..19]` is not "active stage DPI" but stage 0 DPI X/Y; `block[0x56]` is the u16 sleep time in seconds, not "enumerated"; `block[0x5a]` is debounce; `block[9]` is the stage count, `block[12]` the active stage; `block[1..8]` lighting. The TRIAGE guess that `SensorLif` = LOD is wrong: LOD = `SilentAltitudeItem` (`block[13]`), `SensorLif` = Slam Click Prevention (`block[91]`).
