#!/usr/bin/env node
// mcp-handshake-probe.mjs — verify the bridge's stdio MCP server responds to
// initialize + tools/list, without needing an MCP client (opencode, Claude
// Desktop, Cursor, ...). Useful for diagnosing connection issues and for
// confirming the build after `npm run build`.
//
// Usage:
//   node scripts/mcp-handshake-probe.mjs
//
// The bridge directory is resolved like affinity-driver.mjs:
//   1. AFFINITY_BRIDGE_DIR environment variable
//   2. The repo this script lives in (scripts/..)
//   3. ~/tools/affinity-mcp-windows
//
// Exit code 0 = server responded with tools; 1 = failure (details on stderr).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.AFFINITY_BRIDGE_DIR,
  path.resolve(here, ".."),
  path.join(os.homedir(), "tools", "affinity-mcp-windows"),
].filter(Boolean);

let entry = null;
for (const dir of candidates) {
  const file = path.join(dir, "dist", "index.js");
  try {
    fs.accessSync(file);
    entry = file;
    break;
  } catch {
    // keep looking
  }
}

if (!entry) {
  console.error("Could not locate the bridge (dist/index.js). Checked: " + candidates.join(", "));
  console.error("Run `npm run build` or set AFFINITY_BRIDGE_DIR.");
  process.exit(1);
}

const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
let err = "";
child.stdout.on("data", (d) => { out += d.toString(); });
child.stderr.on("data", (d) => { err += d.toString(); });
child.on("error", (e) => {
  console.error("Failed to spawn the bridge: " + e.message);
  process.exit(1);
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "mcp-handshake-probe", version: "1.0" } } });
setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }), 300);
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 600);

const deadline = Date.now() + 20000;
const timer = setInterval(() => {
  const lines = out.split(/\r?\n/).filter(Boolean);
  const results = lines.map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const initResp = results.find((r) => r.id === 1);
  const listResp = results.find((r) => r.id === 2);
  if (listResp || Date.now() > deadline) {
    clearInterval(timer);
    child.kill();
    if (!initResp || !listResp) {
      console.error("Handshake failed. Raw output: " + out.slice(0, 500));
      if (err) console.error("Bridge stderr: " + err.slice(0, 500));
      process.exit(1);
    }
    const tools = (listResp.result?.tools ?? []).map((t) => t.name);
    console.log(JSON.stringify({
      ok: true,
      bridge: entry,
      server: initResp.result?.serverInfo ?? null,
      toolCount: tools.length,
      tools,
      affinityMustBeRunning: "Tool calls need Affinity running with 'Enable Affinity MCP' on.",
    }, null, 2));
    process.exit(0);
  }
}, 250);
