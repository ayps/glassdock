# GlassDock

A glass widget dock for Windows 11. Rest your pointer at the top middle of any screen and it
slides down; move away and it slides back up.

![GlassDock open at the top of the desktop](docs/desktop.jpg)

![The dock up close](docs/dock.png)

## Features

- **Out of the way until you want it.** Opens on whichever monitor your pointer is on, after a
  short hover. It ignores the top edge while you're dragging a window, needs a longer hover over
  full-screen games and videos, and never takes keyboard focus from the app you're working in.
- **Apple-inspired design.** Frosted glass tinted from your wallpaper, continuous (squircle)
  corners, two card sizes that always line up, Inter type, and spring motion throughout.
- **Make it yours.** Drag cards to rearrange them, switch widgets on and off, and choose Light,
  Dark or Auto per card. Rings and highlights follow your Windows accent colour.
- **Starts with Windows**, like Discord. Switch it off in the dock's settings.

### Widgets

| Widget | What it shows |
|---|---|
| World clocks | Analog or digital clocks for any cities; search and add from the panel |
| CPU, RAM, GPU | Live load rings (NVIDIA GPUs) |
| System | CPU, RAM, GPU and network speed in one card |
| Media | Whatever is playing in Windows (Spotify, browsers, Media Player), with controls |
| Weather | Current conditions, high and low, feels-like |
| Calendar | Your next events from one or more Google accounts; create meetings (guests, Google Meet) and tasks |
| Tasks | Google Tasks: tick off and add tasks |
| Notes | Quick notes kept on your PC |
| GitHub | Today, this week and streak over a contribution grid; your PRs, review requests and issues |
| Claude | Your Claude plan's session and weekly usage, via Claude Code's status line |
| Recycle Bin | Items in the bin; open or empty it (always asks first) |

## Install

1. Download `GlassDock_x.y.z_x64-setup.exe` from the [Releases](../../releases) page.
2. Run it. GlassDock isn't code-signed yet, so Windows SmartScreen will warn you: choose
   **More info → Run anyway**.
3. Hover at the top middle of your screen.

Requires Windows 10 or 11 with WebView2 (already part of Windows 11).

## Using it

- **Click a card** to open its panel: edit cities, see your week, write notes and more.
- **Drag a card** to move it.
- **Right-click a card** for Light / Dark / Auto, Move left / right and Hide.
- **Right-click the dock's edge** to switch widgets on or off, pick a Dark or Light dock, choose
  wallpaper tint or neutral glass, and turn **Start with Windows** on or off.

### Connecting accounts

Everything is optional. Widgets you don't connect simply show a "Connect" card.

- **Google Calendar and Tasks:** you need your own Google Cloud OAuth client (type
  *Desktop app*) with the Calendar and Tasks APIs enabled. Click the Calendar card, choose the
  client's JSON file, then **Add a Google account** for each account.
- **GitHub:** create a fine-grained personal access token with read-only Contents, Issues,
  Pull requests and Metadata, click the GitHub card and paste it.
- **Claude:** needs [Claude Code](https://code.claude.com) on the same PC. Click the Claude card
  and **Connect Claude Code**. GlassDock adds a small status-line script to Claude Code's settings
  (keeping a backup). The numbers refresh while Claude Code is running, and the card shows their age.

## Privacy

GlassDock has no servers and collects nothing. Data goes only between your PC and the services
you connect (Google, GitHub, Open-Meteo for weather and city search). Sign-in tokens are kept in
Windows Credential Manager; settings and notes stay in your user profile.

## Building from source

You need [Node.js](https://nodejs.org) (LTS) and [Rust](https://rustup.rs) with the Visual Studio
C++ build tools.

```
npm install
npm run tauri dev      # run with live reload
npm run tauri build    # make the installer (src-tauri/target/release/bundle/nsis/)
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the project layout and how to write your own widget.

## Credits

Built with [Tauri](https://tauri.app). Weather and city search by
[Open-Meteo.com](https://open-meteo.com/). Typeface: [Inter](https://rsms.me/inter/) by Rasmus
Andersson. Full list in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Claude, GitHub, Google, Spotify and Windows are trademarks of their respective owners. GlassDock
isn't affiliated with or endorsed by any of them.

## Licence

[MIT](LICENSE)
