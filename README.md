# affinity-mcp-windows

An MCP (Model Context Protocol) bridge that lets AI agents drive **Affinity** (the Canva-era app, 3.x) on **Windows** — and on macOS too — through Affinity's own built-in local MCP server and JavaScript SDK.

```
MCP client (opencode / Claude Code / Cursor / ...)
        |  stdio (this bridge)
        v
affinity-mcp-windows
        |  HTTP + SSE  ->  http://[::1]:6767
        v
Affinity 3.x built-in MCP server  ->  execute_script  ->  Affinity JS SDK  ->  your document
```

## Why this exists

The original [tacyan/AffinityMCP](https://github.com/tacyan/AffinityMCP) automates Affinity on macOS through AppleScript because Affinity historically had no automation API. Modern Affinity (April '26 and later) ships an official scripting SDK (~379 classes covering vector, photo, text, layout, AI, and dialogs) exposed through a local MCP server inside the app. That server is **cross-platform**, including Windows.

This repo keeps the familiar `affinity.*` tool surface while speaking to the official automation surface instead of UI automation. No AppleScript, no AutoHotkey, no pixel guessing.

## Requirements

- Windows 10/11 (or macOS)
- **Affinity 3.2 or later** (the Canva-era app)
- **Node.js 20+**
- In Affinity: `Edit > Settings > Model Context Protocol > Enable Affinity MCP`

Affinity must be running with the MCP server enabled whenever the bridge is used. Optional capabilities (file writes, network, Canva AI) are separate toggles in the same settings page and fail with `NOT_ALLOWED` when off.

## Install

```powershell
git clone https://github.com/JomeAla/affinity-mcp-windows.git
cd affinity-mcp-windows
npm install
npm run build
```

Verify the connection while Affinity is running:

```powershell
pwsh -File scripts/win/verify.ps1
```

## Configure your MCP client

### opencode (global config)

```json
{
  "mcp": {
    "affinity-mcp": {
      "type": "local",
      "command": ["node", "C:\\path\\to\\affinity-mcp-windows\\dist\\index.js"],
      "enabled": true
    }
  }
}
```

Or run `pwsh -File scripts/win/setup-opencode.ps1`, which merges this entry into `~/.config/opencode/opencode.json(c)` for you.

### Claude Desktop / Cursor (mcpServers style)

```json
{
  "mcpServers": {
    "affinity-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\affinity-mcp-windows\\dist\\index.js"]
    }
  }
}
```

Restart your client after changing MCP configuration — MCP configs are read at startup.

## Tools

| Tool | What it does |
| --- | --- |
| `affinity.status` | Connection health, Affinity's exposed SDK tools, Desktop path |
| `affinity.open_file` | Open a file in Affinity |
| `affinity.create_new` | Create a document (pixel sizes) |
| `affinity.export` | Export the current document (pdf/png/jpg/tiff/svg/eps) using Affinity's real preset names |
| `affinity.export_outlined` | Print-safe vector export: outlines text, exports SVG/PDF/EPS, then restores the live text |
| `affinity.apply_filter` | Add a live blur-family filter (blur, median, motion, radial, bilateral, lens, …) |
| `affinity.get_active_document` | Current document metadata |
| `affinity.close_document` | Close the current document |
| `affinity.batch_open_files` | Open many files in one call |
| `affinity.batch_export` | Export to many files in one call |
| `affinity.draw_shape` | Draw circle / ellipse / rectangle / line |
| `affinity.add_text` | Add artistic text |
| `affinity.change_color` | Change the fill colour of the selection |
| `affinity.draw_pikachu` | Generate a small vector mascot SVG and open it |
| `affinity.execute_script` | Run arbitrary JS against the official SDK |
| `affinity.render_spread` | Render the current spread (visual verification) |
| `affinity.render_selection` | Render the current selection |
| `affinity.list_sdk_docs` | List SDK documentation topics from the running app |
| `affinity.read_sdk_doc` | Read one SDK documentation topic |

The tool names mirror [tacyan/AffinityMCP](https://github.com/tacyan/AffinityMCP) so existing prompts keep working. `canva.create_design` is intentionally not carried over: it was a stub returning a fake UUID in the original repo, and Canva integration ships inside the app itself.

## CLI driver for shell-based agents

`scripts/affinity-driver.mjs` is a dependency-free Node CLI that drives the bridge without an MCP client — useful for coding agents that only have a shell. It locates the bridge via `AFFINITY_BRIDGE_DIR`, the repo it lives in, or `~/tools/affinity-mcp-windows`.

```powershell
node scripts/affinity-driver.mjs status                # connection + exposed tools
node scripts/affinity-driver.mjs list-docs             # SDK documentation topics
node scripts/affinity-driver.mjs read-doc nodes.js     # read one topic
node scripts/affinity-driver.mjs run my-script.js      # run a file inside Affinity
node scripts/affinity-driver.mjs run-inline "console.log(1)"
node scripts/affinity-driver.mjs call execute_script '{"script":"console.log(1)"}'
node scripts/affinity-driver.mjs render spread out.png # save a spread render
```

Run one invocation at a time; Affinity's MCP server handles a single SSE session best.

`scripts/mcp-handshake-probe.mjs` verifies the stdio server itself (initialize + tools/list) without any MCP client — handy when diagnosing client connection issues or confirming a fresh build:

```powershell
node scripts/mcp-handshake-probe.mjs
```

## How it works

1. Connects to `http://[::1]:6767/sse` (override with `AFFINITY_MCP_URL` or `AFFINITY_MCP_PORT`), falling back to `127.0.0.1`.
2. Speaks MCP protocol `2025-11-25` over HTTP + SSE, discovers the tools Affinity exposes, and reads the SDK `preamble` (Affinity refuses to run scripts until it has been read once per session).
3. Implements the high-level `affinity.*` tools as generated JavaScript that runs inside Affinity via `execute_script`; output is collected from `console.log` as JSON.
4. Passes renders and SDK documentation through untouched.

The argument names of Affinity's tools are resolved from their live schemas at connect time, so the bridge keeps working if the app renames a parameter.

## Gotchas worth knowing

- **The filesystem is sandboxed to the Windows Desktop.** Scripts can only read/write there. Relative export paths are anchored to the Desktop automatically. On OneDrive-redirected Desktops, pass absolute paths under `C:\Users\<you>\OneDrive\Desktop` — the literal `C:\Users\<you>\Desktop` can exist but be denied.
- **Text size is in pixels** in the SDK; the bridge accepts points and converts using the document DPI.
- **High-level generators are best-effort v1.** The reliable core is `affinity.execute_script` plus the SDK documentation tools: ask your agent to read the relevant SDK topic and write the script. The generators are easy to extend in `src/scripts/generators.ts`.
- **Live-verified against Affinity 3.3.0.4850 (Win32)** and covered by unit/integration tests against a fake Affinity server (`npm test`).

## Recipes

`recipes/` holds paste-ready SDK scripts and hard-won patterns from real production work (a complete streetwear graphic suite — samurai, oni mask, dragon — drawn entirely with SDK vector calls, no AI image generation):

- `affinity-drawing-helpers.js` — node builders, ink-splatter generator, halftone arcs, ring-with-hole, mirroring
- `build-hannya-oni.js` — a complete 3600x4800 @300dpi tee-print build with `ink` / `inverse` (black-garment) modes
- `export-outlined-vector.js` — the script form of `affinity.export_outlined`
- `README.md` — long-form gotchas: save-wedge recovery via snapshots, the text measure/build/position cycle, document-resize correction maths, OneDrive Desktop paths, and why you should QA layout by exporting a PNG rather than trusting `render_spread`

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ECONNREFUSED [::1]:6767` | Affinity is not running, or `Enable Affinity MCP` is off |
| `NOT_ALLOWED` in script output | Enable FileSystem / Network / Canva AI in Affinity's MCP settings |
| First script returns "preamble has not been read" | The bridge reads it automatically; reconnect if you see this |
| Tools missing after setup | Restart your MCP client — configuration is read at startup |
| Nothing works after an Affinity restart | Restart your MCP client, or call `affinity.status` to reconnect |
| SVG/PDF export returns `ERROR` | Fixed in 0.2.0 — update, or use preset names like `SVG (for export)` / `PDF (for print)` yourself |
| A save fails with `LOCK_LOST` after heavy scripting | Recover with a snapshot: add one via `createAddDocumentSnapshot`, `snapshot.createDocument()`, then save the copy (see `recipes/README.md`) |

## Development

```powershell
npm install
npm run build   # tsc -> dist/
npm test        # build + unit/integration tests (fake Affinity server)
```

Source layout:

- `src/affinity/sse-client.ts` — Affinity MCP/SSE client, handshake, preamble, schema adaptation
- `src/scripts/generators.ts` — JavaScript generators for the high-level tools
- `src/server.ts` — stdio MCP server and tool registration
- `src/test/` — fake Affinity server and tests
- `scripts/win/` — verification and setup scripts

## Changelog

### 0.2.0

- **Fixed vector and JPEG/TIFF exports.** The generators used preset names that do not exist in Affinity (`PDF`, `SVG`, `JPEG`, `TIFF`), so those exports failed with a bare error record while PNG worked. Now: `PDF (for print)`, `SVG (for export)`, `JPEG (Best quality)`, `TIFF RGB 8-bit`, and `eps` was added as `EPS (for export)`.
- **Added `affinity.export_outlined`** — outlines all artistic text, exports a print-safe SVG/PDF/EPS, then restores the document's live text via undo.
- **Added `recipes/`** — paste-ready SDK scripts and production gotchas (text placement cycle, save-wedge recovery, resize correction maths, OneDrive Desktop paths).

## Credits and prior art

- [tacyan/AffinityMCP](https://github.com/tacyan/AffinityMCP) — the original tool surface this project keeps compatible
- [bolloplayer/affinity-mcp-setup](https://github.com/bolloplayer/affinity-mcp-setup) — the Windows setup guide for Affinity's MCP server
- [johanvillalbab/affinity-cli](https://github.com/johanvillalbab/affinity-cli) — SDK capability map used as a reference

## Disclaimer

Unofficial and not affiliated with, endorsed by, or supported by Canva or Serif. "Affinity" is a trademark of its owner. The bridge only talks to the local MCP server you enable inside your own copy of Affinity; nothing leaves your machine.

MIT licensed.
