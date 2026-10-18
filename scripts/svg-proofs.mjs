#!/usr/bin/env node
// svg-proofs.mjs — render a manifest of SVG files as PNG proofs through the
// affinity-mcp-windows bridge: open each SVG as vectors in Affinity, export a
// PNG proof at document pixel size, optionally export small-size ladders for
// icon-like files, close the document, then copy everything back from the
// Desktop staging folder into the project.
//
// Why: Affinity's filesystem sandbox writes to the Desktop only, so proofs are
// staged there and copied back by this tool. Ground truth for layout QA is the
// exported PNG (see recipes/README.md).
//
// Usage:
//   node scripts/svg-proofs.mjs --manifest <file> --root <dir> --out <dir> --staging <name>
//       [--sizes 512,128,32,16] [--sizes-for icon] [--bridge <dir>]
//
// Manifest: JSON array of paths relative to --root, or
//   { "files": [...], "sizesFor": "icon", "sizes": [512, 128, 32, 16] }
//
// The bridge is located via --bridge, $AFFINITY_BRIDGE_DIR, or
// ~/tools/affinity-mcp-windows.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const manifestPath = arg("manifest");
if (!manifestPath) {
  console.error("usage: node scripts/svg-proofs.mjs --manifest <file> --root <dir> --out <dir> --staging <name> [--sizes ...] [--sizes-for prefix]");
  process.exit(1);
}
const root = path.resolve(arg("root", "."));
const outDir = path.resolve(arg("out", path.join(root, "_qa", "proofs")));
const staging = arg("staging", "_svg-proofs");
const bridgeDir = path.resolve(arg("bridge", process.env.AFFINITY_BRIDGE_DIR || path.join(os.homedir(), "tools", "affinity-mcp-windows")));
const desktop = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : process.env.HOME;

const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
const files = Array.isArray(manifestRaw) ? manifestRaw : manifestRaw.files ?? [];
const sizesFor = Array.isArray(manifestRaw) ? arg("sizes-for", "icon") : manifestRaw.sizesFor ?? arg("sizes-for", "icon");
const sizes = (Array.isArray(manifestRaw) && manifestRaw.sizes
  ? manifestRaw.sizes
  : (arg("sizes", "512,128,32,16").split(",").map((s) => parseInt(s, 10)).filter(Boolean)));

const bridgeRequire = createRequire(path.join(bridgeDir, "package.json"));
const { Client } = await import(pathToFileURL(bridgeRequire.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const { InMemoryTransport } = await import(pathToFileURL(bridgeRequire.resolve("@modelcontextprotocol/sdk/inMemory.js")).href);
const { createServer } = await import(pathToFileURL(path.join(bridgeDir, "dist", "server.js")).href);

const server = createServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const mcp = new Client({ name: "svg-proofs", version: "1.0.0" });
await mcp.connect(clientTransport);

const call = async (tool, args) => {
  const result = await mcp.callTool({ name: tool, arguments: args });
  const text = (result.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (result.isError) throw new Error(`${tool} failed: ${text}`);
  return text;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opening a document can make Affinity drop the response to the tool call that
// caused it (the operation still completes). So: fire the call, tolerate the
// timeout, then poll get_active_document until the expected state is visible.
async function activeDoc() {
  try {
    return JSON.parse(await call("affinity.get_active_document", {}));
  } catch {
    return { is_open: false };
  }
}

async function waitForDoc(expectedName, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const info = await activeDoc();
    if (info.is_open && (!expectedName || info.name === expectedName)) return info;
    await sleep(750);
  }
  throw new Error(`document ${expectedName} did not become active`);
}

async function waitForClosed(tries = 20) {
  for (let i = 0; i < tries; i++) {
    const info = await activeDoc();
    if (!info.is_open) return;
    await sleep(500);
  }
}

async function openDoc(svg, stagedPath, expectedName) {
  try {
    await call("affinity.open_svg", { svg, path: stagedPath });
  } catch (err) {
    if (!/timed out/i.test(String(err.message))) throw err;
  }
  return waitForDoc(expectedName);
}

fs.rmSync(path.join(desktop, staging), { recursive: true, force: true });
fs.mkdirSync(path.join(desktop, staging), { recursive: true });

try {
  await call("affinity.close_document", {});
  await waitForClosed(2);
} catch {
  /* nothing open */
}

let done = 0;
for (const rel of files) {
  const file = path.resolve(root, rel);
  const slug = rel.replace(/\\/g, "/").replace(/\.svg$/i, "");
  const svg = fs.readFileSync(file, "utf8");
  const base = path.basename(file, ".svg");
  const stagedName = path.basename(file);
  try {
    await openDoc(svg, `${staging}/${stagedName}`, stagedName);
    await call("affinity.export", { path: `${staging}/${slug}.png`, format: "png" });
    if (sizesFor && base.startsWith(sizesFor)) {
      await call("affinity.export_sizes", { sizes, path_pattern: `${staging}/${slug}-{size}.png` });
    }
    await call("affinity.close_document", {});
    await waitForClosed(2);
    done += 1;
    console.log(`ok ${slug}`);
  } catch (err) {
    console.error(`FAILED ${slug}: ${err.message}`);
    try {
      await call("affinity.close_document", {});
      await waitForClosed(2);
    } catch {
      /* already closed */
    }
  }
}

await mcp.close();
await server.close();

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const staged = path.join(desktop, staging);
if (fs.existsSync(staged)) fs.cpSync(staged, outDir, { recursive: true });
console.log(`proofs: ${done}/${files.length} -> ${outDir}`);
process.exit(done === files.length ? 0 : 1);
