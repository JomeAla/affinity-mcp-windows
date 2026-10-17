#!/usr/bin/env node
// call-bridge-tool.mjs — call this bridge's *own* tools (the high-level
// affinity.* surface in src/server.ts) without an MCP client, against the real
// Affinity app. Handy for agents that only have a shell, and for smoke-testing
// the bridge after a build.
//
// Usage:
//   node scripts/call-bridge-tool.mjs '<tool-name>' '<json-args>'
//   node scripts/call-bridge-tool.mjs calls.json [out-dir]
//
// With a calls.json file the calls run sequentially in ONE Affinity session:
//   [
//     { "tool": "affinity.create_new", "args": { "width": 1024, "height": 1024 } },
//     { "tool": "affinity.export_sizes", "args": { "sizes": [512, 64] } }
//   ]
// Image parts in results are written to [out-dir] (default: alongside the file).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

const [first, second] = process.argv.slice(2);
if (!first) {
  console.error("usage: node scripts/call-bridge-tool.mjs '<tool>' '<json>' | calls.json [out-dir]");
  process.exit(1);
}

let calls;
let outDir = process.cwd();
if (first.trim().startsWith("[") || first.endsWith(".json")) {
  const file = first.trim().startsWith("[") ? null : path.resolve(first);
  const raw = file ? fs.readFileSync(file, "utf8") : first;
  calls = JSON.parse(raw);
  outDir = second ? path.resolve(second) : file ? path.dirname(file) : process.cwd();
} else {
  calls = [{ tool: first, args: second ? JSON.parse(second) : {} }];
}
fs.mkdirSync(outDir, { recursive: true });

const server = createServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const mcp = new Client({ name: "call-bridge-tool", version: "1.0.0" });
await mcp.connect(clientTransport);

let failed = 0;
for (const [index, call] of calls.entries()) {
  console.log(`--- [${index + 1}/${calls.length}] ${call.tool} ${JSON.stringify(call.args ?? {})}`);
  try {
    const result = await mcp.callTool({ name: call.tool, arguments: call.args ?? {} });
    for (const part of result.content ?? []) {
      if (part.type === "text") {
        console.log(part.text);
      } else if (part.type === "image" && part.data) {
        const target = path.join(outDir, `${call.tool.replace(/[^\w.-]+/g, "_")}-${index + 1}.png`);
        fs.writeFileSync(target, Buffer.from(part.data, "base64"));
        console.log(`[image written] ${target}`);
      }
    }
    if (result.isError) failed += 1;
  } catch (err) {
    failed += 1;
    console.log(`ERROR: ${err.message}`);
  }
}

await mcp.close();
await server.close();
process.exit(failed > 0 ? 1 : 0);
