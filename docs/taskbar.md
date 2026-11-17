# Taskbar battery

`beastx watch` prints one JSON line when the battery, charging state or DPI changes. It checks every 5 seconds. Wayle and Waybar read these lines directly.

Install the command once so the bar can find it:

```sh
npm install -g beastx
```

## Waybar

```jsonc
"custom/beastx": {
  "exec": "beastx watch",
  "return-type": "json",
  "format": "{}",
  "tooltip": true,
  "restart-interval": 5
}
```

Add `"custom/beastx"` to `modules-right` (or wherever you want it).

## Wayle

```toml
[[modules.custom]]
id = "beastx"
command = "beastx watch"
mode = "watch"
restart-policy = "on-failure"
restart-interval-ms = 5000
format = "{{ text }}"
tooltip-format = "{{ tooltip }}"
hide-if-empty = true
icon-name = "ld-mouse-symbolic"
```

Then add `custom-beastx` to a `[[bar.layout]]` section.

## What the lines look like

- Mouse awake: `{"alt":"discharging","class":"beastx","dpi":1600,"percentage":64,"stage":2,"text":"64% · 1600","tooltip":"Beast X 4K · 64% · discharging · 1600 DPI (stage 2)"}`
- Mouse asleep: `{"alt":"asleep","class":"beastx asleep","text":"zz","tooltip":"Beast X 4K asleep"}`
- Receiver unplugged: `{"alt":"none","text":""}` (the module hides itself)

`beastx status` prints one line and exits, for bars that poll instead.

## Privacy

The receiver sends mouse button presses on the same channel `beastx` reads from. `beastx` only listens for a few milliseconds per check, throws away anything that is not an answer to its own question, and never stores, prints or sends it. It never reads pointer movement, writes no files and uses no network.

It only asks the mouse three things: are you awake, how is your battery, and what are your settings. It never changes a setting.
