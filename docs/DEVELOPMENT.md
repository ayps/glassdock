# Developing GlassDock

## Project layout

```
src/                     the dock you see (TypeScript + CSS, no framework)
  dock.ts                layout, slide animation, drag to reorder, elastic scrolling,
                         right-click menu, Edit widgets panel, expanded panels, glass
  widgets/               one file per widget, plus index.ts (the registry)
  settings.ts            saved choices (order, themes, cities...) in local storage
  native.ts              every call into the Rust side, in one place
  google.ts, connect.ts  Google Calendar / Tasks data and the "Connect Google" view
  ui.ts                  small HTML helpers (rings, bars, icons, escaping)
src-tauri/src/           the native side (Rust)
  hover.rs               top-middle hover detection, show / hide, multi-monitor
  platform.rs            Windows-only calls: no focus stealing, full-screen check
  wall.rs                reads the wallpaper for the glass and its tint
  accent.rs              the Windows accent colour
  stats.rs               CPU, memory, network, NVIDIA GPU (NVML)
  media.rs               Windows media controls (what's playing, play / pause / skip)
  google.rs              Google OAuth (PKCE + loopback), tokens in Credential Manager
  github.rs              GitHub token in Credential Manager, GraphQL proxy
  claude.rs              Claude Code status-line bridge
  recycle.rs             Recycle Bin size, open, empty
```

The page never sees a password or token: the Rust side stores them and adds them to requests
itself, and it only talks to a fixed list of addresses.

## Writing a widget

1. Copy `src/widgets/clocks.ts` (or `hardware.ts` for a small tile) to a new file.
2. Change `id`, `name`, `icon`, `load()` (gets the data) and `view()` (returns the HTML).
3. Register it in `src/widgets/index.ts`.
4. Switch it on: right-click the dock's edge, then **Edit widgets**. New widgets start off.

A minimal widget:

```ts
import { defineWidget } from "./types";
import { ICONS, esc } from "../ui";

export default defineWidget({
  id: "hello",
  name: "Hello",
  size: "standard",          // "small" (79 px), "standard" (168 px) or "wide" (346 px)
  icon: ICONS.notes,
  accent: "teal",            // optional Apple colour for the header
  everyMs: 60_000,           // refresh every minute while the dock is open
  load: () => ({ text: "Hello" }),
  view: (d) => `<span class="b">${esc(d.text)}</span>`,
});
```

Optional members: `headerRight(data)` for the right end of the header, `bare: true` to skip the
header, `onAction(action, data)` for buttons with `data-action`, and `panel(root, ctx)` for an
expanded panel that opens when the card is clicked.

Text styles: `v` (numbers), `b` (body), `c` (caption), `lbl` (small label). Colours:
`var(--accent)` (Windows accent), `--orange`, `--red`, `--yellow`, `--green`, `--teal`, `--blue`,
`--purple`. They adjust automatically on light and dark cards.

## Design rules

- Card sizes: small 79, standard 168, wide 346 (two smalls = one standard; two standards + gap = wide).
- Corners: cards 22, dock 30 (= 22 + 8 px padding), continuous `corner-shape: squircle`.
- Never show a missing reading as 0. Show "—" or a "Connect" state instead, and show the age of
  data that can go stale.

## Known limits

- The glass is a blurred copy of the wallpaper, not of the windows behind the dock.
- Claude usage only refreshes while Claude Code is running.
- The installer isn't code-signed, so SmartScreen warns on first install.
