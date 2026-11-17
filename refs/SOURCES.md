# refs/ sources

Everything else in `refs/` is gitignored. Refetch with the commands below.

| Path | Source | Pin |
|---|---|---|
| `driver/WLmouseGM_V0109.exe` | WLMouse download page, "Beast X 4K" → Desktop Driver (Google Drive folder `1lTApR0D5nShikkwMgPhXgRK_Yl5_73uS`, file `1iuIrqoY-8MfGxmbm7jIniX4ZLNMX6dlL`) | sha256 `bf9f383bd10ca183ccf932eb42f55b47403164b21cf17df3efd9508db38d3960` |
| `driver/exe/` | `7z x -oexe WLmouseGM_V0109.exe` (NSIS) | |
| `driver/app/` | `7z x -oapp exe/app.7z`; main binary `WLmouse.exe` (native C++, DuiLib.dll, HookDLL.dll, SDK/osConfLib.dll, opencv) | |
| `gm-web/` | `https://gm.wlmouse.gg/` index.html + `static/js/*.js` (web hub v1.0.47 for sibling PIDs a856–a886; uses `sendFeatureReport`/`receiveFeatureReport`) | fetched 2026-11-16 |
| `wlmouse-beastx/` | `git clone https://github.com/rrroyal/wlmouse-beastx` (sniffed 64-byte packets for 36A7:A887: display mode, LOD, polling; checksum unknown) | `33dc5c5` |
| `wlmouse-cli/` | `git clone https://github.com/mee7ya/wlmouse-cli` (Rust hidapi; Beast X battery only) | `36541f6` |
