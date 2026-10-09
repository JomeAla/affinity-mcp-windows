#!/usr/bin/env node
// affinity-driver.mjs — dependency-free CLI for driving Affinity through this bridge
// without an MCP client. Handy for coding agents that work over a shell.
//
// Prerequisites:
//   - Affinity 3.2+ running with Edit > Settings > Model Context Protocol > "Enable Affinity MCP" ON.
//   - This repo built (`npm run build`), or the bridge installed elsewhere.
//     The driver looks for the bridge in this order:
//       1. AFFINITY_BRIDGE_DIR environment variable
//       2. The repo this script lives in (scripts/..)
//       3. ~/tools/affinity-mcp-windows
//
// Usage:
//   node scripts/affinity-driver.mjs status
//   node scripts/affinity-driver.mjs list-docs
//   node scripts/affinity-driver.mjs read-doc <topic>            e.g. nodes.js, preamble
//   node scripts/affinity-driver.mjs run <script-file>           run a .js file inside Affinity
//   node scripts/affinity-driver.mjs run-inline "<js>"           run an inline script
//   node scripts/affinity-driver.mjs call <tool-suffix> '<json>' call any Affinity SDK tool directly
//   node scripts/affinity-driver.mjs render <spread|selection> [out.png]
//
// Notes:
//   - Affinity's filesystem is sandboxed to the Desktop for script file I/O.
//   - Scripts must console.log() their output; the last JSON object logged is pretty-printed.
//   - Run one driver invocation at a time; Affinity's MCP server handles a single SSE session best.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.AFFINITY_BRIDGE_DIR,
  path.resolve(here, ".."),
  path.join(os.homedir(), "tools", "affinity-mcp-windows"),
].filter(Boolean);

let bridgeDir = null;
let clientUrl = null;
for (const dir of candidates) {
  const entry = path.join(dir, "dist", "affinity", "sse-client.js");
  try {
    await fs.access(entry);
    bridgeDir = dir;
    clientUrl = pathToFileURL(entry).href;
    break;
  } catch {
    // keep looking
  }
}

if (!clientUrl) {
  console.error("Could not locate the affinity-mcp-windows bridge (dist/affinity/sse-client.js).");
  console.error("Checked: " + candidates.join(", "));
  console.error("Run `npm run build` in the bridge repo or set AFFINITY_BRIDGE_DIR.");
  process.exit(1);
}

const { AffinityClient, extractText, extractLastJson } = await import(clientUrl);

const client = new AffinityClient();
const [cmd, ...args] = process.argv.slice(2);

async function printResult(result) {
  const text = extractText(result);
  const parsed = extractLastJson(result);
  console.log(parsed ? JSON.stringify(parsed, null, 2) : text);
}

async function main() {
  switch (cmd) {
    case "status": {
      await client.ensureConnected();
      const desktop = await client.getDesktopPath().catch(() => null);
      console.log(
        JSON.stringify(
          {
            connected: true,
            bridge_dir: bridgeDir,
            base_url: client.baseUrl,
            affinity_tools: client.listCachedTools().map((t) => t.name),
            desktop_path: desktop,
          },
          null,
          2,
        ),
      );
      break;
    }
    case "list-docs": {
      await client.ensureConnected();
      const tool = client.findTool("list_sdk_documentation");
      if (!tool) throw new Error("Affinity does not expose list_sdk_documentation");
      console.log(extractText(await client.callAffinityTool(tool.name, {})));
      break;
    }
    case "read-doc": {
      const topic = args[0];
      if (!topic) throw new Error("usage: read-doc <topic>");
      await client.ensureConnected();
      console.log(extractText(await client.readSdkDoc(topic)));
      break;
    }
    case "run": {
      const file = args[0];
      if (!file) throw new Error("usage: run <script-file>");
      const script = await fs.readFile(file, "utf8");
      await client.ensureConnected();
      await printResult(await client.executeScript(script, 300000));
      break;
    }
    case "run-inline": {
      const script = args[0];
      if (!script) throw new Error("usage: run-inline \"<js>\"");
      await client.ensureConnected();
      await printResult(await client.executeScript(script, 300000));
      break;
    }
    case "call": {
      const suffix = args[0];
      if (!suffix) throw new Error("usage: call <tool-suffix> '<json-args>'");
      const json = args[1] ?? "{}";
      await client.ensureConnected();
      const tool = client.findTool(suffix);
      if (!tool) throw new Error(`Affinity does not expose a tool ending in '${suffix}'`);
      await printResult(await client.callAffinityTool(tool.name, JSON.parse(json), 300000));
      break;
    }
    case "render": {
      const what = args[0] ?? "spread";
      const out = args[1];
      await client.ensureConnected();
      const suffix = what === "selection" ? "render_selection" : "render_spread";
      const tool = client.findTool(suffix);
      if (!tool) throw new Error(`Affinity does not expose ${suffix}`);
      const merged = {};
      const props = tool.inputSchema?.properties ?? {};
      if (props.document_session_uuid) {
        const uuid = await client.getCurrentSessionUuid();
        if (!uuid) throw new Error("no open document to render");
        merged.document_session_uuid = uuid;
      }
      if (props.spread_index && merged.spread_index === undefined) merged.spread_index = 0;
      const result = await client.callAffinityTool(tool.name, merged, 300000);
      const content = result?.content ?? [];
      let saved = 0;
      for (const part of content) {
        if (part?.type === "image" && part.data) {
          const target = out ?? `render-${Date.now()}.png`;
          await fs.writeFile(target, Buffer.from(part.data, "base64"));
          console.log(`saved image -> ${target} (${part.mimeType ?? "image/png"})`);
          saved++;
        } else if (part?.type === "text") {
          console.log(part.text);
        }
      }
      if (!saved) console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.log(
        "commands: status | list-docs | read-doc <topic> | run <file> | run-inline <js> | call <tool-suffix> '<json>' | render <spread|selection> [out]",
      );
  }
}

main()
  .then(() => {
    client.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
