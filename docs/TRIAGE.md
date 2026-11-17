# TRIAGE: `refs/driver/app/WLmouse.exe` and its DLLs

Static triage for HID protocol recovery (ticket tic-4254). Nothing here was executed; no device or vendor binary was touched.
Tags: **fact** = address/string/capture, **inference**, **unknown**. Addresses are Ghidra image addresses (32-bit PE, ImageBase `0x00400000`).
VA to file offset: `.text` file = VA - `0x401000` + `0x400`; `.rdata` file = VA - `0x655000` + `0x254400`; `.data` file = VA - `0x6ee000` + `0x2ecc00`.
Tooling: `objdump -d -M intel` (full listing cached in `~/.cache/beastx-triage/wlmouse.dis`), REA/Ghidra 12.2 snapshot `~/.cache/beastx-triage/wlmouse.snap`, helper scripts in the same dir.

## 1. Format and build

| Item | Value | Evidence |
|---|---|---|
| Format / arch | PE32, i386, GUI subsystem (2) | `objdump -f`: `pei-i386`, Subsystem `0x00000002` |
| Image base / entry | `0x00400000` / `0x0060f7b4` (RVA `0x20f7b4`) | `objdump -f` start address |
| Linker | MSVC linker 14.0 (VS2015+), link time Mon Jan 22 07:34:40 2024 | `MajorLinkerVersion 14`, PE Time/Date |
| Runtime | MFC statically linked plus DuiLib (imports `DuiLib.dll`), GDI+, WinHTTP, `opencv_world320.dll` | RTTI `.?AVCMFCAutoHideButton@@` `0x6f37a4`; import list |
| PDB hint | `\Code\Output\NeoUsb.pdb` | string at `0x6ca3d9`; Debug Directory RVA `0x2bdda0` |
| App-level RTTI | `.?AVCEevisionUSBDevice@@` `0x6f63d8`, `.?AVCAboutWnd@@` `0x6f4fb0`, `.?AVCCloudShareListItemUI@@` `0x6f58a8`, `.?AVCUpdateInfoListItemUI@@` `0x6f6054`, `.?AVCDPIEditUI@@` `0x6f5a84` | strings |
| Source tree hint | `\code\neousb\opencv\include\...` (many hits, e.g. `0x68f464`) | strings. "NeoUsb" / "Eevision" = a generic OEM keyboard/mouse driver framework, not Beast X specific (inference) |
| Packing | None seen: normal section names, readable import table (inference) | `objdump -h` |

Sections (`objdump -h`): `.text` `0x401000` size `0x253e37`; `.rdata` `0x655000` size `0x9872e`; `.data` `0x6ee000` size `0x8800`; `.gfids` `0x705000`; `.tls` `0x720000`; `.rsrc` `0x721000` size `0x6e898`; `.reloc` `0x790000`. No exports. Import directory RVA `0x2e2b44`, IAT RVA `0x255000` (VA `0x655000`).

Inference: the exe reuses the same framework for several OEM products (strings `AK60`, `eevision_A_001_20180108_ak60`, `VS11k09A`, `SensorModel` at `0x6a1e70`, `0x6a1ea8`, `0x6a1edc`, `0x6a1ee8`; `DefaultData/Mouse.json`). Only a few device records are Beast-family.

## 2. Imports by capability, with callers

IAT slot VA = `0x400000 + RVA` (objdump lists RVA). Callers below are every `call [IAT]` site found by scanning `.text` (script `iatrefs.py`).

### HID (`HID.DLL`, library name string `0x6e4018`)
Imported: `HidD_SetOutputReport`, `HidD_GetHidGuid`, `HidD_GetPreparsedData`, `HidD_GetAttributes`, `HidP_GetCaps`, `HidP_GetSpecificButtonCaps`, `HidP_GetSpecificValueCaps`, `HidP_MaxUsageListLength`, `HidP_GetUsages`, `HidP_GetUsageValue`, `HidP_GetScaledUsageValue`.
**Not imported: `HidD_SetFeature`, `HidD_GetFeature`, `HidD_GetInputReport`.** The exe never uses feature reports. The Beast X configuration path therefore uses `WriteFile`/`ReadFile` on the HID handle (output/input reports), not feature reports (fact: absence in import list; contrast with gm-web, which uses feature reports).

| Import | IAT VA | Call sites (VA) | Enclosing function |
|---|---|---|---|
| `HidD_GetHidGuid` | `0x655a08` | `0x4d1d4a` | `0x4d1d20` enumerate |
| `HidD_GetPreparsedData` | `0x655a0c` | `0x4d1f46` | `0x4d1f20` open-init |
| `HidD_GetAttributes` | `0x655a10` | `0x4d1f5e` | `0x4d1f20` |
| `HidP_GetCaps` | `0x655a14` | `0x4d1f75` | `0x4d1f20` |
| `HidP_GetSpecificButtonCaps` | `0x655a18` | `0x4d1fea`, `0x4d21f0`, `0x4d243c` | `0x4d1f20` |
| `HidP_GetSpecificValueCaps` | `0x655a1c` | `0x4d200d`, `0x4d2213`, `0x4d245f` | `0x4d1f20` |
| `HidP_MaxUsageListLength` | `0x655a20` | `0x4d20dc`, `0x4d2325`, `0x4d2574` | `0x4d1f20` |
| `HidP_GetUsages` | `0x655a24` | `0x4d2cc0` | `0x4d2c60` input parser |
| `HidP_GetUsageValue` | `0x655a28` | `0x4d2d22` | `0x4d2c60` |
| `HidP_GetScaledUsageValue` | `0x655a2c` | `0x4d2d4d` | `0x4d2c60` |
| `HidD_SetOutputReport` | `0x655a04` | `0x498a8d`, `0x498aeb`, `0x498b56`, `0x498bb4`, `0x498c1f`, `0x498c7d`, `0x498ce8`, `0x498d58`, `0x498dd5`, `0x498e45`, `0x498ec2`, `0x498f32` | all in `0x4987c0` (17-byte `0xFF 0x22 0xAA` frames; keyboard LED path, see section 4) |

### Device enumeration / notification (`SETUPAPI.dll`, `USER32.dll`)
| Import | IAT VA | Call sites | Function |
|---|---|---|---|
| `SetupDiGetClassDevsW` | `0x655d3c` | `0x4d1d66` (flags `0x12` = PRESENT\|DEVICEINTERFACE) | `0x4d1d20` |
| `SetupDiEnumDeviceInterfaces` | `0x655d38` | `0x4d1dcc` | `0x4d1d20` |
| `SetupDiGetDeviceInterfaceDetailW` | `0x655d34` | `0x4d1de9`, `0x4d1e1a` | `0x4d1d20` |
| `SetupDiDestroyDeviceInfoList` | `0x655d30` | `0x4d1edc`, `0x4d1efd` | `0x4d1d20` |
| `RegisterDeviceNotificationW` | `0x655f3c` | `0x49c91a` | `0x49c860` hot-plug registration |

### Raw I/O (`KERNEL32.dll`)
| Import | IAT VA | HID-related sites | Other sites (inference: file/CRT, not HID) |
|---|---|---|---|
| `CreateFileW` | `0x655c00` | `0x4d2a10` (in `0x4d2990`, open overlapped, share RW) | `0x449246`, `0x469b2b`, `0x482d64`, `0x4f10e9`, `0x4f1437`, `0x517db7`, `0x558538`, `0x6395da`, `0x63a613` |
| `WriteFile` | `0x655bfc` | `0x4d2bf2` (in `0x4d2ba0` write-with-timeout) | `0x449347`, `0x4f1641`, `0x62e774`..`0x62ee44` (CRT) |
| `ReadFile` | `0x655bc8` | `0x4d2b32` (in `0x4d2ae0` read-with-timeout) | `0x482dba`, `0x4f149f`, `0x6219a6`, `0x62f8c9`.. (CRT) |
| `GetOverlappedResult` / `CancelIo` | `0x655b88` / `0x655b84` | `0x4d2b6f`, `0x4d2c2f` / `0x4d2b7c`, `0x4d2c3c` | none |
| `DeviceIoControl` | n/a | not imported by the exe | n/a |

Others: `WINHTTP.dll` (cloud/update checks; strings `%s/api/password/reset` `0x696e34`, `updated_at` `0x696774`), `WINMM.dll`, `HookDLL.dll` (`InstallHook`/`UnInstallHook`), `opencv_world320.dll`, GDI/GDI+/UxTheme/Shell. No registry/crypto imports of interest were looked at.

## 3. Setting names: strings and constants

JSON-style keys (ASCII, `.rdata`). They match `refs/driver/app/DefaultData/Mouse.json` and are the app's settings-model names, not wire names.

| Setting | String @ address | Note |
|---|---|---|
| DPI | `DPIStages` `0x6a03a4`/`0x6a10bc`; `StageDPIs` `0x6a0fcc`/`0x6a11ac`; `StageDPIX` `0x6a166c`; `StageDPIY` `0x6a1690`; `StageCount` `0x6a17b8`; `StageActive` `0x6a15bc`; `StageColorR/G/B` `0x6a1628`/`0x6a1604`/`0x6a15e0`; `StageXY` `0x6a164c` | `Mouse.json` has 8 stages, X and Y separate |
| Polling / report rate | `PollingRate` `0x69fee4`/`0x69ff90`; `ReportStages` `0x6a1864`/`0x6a19e4`/`0x6a19f4` | rrroyal captures: polling uses cmd `0x06` (inference which of the two key names maps to it) |
| Lift-off distance | `SensorLif` `0x6a18f0`/`0x6a1a80` (literal, truncated); `SilentAltitudeItem` `0x6a18b0`/`0x6a1a40` | corrected by `docs/settings/config-block.md`: `SilentAltitudeItem` = LOD (`block[13]`), `SensorLif` = slam click prevention (`block[91]`) |
| Debounce | `AntiShake` `0x6a18d4`/`0x6a1a64` | inference (`Mouse.json` default 10) |
| Sleep | `DormancyTime` `0x6a1890`/`0x6a1a20` | inference |
| Motion sync | `MotionSync` `0x6a190c`/`0x6a1a9c` | fact: name; default 1 |
| Performance mode | `HighMode` `0x6a1928`/`0x6a1ab8` | unknown semantics |
| Display (OLED) | `ScreenStages` `0x6a1ac4`, `OledMode` `0x6a1ad4`, `PictureCount` `0x6a1af0` | rrroyal "Display" cmd `0x36` is probably this (inference) |
| Lighting | `LEDREGMode` `0x69d480`, `LEDDirection` `0x69d48c`, `LEDBrightness` `0x69d4b8`, `LEDSpeed` `0x69d4ac`, `StageColor*` | |
| Windows pointer settings | `DoubleClickTime` `0x6a17d4`, `MouseSpeed` `0x6a17f4`, `PointerPrecision` `0x6a1810`, `ScorllPage` `0x6a1834` | host side, not device |
| Device identity | `DeviceBasicInfo` `0x69d4d4`, `SensorModel` `0x69d4fc`, `DevciesChipmodel` `0x69d514`, `DeviceNUMInfo` `0x69d528` | |
| Firmware / update UI | `UpdateInfoListItemUI` `0x69b9b4`, `update_progress_value` `0x69ba18`, `update_status_text` `0x69ba8c`, `UpdateFailText` `0x69bbcc`; EN text `GetUpdateInfoText`, `UpdateTiShiText` in `Skin/lan_en.xml` lines 351-359 | see Danger list |
| Reset | `Reset to default settings?` (`message_text_22`, `Skin/lan_en.xml` line 72); `shootdate_reset_btn` `0x69b8f0` | UI strings only |

**Not found in the exe (fact, case-insensitive ASCII/UTF-16 scan):** battery (power UI exists as `CMpDevicePowerUI`, see `docs/settings/battery.md`), ripple, angle snap, pair/pairing, DFU, bootloader, "firmware" as plain strings, receiver/wireless. Battery strings, if any, live in `Skin/XML/CustomControlXML/MpDevicePower.xml` (not read; unknown).

### VID/PID constants (immediates)
The exe has no `cmp reg, 0x36a7`. Instead it builds a static device-record table in the C++ initializer **`0x402970`** (ends `0x402fbf`), 0x9c bytes per record, base `0x6fea78`, record count global at `0x6f07fc`.

| Record | Address | Immediates (build site) | Meaning |
|---|---|---|---|
| 4 | `0x6fece8` | VID `0x36a7` `0x402bc1`, PID `0xa888` `0x402bcd`; +0xe=`0xff1c`, +0x10=`0x92` (`0x402c0d`/`0x402c18`) | sibling PID, vendor collection |
| 5 | `0x6fed84` | `0x36a7` `0x402c51`, `0xa888` `0x402c5d`; +0xe=`0x0c` | sibling PID, consumer collection |
| **6** | **`0x6fee20`** | `0x36a7` `0x402ce5`, **`0xa887`** `0x402cf0`; +0xe=`0xff1c` `0x402d2d`, +0x10=`0x92` `0x402d39` | **Beast X receiver, vendor page 0xFF1C usage 0x92** (matches `device/rdesc.txt` if00) |
| **7** | **`0x6feebc`** | `0x36a7` `0x402d72`, **`0xa887`** `0x402d7e`; +0xe=`0x0c`, +0x10=`0x01` | **Beast X receiver, consumer page 0x0C usage 1** (if02) |
| 8-9 | `0x6ff00c`..`0x6ff0a8` | VID `0x0c76`, PID `0x1630` (`0x402f1a`, `0x402f26`) | other product |
| other | `0x6fd4f8`/`0x6fd4fc` | `0x36a7`/`0xa888` stored as DWORDs (`0x402301`, `0x40230b`) in a different 0x230-byte-stride settings table at `0x6fd4e8` | per-device settings record, `[idx*0x230+0x6fd4f4]` read at `0x46bb02`, `0x46d6be`.. |

Field layout (fact for vid/pid/usagePage/usage; inference for the rest): `+0x00 u16 VID, +0x02 u16 PID, +0x0e u16 usagePage, +0x10 u16 usage`, read by the matcher at `0x469e70` (`movzx [reg+0x6fea78]` .. `+0x6fea88`, `0x469eac`..`0x469f38`). Meaning of `+0x04..+0x0c`, `+0x12`, `+0x14` (record 6: `7,5,6,7,5` and `1,4`) is **unknown**; could be report IDs/lengths/interface roles.
Record 6 `+0x14 = 4` equals the report ID 4 in `device/rdesc.txt` (weak inference). Records for PID `0xa888` have `+0x14 = 6`.

Also: `0x0c76`/`0x1630` and `wch@` at `0x50ddfc` are unrelated.

## 4. Candidate functions

| Role | Address | Reason (all fact from disassembly unless marked) |
|---|---|---|
| Device-table init | `0x402970` | stores the VID/PID/usage records above |
| Enumerate HID paths | `0x4d1d20` | `HidD_GetHidGuid` `0x4d1d4a` then `SetupDiGetClassDevsW` `0x4d1d66`, enum loop `0x4d1dcc`, wide path copy `0x4d1e60`; sig `(char**paths, uint*count)`, returns 1 |
| Table match (by VID/PID + usage) | `0x469c40`, `0x469e70` | loops `DAT_006f07fc` records, compares param words to `[0x6fea78+i*0x9c]` fields; callers inside `0x469690` (`0x469996`, `0x469a25`) which also calls `CreateFileW` at `0x469b2b` (inference: non-HID, file) |
| Open device | `0x4d2990` (wrapper `0x4d2a50`) | `CreateFileW` `0x4d2a10` with flag `0x40000000` (OVERLAPPED), then calls `0x4d1f20` |
| Init after open | `0x4d1f20` | `GetPreparsedData` `0x4d1f46`, `GetAttributes` `0x4d1f5e` into `this+0x26c` (VID at `+0x270`, PID `+0x272`), `GetCaps` `0x4d1f75` into `this+0x22c` (report lengths at `+0x230`, `+0x232`), allocs buffers, value/button caps |
| Packet send (raw, overlapped, timeout) | `0x4d2ba0` | `WriteFile` `0x4d2bf2`, wait, `GetOverlappedResult` `0x4d2c2f`, args `(buf,len,&written,timeout_ms)` |
| Packet receive (raw) | `0x4d2ae0` | `ReadFile` `0x4d2b32`, same shape |
| Parse input report | `0x4d2c60` | `HidP_GetUsages`/`GetUsageValue`/`GetScaledUsageValue` (button/value caps), used by listeners `0x49bcd0`, `0x4aef50`, `0x4bdf90`, `0x4ce380` |
| **Send+receive transaction** | **`0x4840e0`** | takes `(txbuf64, 0x40, rxbuf64, 0x40, &out)`; computes checksum at `0x484628`, patches buf[1..2] (`0x484647`, `0x48465b`), writes via `0x4d2ba0` (`0x484694`/`0x4846c4`), reads via `0x4d2ae0` (`0x4847c6`, `0x4848ce`); 2000 ms timeout when `buf[3]==0x15` (`0x48466c`), 500 ms otherwise, 1000 ms (`0x4846e9`) on the wired/other path; 18 call sites `0x485ce5`..`0x4890ea` |
| Sibling transactions | `0x484d90`, `0x485850` | same pattern, call checksum at `0x4852ce`, `0x485954`, `0x485a4f`; write at `0x48533a`, `0x48599c` |
| **Checksum** | **`0x483e80`** | bitwise CRC-16: init `0xFFFF` (`0x483e86`), per byte 8 rounds `crc = (crc>>1) ^ table[(crc^byte)&1]`, table `{0x0000,0xA001}` at `0x6f0b64` (bytes `00 00 01 a0` at file `0x2ef764`) = **CRC-16/MODBUS**. `(ptr, len)` |
| Checksum verified | (offline) | against rrroyal packet `04 c0 96 36 0d ...`: CRC-16/MODBUS over bytes[3..31] (29 bytes, `push 0x1d` at `0x484622`) = `0x96c0` = bytes[1..2] little-endian. Script `~/.cache/beastx-triage/crc.py`. **Fact (single packet)**; checksum session should confirm on all packets |
| Command wrappers | see table below | each memsets a 0x40 buffer (`call 0x6147c0`), sets `buf[0]=4` and `buf[3]=cmd`, then calls `0x4840e0` |
| Hot-plug | `0x49c860` | `RegisterDeviceNotificationW` `0x49c91a` |
| Legacy keyboard LED sender | `0x4987c0` | 12x `HidD_SetOutputReport` with 17-byte frames `FF 22 AA ..`, `FF 44 AA ..`, `FF AD ..` (`0x498a1b`..`0x498a8d`), handle at `this+0x8b4`; (inference) AK60-style keyboard lighting, not Beast X |

Packet frame (fact where tied to code; matches captures): 64 bytes, `[0]=0x04` report ID (`0x485da5`, `0x488fe5`), `[1..2]` CRC-16 LE, `[3]` command, `[4]` length-ish (`0x0d`, `0x18` in captures; inference), payload; trailing zeros. Wrapper also contains a byte-loop over 0x40 bytes (`0x488e67`) that writes buf[1..2] before the sender overwrites it with the CRC (inference: legacy checksum, overwritten at `0x48465b`).

### Command wrappers (buf[3] = cmd). Extracted by script `callers.py`; byte values are fact, labels are inference
| Wrapper fn | Call site | cmd | Note |
|---|---|---|---|
| `0x485b60` | `0x485ce5` | `0x01` | |
| `0x485d70` | `0x485efd` | `0x02` | |
| `0x485f90` | `0x486115` | `0x1c` | |
| `0x4861a0` | `0x48639c` | `0x03` | |
| `0x486480` | `0x4866a2` | `0x09` | |
| `0x486740` | `0x486962` | `0x27` | |
| `0x486a00` | `0x486bf2` | `0x15` | special 2 s timeout in `0x4840e0` (`0x48466c`); store/commit? unknown |
| `0x486c90` | `0x486e54` | `0x17` | |
| `0x486ed0` | `0x4870b0` | `0x07` | |
| `0x487170` | `0x48735c` | `0x1b` | |
| `0x487420` | `0x4875ea` | `0x0a` | |
| `0x487950` | `0x487b17` | `0x37` | |
| `0x487bf0` | `0x487dfa` | `0x0b` | |
| `0x488140` | `0x488328` | `0x06` | = rrroyal LOD/polling frame (`06 18`) |
| `0x4883c0` | `0x4885a8` | `0x36` | = rrroyal Display frame (`36 0d`) |
| `0x488640` | `0x488812` | `0x35` | |
| `0x4888d0` | `0x488aa2` | `0x05` | |
| `0x488b60` | `0x488c9a` | `0x1a` | |
| `0x488d50` | `0x488ef2` | `0xaa` | unknown, see Danger |
| `0x488fb0` | `0x4890ea` | `0xc0` | unknown, see Danger |

## 5. Neighbour binaries

| File | Facts | Touches the device? |
|---|---|---|
| `DuiLib.dll` (x86, 1,522,688 B, ImageBase `0x11000000`) | imports KERNEL32, USER32, GDI32, SHELL32, ole32, OLEAUT32, IMM32, COMCTL32, gdiplus, WS2_32, SHLWAPI; no `HID.DLL`, no `SETUPAPI.dll`. UI toolkit (the exe imports its C++ names, e.g. `?Create@CDialogBuilder@DuiLib@@...` `0x6e9748`) | No (its `ReadFile`/`WriteFile` imports are generic file I/O) |
| `HookDLL.dll` (x86, 45,056 B) | exports `?InstallHook@@YAHPAUHWND__@@H@Z`, `?UnInstallHook@@YAHPAUHWND__@@@Z`; imports only USER32/KERNEL32 (`SetWindowsHookExW`, `UnhookWindowsHookEx`, `CallNextHookEx`); PDB `F:\HOOK\MyTestAutomator_src\...\HookDLL.pdb` | No. Global input hook used by the app (inference: for key/macro capture) |
| `SDK/x86/vista/osConfLib.dll`, `SDK/x64/vista/osConfLib.dll` (PDB `d:\Project\ConfLib\ConfLib_Vista\Release\osConfLib.pdb`) | exports `ConfLibInit`, `ConfLibInitWithGUID`, `ConfLibUnInit`, `CreateDeviceList`, `GetDeviceById`, `GetDeviceCount`, `PropertyControl`, `RegisterCallbackFunction`, `RunListen2Device`, `StopListen2Device`, `ShowAsioPanel`, `PlayTestSound`, `StopTestSound`, `CloseTestSound`, `DirectShowNotifyProc`; imports WINMM, ADVAPI32, SETUPAPI (`SetupDiGetClassDevsW`, `SetupDiEnumDeviceInfo`, `SetupDiGetDeviceRegistryPropertyW`), KERNEL32, USER32, ole32, OLEAUT32, `DeviceIoControl`, `CreateFile*`; **no `HID.DLL`**. The exe's own strings `GetDeviceById` `0x69bfb4`, `GetDeviceCount` `0x69bff0`, `CreateDeviceList` `0x69c000`, `ConfLibUnInit` `0x69c014`, `ShowAsioPanel` `0x69c024`, `PlayTestSound` `0x69c034` show it loads this DLL dynamically | It is an audio-device library (ASIO, test sounds; `waveIn`). Not the mouse channel (inference). Used for the headset/voice product (`Voice6533Control.xml`, `hs6533device.xml`) |
| `opencv_*320*.dll` | video/image (screen/OLED GIF features) | No |

## Danger list (do not send, do not call)

Policy from AGENTS.md: never send anything on a firmware, DFU, bootloader, pairing or factory-reset path; unknown command purpose means do not send.

1. **Firmware update UI and cloud path**: class `CUpdateInfoListItemUI` (`0x6f6054`), functions around `0x444850` (strings `update_progress_value` push at `0x44492f`, `update_status_text` `0x444863`) and `0x444da0` (`0x444def`), `UpdateFailText` push `0x444bf8`. The warning text in `Skin/lan_en.xml` (`UpdateTiShiText`, "avoid upgrade errors") tells that this flashes devices. The device-side opcodes for the flash/boot path were **not located** in this triage; treat every command not in the "known" set as potentially destructive.
2. **Commands with unknown purpose** (all sent through `0x4840e0`, all must stay unsent until phase 2 labels them): `0x15` (wrapper `0x486a00`, uniquely given a 2 s timeout at `0x48466c`, a pattern typical for flash/commit), `0xaa` (wrapper `0x488d50`, call `0x488ef2`), `0xc0` (wrapper `0x488fb0`, call `0x4890ea`), and the entire set `0x01 0x02 0x03 0x05 0x07 0x09 0x0a 0x0b 0x17 0x1a 0x1b 0x1c 0x27 0x35 0x37`. Only `0x36` (Display) and `0x06` (LOD / polling) have a capture in `refs/wlmouse-beastx/README.md` (fact), and even those need the read-before-write routine from AGENTS.md.
3. **Reset-to-defaults**: UI text `message_text_22` "Reset to default settings?" (`Skin/lan_en.xml:72`), button `default_set_text`; its handler/command was not traced. Treat as a factory-reset path.
4. **Legacy keyboard path `0x4987c0`** (`HidD_SetOutputReport`, frames `FF xx AA`): different device family (17-byte frames, `this+0x8b4` handle). Never reuse on interface 01/02 of the Beast X.
5. **Interface rules** (from AGENTS.md, restated): never write to if01 (plain mouse); if02 is consumer 64-byte feature, not used by this exe at all.
6. **Pairing**: no pairing strings or code found. Receiver pairing may be a command inside the unknown set above (unknown); do not probe.

## Facts
- F1. `WLmouse.exe` is PE32 i386 MFC+DuiLib, entry point `0x60f7b4`, PDB `\Code\Output\NeoUsb.pdb` at `0x6ca3d9`.
- F2. HID imports: no `HidD_SetFeature`/`GetFeature`; reports go through `WriteFile` `0x4d2bf2` and `ReadFile` `0x4d2b32` on an overlapped handle opened at `0x4d2a10`.
- F3. Enumeration: `0x4d1d20` (HidGuid `0x4d1d4a`, SetupDi `0x4d1d66`..`0x4d1de9`).
- F4. Device table `0x402970`: records 6 and 7 at `0x6fee20` and `0x6feebc` are VID `0x36a7` PID `0xa887` with usage pages `0xff1c`/usage `0x92` and `0x0c`/`1`, matching `device/rdesc.txt` interfaces 00 and 02.
- F5. Transaction `0x4840e0`: 64-byte buffer, report ID 4 at buf[0] set in each wrapper, command at buf[3], CRC at buf[1..2].
- F6. Checksum `0x483e80` = CRC-16/MODBUS (`0xFFFF`, poly table `{0,0xA001}` at `0x6f0b64`) over 29 bytes starting at buf[3]; reproduces `04 c0 96 36 ...` (`0x96c0`) offline.
- F7. Command byte list (20 wrappers) in section 4.
- F8. `osConfLib.dll`, `DuiLib.dll`, `HookDLL.dll` do not import `HID.DLL`.
- F9. No ripple/angle-snap/pair/DFU/bootloader strings in the exe. Battery is shown by `CMpDevicePowerUI` via cmd `0x1a` (`docs/settings/battery.md`).
- F10. Settings keys listed in section 3 with addresses.

## Inferences
- I1. `NeoUsb`/`Eevision` is a shared OEM driver; the Beast X is added by two table records, so most of the code (keyboard LED `0x4987c0`, 32-byte-era leftovers) is not relevant.
- I2. `buf[4]` is a payload length/count (`0x0d` Display, `0x18` LOD/polling); the CRC window is fixed at 29 bytes regardless.
- I3. Cmd `0x06` is a "write settings block" command used for both LOD and polling (rrroyal captures share `06 18`); cmd `0x36` is the OLED/display block.
- I4. `SilentAltitudeItem`=LOD and `SensorLif`=slam click prevention (corrected, `docs/settings/config-block.md`), `AntiShake`=debounce, `DormancyTime`=sleep.
- I5. Record 6 `+0x14 = 4` could be the report ID (matches rdesc ID 4).
- I6. The 0x15 command's long timeout hints at a flash/commit-style operation.
- I7. Receive path: replies come back through `0x4d2ae0` into the 64-byte `rxbuf` of `0x4840e0`; async listeners (`0x49bcd0`, `0x4aef50`, `0x4bdf90`, `0x4ce380`) use the HidP parser `0x4d2c60` for other device classes.

## Unknowns
- U1. Meaning of record fields `+0x04..+0x0c`, `+0x12`, `+0x14`, and records 0-3 (`0x6fea78`..`0x6febc8`) / VID source for 8-9.
- U2. Reply layout, status/ACK bytes, and read-back (get) commands: which wrapper reads which block (the transactions all receive 64 bytes, but the parse sites were not traced).
- U3. Which wrapper (if any) handles LOD vs polling vs debounce vs sleep vs motion sync; per-setting byte offsets inside the payload.
- U4. Exact opcodes of firmware/DFU/pair/reset; whether `0x15`, `0xaa`, `0xc0` are any of them.
- U5. Battery read (wlmouse-cli uses it; the exe has no string): maybe a response field of a status command.
- U6. Whether the Beast X ever uses the wired-vs-wireless branch at `0x4846e9` (1 s timeout) vs `0x4846a1` (0.5 s) selected by `this+0x64c` check at `0x4845fe`.
- U7. Whether the `0x483e80` window really is 29 bytes for every command (verified on one capture only).

## Phase 2 starting points
1. `0x4840e0` transaction (send, CRC patch, receive): the whole wire protocol funnels here.
2. `0x483e80` CRC-16/MODBUS: confirm against all captured packets.
3. `0x488140` (cmd `0x06`) and `0x4883c0` (cmd `0x36`): the two wrappers with captured counterparts; read their payload layout.
4. `0x402970` device table + matcher `0x469e70`: record fields `+0x04..+0x14` (report sizes/roles).
5. `0x4d1f20`/`0x4d2ae0`/`0x4d2ba0`: report lengths from caps (`this+0x230/0x232`) to confirm the 64-byte frame.
