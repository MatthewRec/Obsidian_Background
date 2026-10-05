# Obsidian Graph Wallpaper

Turn your [Obsidian](https://obsidian.md/) vault's graph view into a live, interactive desktop wallpaper.

This project reads the notes and links in a local Obsidian vault, reproduces the same node colors, sizing, and force-layout settings Obsidian itself uses (pulled straight from `.obsidian/graph.json`), and renders the result as a force-directed graph in the browser using [`force-graph`](https://github.com/vasturiano/force-graph). A background watcher keeps the graph data in sync with the vault, and the page itself polls for updates, so the wallpaper stays current as notes are added, edited, or linked — without ever reloading.

It is built to run inside [Lively Wallpaper](https://github.com/Lively-wallpaper/lively), a free, open-source app for Windows that can render local HTML/JS pages as an animated desktop wallpaper.

## How it works

```
Obsidian vault  --(generate.js / watch.js)-->  graph-data.js  --(index.html)-->  live wallpaper
   *.md files                                   (nodes/links,                    (force-graph
   .obsidian/graph.json                          colors, forces)                  canvas render)
```

1. **`generate.js`** walks your vault, parses `[[wikilinks]]` out of every note, and resolves each link to a real note, an attachment (ignored), or an unresolved "ghost" link. It also reads your vault's own `.obsidian/graph.json` so the wallpaper's colors and physics match your real Obsidian graph view.
2. It writes all of that out to **`graph-data.js`**, a small generated file that just assigns the graph data to `window.GRAPH`.
3. **`watch.js`** watches the vault for file changes and re-runs the generator automatically, a couple of seconds after things go quiet.
4. **`index.html`** is the actual wallpaper: it loads `graph-data.js`, draws the graph, and re-polls that file every 10 seconds so new notes and links fade into the wallpaper live.

## Repository contents

| File | Purpose |
|---|---|
| `generate.js` | Scans the vault and (re)writes `graph-data.js`. Can be run once, on demand. |
| `watch.js` | Long-running watcher: calls the generator automatically whenever the vault changes. |
| `run-watch.vbs` | Launches `run-watch-loop.bat` silently in the background (no visible console window). Used for autostart. |
| `run-watch-loop.bat` | Restart loop around `node watch.js`: if the watcher ever crashes, it's relaunched automatically a few seconds later instead of staying dead until the next login. |
| `index.html` | The wallpaper itself — loads `graph-data.js` and renders the interactive graph. This is the file you point your wallpaper engine at. |
| `package.json` / `package-lock.json` | Node dependency manifest and lockfile. |
| `watch.log` | Log file written by `watch.js` itself (timestamps of each regeneration). Safe to delete; it will be recreated. |
| `watch-shell.log` | Raw stdout/stderr of the `node watch.js` process, captured by `run-watch-loop.bat`. Separate from `watch.log` so the two writers never contend for the same file. Safe to delete. |
| `graph-data.js` | **Generated file** — the current snapshot of your graph. Not committed to git (see `.gitignore`). |
| `.gitignore` | Excludes `node_modules/`, the generated `graph-data.js` (+ its temp file), and `watch.log` from version control. |

### `generate.js`

The core data-generation script. On each run it:

- Recursively walks the vault at `VAULT_ROOT`, collecting every `.md` file and every non-markdown attachment, skipping dotfolders such as `.obsidian`, `.git`, and `.trash`.
- Extracts `[[Wikilink]]`-style links from each note (ignoring anything inside fenced code blocks or inline code spans, so example syntax in documentation notes isn't treated as a real link).
- Resolves each link target to a note, an attachment, or a "ghost" (a link to a note that doesn't exist yet) — using the same shortest-path matching behavior Obsidian uses when note names collide.
- Reads `.obsidian/graph.json` from the vault to pick up your configured **color groups** (`path:"..."` filters) and **force/display settings** (node size, line size, link distance/strength, etc.), so the wallpaper mirrors your real graph view's look.
- Writes the combined result (nodes, links, colors, and forces) to `graph-data.js` as `window.GRAPH = { ... }`, using an atomic write (write to `.tmp`, then rename) so the wallpaper never reads a half-written file.
- When run directly (`node generate.js`), it also prints a one-line summary of how many nodes/edges were generated.

**Note:** the vault path is hardcoded near the top of the file:

```js
const VAULT_ROOT = 'C:\\Users\\<user>>\\Obsidian';
```

Edit this to point at your own vault before running it (see [Configuration](#configuration) below).

### `watch.js`

Keeps `graph-data.js` continuously up to date so you never have to run `generate.js` by hand again.

- Runs `generate.js` once immediately on startup, then uses [`chokidar`](https://github.com/paulmillr/chokidar) to watch the entire vault for added, changed, or removed files/folders (again skipping `.obsidian`, `.git`, `.trash`, and `node_modules`).
- Debounces changes by 2.5 seconds, so saving several notes in quick succession only triggers one regeneration.
- Logs every regeneration (and any errors) with a timestamp to `watch.log`.
- Runs indefinitely — this is the process that should be left running in the background for the wallpaper to stay live.

### `run-watch.vbs` / `run-watch-loop.bat`

A small Windows VBScript launcher that runs `run-watch-loop.bat` completely hidden (no console window flashes on screen):

```vbscript
shell.Run "cmd /c ""...\obsidian-graph-wallpaper\run-watch-loop.bat""", 0, False
```

The batch file loops `node watch.js` forever, redirecting its output to `watch-shell.log`:

```bat
:loop
"C:\Program Files\nodejs\node.exe" watch.js >> watch-shell.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
```

If `watch.js` ever exits — a crash, an uncaught exception, anything — it's relaunched automatically after 5 seconds, so the wallpaper recovers on its own instead of staying stale until you next log in. This is the script to point at Windows autostart (Task Scheduler or the Startup folder) so the watcher comes back up automatically after every reboot or login, with no window popping up. Double-clicking `run-watch.vbs` manually starts the watcher the same way.

### `index.html`

The wallpaper page itself. It has no build step — it loads `d3-quadtree`, `d3-force`, and `force-graph` directly from `node_modules` via `<script>` tags, then:

- Reads `window.GRAPH` (from `graph-data.js`) for the initial node/link list, colors, and force settings.
- Renders the graph on a `<canvas>` via `force-graph`, styling nodes and links to match Obsidian's own graph view, with node size driven by link count (degree).
- Adds a manual, click-driven zoom control (`+` / `−` / fit-to-screen) in the bottom-right corner, because Lively's WebView2 renderer does not forward mouse-wheel or drag events to the wallpaper surface — only clicks.
- Makes nodes clickable: clicking a resolved note opens it directly in Obsidian via an `obsidian://open?...` deep link.
- Polls `graph-data.js` every 10 seconds (cache-busted with a timestamp query string) and merges any changes into the running simulation in place — existing nodes keep their on-screen position, and the physics simulation is only "reheated" when nodes or links actually changed, so the graph sits still at rest instead of drifting forever.

## Prerequisites

- **Windows**, with an existing [Obsidian](https://obsidian.md/) vault on the same machine.
- **[Node.js](https://nodejs.org/)** (LTS release recommended), which provides both `node` and `npm`.
- **[Lively Wallpaper](https://github.com/Lively-wallpaper/lively)** (or another wallpaper engine capable of rendering a local HTML/JS page as a live wallpaper). Lively is free, open-source, and available on the [Microsoft Store](https://apps.microsoft.com/detail/9ntm2qc6qws7) as well as GitHub.

## Installation & setup

### 1. Get the project onto your machine

```bash
git clone <this-repo-url>
cd obsidian-graph-wallpaper
```

(Or simply copy the folder if you're not using git.)

### 2. Install dependencies

```bash
npm install
```

This installs `chokidar` (used by `watch.js`) and the browser-side rendering libraries `d3-force`, `d3-quadtree`, and `force-graph` (used directly by `index.html`) into `node_modules/`.

### 3. Point the generator at your vault

Open `generate.js` and update `VAULT_ROOT` to your own vault's folder:

```js
const VAULT_ROOT = 'C:\\Users\\<you>\\Path\\To\\YourVault';
```

The path must be a Windows-style path with escaped backslashes (`\\`), and it must point at the root of the vault — the folder that directly contains your `.obsidian` folder.

### 4. Generate an initial snapshot

Run the generator once to produce the first `graph-data.js`:

```bash
node generate.js
```

You should see output similar to:

```
nodes: 50 (ghost: 0), edges: 58
```

### 5. Start the live watcher

For active use while you're working in Obsidian, run the watcher in a terminal:

```bash
node watch.js
```

Leave this running — it regenerates `graph-data.js` automatically a couple of seconds after any change in the vault. Progress and errors are appended to `watch.log`.

To run it silently in the background instead (no terminal window), double-click **`run-watch.vbs`**. Before doing so, confirm the Node.js path inside it matches your install:

```vbscript
"C:\Program Files\nodejs\node.exe" watch.js >> watch.log 2>&1
```

If `node.exe` lives somewhere else on your machine, update that path in `run-watch.vbs` accordingly. Also confirm the `cd /d` path in the same line points at wherever you placed this project folder.

### 6. (Optional) Auto-start the watcher on login

So the wallpaper stays live without manually starting anything after a reboot, register `run-watch.vbs` to run at login using either:

- **Startup folder** — press `Win + R`, enter `shell:startup`, and drop a shortcut to `run-watch.vbs` into the folder that opens.
- **Task Scheduler** — create a task triggered "At log on", with the action set to run `wscript.exe` with the argument `"<full path to run-watch.vbs>"`.

### 7. Add the wallpaper in Lively Wallpaper

1. Install and open [Lively Wallpaper](https://github.com/Lively-wallpaper/lively).
2. Choose **Add wallpaper** (or the **+** button) and select **Add from local file/folder**.
3. Point it at `index.html` inside this project folder.
4. Apply it as your active wallpaper.

Because `index.html` loads its dependencies from the local `node_modules/` folder (not a CDN), make sure the whole project folder — including `node_modules/` — stays in place after you add it to Lively; don't move or rename it afterward without re-adding the wallpaper.

## Usage

- **Zoom in / out / fit to screen** — use the three buttons in the bottom-right corner of the wallpaper. These are click-driven rather than scroll/drag-driven, since Lively's renderer only forwards clicks to wallpaper surfaces.
- **Open a note** — click any resolved (solid) node to open that note directly in Obsidian.
- **Live updates** — just keep `watch.js` (or `run-watch.vbs`) running in the background; new notes and links will fade into the wallpaper within roughly 10–15 seconds of being saved, with no need to reload or reapply the wallpaper.

## Configuration

Most of the graph's appearance (colors, node size, line thickness, link distance/strength) is pulled automatically from your vault's own `.obsidian/graph.json`, so tweaking those settings in Obsidian's native Graph view settings panel will carry over the next time `graph-data.js` regenerates.

A few things are only configurable by editing the scripts directly:

| Setting | Location | Notes |
|---|---|---|
| Vault path | `generate.js` → `VAULT_ROOT` | Must match your vault's root folder. |
| Background / default colors | `generate.js` → `DEFAULT_NODE_COLOR`, `UNRESOLVED_NODE_COLOR`, `DEFAULT_LINK_COLOR`, `BACKGROUND_COLOR` | Fallback colors used when a note doesn't match any color group. |
| Regeneration debounce | `watch.js` → `DEBOUNCE_MS` | Milliseconds to wait after the last file change before regenerating (default `2500`). |
| Wallpaper poll interval | `index.html` → `POLL_MS` | How often the wallpaper checks `graph-data.js` for updates (default `10000` ms). |
| Repel / hub-attraction strength | `index.html` → `REPEL_STRENGTH`, `hubAttractForce(...)` call | Obsidian's own repel setting is often `0` since a human pans the real graph view by hand; the wallpaper adds its own repulsion so nodes spread out on an unattended screen. Hub note names (`Ideas.md`, `Projects.md`, `Research.md` by default) are hardcoded — update them to match your own vault's hub notes, or remove the call if you don't need it. |

## Troubleshooting

- **Wallpaper shows a blank/empty graph.** Run `node generate.js` manually from the project folder and check the console output for errors — most commonly an incorrect `VAULT_ROOT` path.
- **Wallpaper never updates after editing notes.** Confirm a `node.exe` process for `watch.js` is actually still running (Task Manager), and check `watch.log` for a `watcher ready` line and recent `regenerated:` entries. If the log ends abruptly with an uncaught error and no process is running, `run-watch-loop.bat`'s restart loop should bring it back within a few seconds on its own; if nothing comes back, double-check the `node.exe` path inside `run-watch-loop.bat`.
- **Clicking a node doesn't open Obsidian.** The click handler opens `obsidian://open?vault=Obsidian&file=...` — if your vault is named something other than `Obsidian`, update the `vault=` parameter inside the script block in `index.html` to match your vault's name.
- **Scrolling/dragging doesn't zoom.** This is expected inside Lively — its WebView2 wallpaper renderer doesn't forward wheel/drag events, which is why the on-screen `+`/`−`/fit buttons exist instead.

## License

Copyright (c) 2026 Matthew Recher

This project is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).

In short:

- **You may** use, copy, modify, and share this project for any noncommercial purpose - personal use, study, research, hobby projects, and use by charities, schools, and other noncommercial organizations.
- **You may not** sell this project, or any modified version of it, or use it for commercial advantage.
- **You must** include this license (or a link to it) and the copyright notice above with any copy or modified version you share.

This summary is for convenience only. The full license text in [`LICENSE.md`](LICENSE.md) is what legally applies. For commercial licensing, contact the author.

