#!/usr/bin/env node
// contrast-check.mjs — WCAG 2.1 contrast ratios for palettes and colour pairs.
// Dependency-free. Useful for brand palettes (which pairs can carry text, which
// are decorative-only) and for QA-ing the palette deliverable of an identity.
//
// Usage:
//   node scripts/contrast-check.mjs --palette palette.json
//   node scripts/contrast-check.mjs "#4A1220" "#F2E8D8" "#C2502B"
//   node scripts/contrast-check.mjs --pair "#F2E8D8" "#4A1220" [--pair ...]
//
// palette.json: { "name": "#hex", ... } (an object of names -> hex strings).
// Flags:
//   --matrix        all-pairs matrix from a palette or the hex list (default for >1 colours)
//   --min <ratio>   exit non-zero if any evaluated pair is below this ratio
//   --json          print machine-readable JSON instead of a table
//
// Thresholds reported per pair: normal text AA >= 4.5, AAA >= 7,
// large text / UI graphics >= 3.

import fs from "node:fs";

function parseHex(input) {
  const h = String(input).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(h)) throw new Error(`bad hex colour: ${input}`);
  const expand = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [parseInt(expand.slice(0, 2), 16), parseInt(expand.slice(2, 4), 16), parseInt(expand.slice(4, 6), 16)];
}

function luminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(hexA, hexB) {
  const la = luminance(parseHex(hexA));
  const lb = luminance(parseHex(hexB));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function fmt(x) {
  return x.toFixed(2).padStart(6);
}

function flags(ratio) {
  const f = [];
  if (ratio >= 7) f.push("AAA");
  if (ratio >= 4.5) f.push("AA");
  if (ratio >= 3) f.push("UI");
  return f.length ? f.join(" ") : "--";
}

function main() {
  const args = process.argv.slice(2);
  const pairs = [];
  let palette = null;
  let min = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--pair") pairs.push(args[++i].split(",").map((s) => s.trim()));
    else if (a === "--palette") palette = JSON.parse(fs.readFileSync(args[++i], "utf8").replace(/^\uFEFF/, ""));
    else if (a === "--min") min = parseFloat(args[++i]);
    else if (a === "--json") json = true;
    else if (a === "--matrix") continue;
    else if (a.startsWith("#")) pairs.push([a, null]);
    else throw new Error(`unknown argument: ${a}`);
  }

  const named = {};
  if (palette) for (const [k, v] of Object.entries(palette)) named[k] = typeof v === "string" ? v : v.hex;

  const rows = [];
  if (palette) {
    const keys = Object.keys(named);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        rows.push({ a: keys[i], b: keys[j], hexA: named[keys[i]], hexB: named[keys[j]] });
      }
    }
  } else {
    const flat = pairs.filter((p) => p[1] === null).map((p) => p[0]);
    if (pairs.some((p) => p[1] !== null)) {
      for (const [a, b] of pairs) if (b) rows.push({ a, b, hexA: a, hexB: b });
    } else {
      for (let i = 0; i < flat.length; i++) {
        for (let j = i + 1; j < flat.length; j++) rows.push({ a: flat[i], b: flat[j], hexA: flat[i], hexB: flat[j] });
      }
    }
  }
  if (!rows.length) {
    console.error("usage: node scripts/contrast-check.mjs --palette palette.json | #hex #hex ... | --pair '#a','#b' ...");
    process.exit(1);
  }

  const results = rows.map((r) => {
    const ratio = contrast(r.hexA, r.hexB);
    return { ...r, ratio: Math.round(ratio * 100) / 100, flags: flags(ratio) };
  });

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.a === r.hexA ? r.hexA : r.a} vs ${r.b === r.hexB ? r.hexB : r.b}  ratio=${fmt(r.ratio)}  ${r.flags}`);
    }
  }

  if (min != null) {
    const bad = results.filter((r) => r.ratio < min);
    if (bad.length) {
      console.error(`FAIL: ${bad.length} pair(s) below ${min}`);
      process.exit(1);
    }
  }
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main();
}
