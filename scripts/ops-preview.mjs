#!/usr/bin/env node
// ops-preview.mjs — rasterize an op list to a PNG entirely in Node: no
// Affinity, no dependencies. The op lists are the JSON arrays produced by
// `recipes/ops-runtime.mjs` (or the builders that use it), so this tool gives
// you a fast visual preview of geometry, gradients, batching and z-order
// before committing to a full build inside Affinity.
//
// Usage:
//   node scripts/ops-preview.mjs <input.js|input.json> <output.png> [--ss 2] [--width N] [--height N]
//
// Input can be:
//   - a .json file containing the ops array, or
//   - a generated Affinity script containing `var ops = [...]` (ops-runtime output).
//
// Rendering:
//   - poly and batch ops render with scanline even-odd filling (a batch node
//     really is one even-odd PolyCurve, so overlapping subpaths cancel there too),
//   - solid fills, linear gradients (along the bbox diagonal) and radial
//     gradients (ellipse in rx/ry) match the runtime's gradient semantics,
//   - supersampled (default 2x) for anti-aliasing, then box-downsampled,
//   - text ops are skipped; the summary line reports how many.
//
// The output is a preview, not a pixel-exact Affinity render: stroke widths,
// FX, text and blend modes beyond Normal are not modelled.

import fs from "node:fs";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

export function loadOps(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (file.toLowerCase().endsWith(".json")) return JSON.parse(raw);
  const match = raw.match(/var ops = (\[[\s\S]*?\]);/);
  if (!match) throw new Error("no `var ops = [...]` array found in " + file);
  return JSON.parse(match[1]);
}

export function contentBounds(ops) {
  let mx = 0;
  let my = 0;
  const scan = (pts) => {
    for (const p of pts) {
      if (p.x > mx) mx = p.x;
      if (p.y > my) my = p.y;
    }
  };
  for (const op of ops) {
    if (op.kind === "poly") scan(op.points);
    else if (op.kind === "batch") for (const sp of op.polys) scan(sp);
  }
  return { width: Math.ceil(mx), height: Math.ceil(my) };
}

function makeStopSampler(stops) {
  const sorted = stops
    .map(([pos, c]) => [pos, [c[0], c[1], c[2], c[3] == null ? 255 : c[3]]])
    .sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return () => [0, 0, 0, 255];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return (t) => {
    if (t <= first[0]) return first[1];
    if (t >= last[0]) return last[1];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (t >= a[0] && t <= b[0]) {
        const span = b[0] - a[0];
        const f = span > 0 ? (t - a[0]) / span : 0;
        return [
          a[1][0] + (b[1][0] - a[1][0]) * f,
          a[1][1] + (b[1][1] - a[1][1]) * f,
          a[1][2] + (b[1][2] - a[1][2]) * f,
          a[1][3] + (b[1][3] - a[1][3]) * f,
        ];
      }
    }
    return last[1];
  };
}

function makeSampler(fill, fallbackBbox) {
  if (!fill) return null;
  if (fill.type === "solid") {
    const c = fill.color;
    const col = [c[0], c[1], c[2], c[3] == null ? 255 : c[3]];
    return { solid: col };
  }
  if (fill.type !== "grad" || !fill.grad) return null;
  const g = fill.grad;
  const at = makeStopSampler(g.stops);
  if (g.type === "radial") {
    const { cx, cy, rx, ry } = g;
    return { fn: (x, y) => at(Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)) };
  }
  const [bx0, by0, bx1, by1] = g.bbox ?? fallbackBbox;
  const dx = bx1 - bx0;
  const dy = by1 - by0;
  const d2 = dx * dx + dy * dy || 1;
  return { fn: (x, y) => at(((x - bx0) * dx + (y - by0) * dy) / d2) };
}

function fillSubpaths(buf, W, H, subpaths, ss, sampler) {
  const edges = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  const nb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pts of subpaths) {
    if (!pts || pts.length < 3) continue;
    for (const p of pts) {
      if (p.x < nb[0]) nb[0] = p.x;
      if (p.y < nb[1]) nb[1] = p.y;
      if (p.x > nb[2]) nb[2] = p.x;
      if (p.y > nb[3]) nb[3] = p.y;
    }
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const y1 = p1.y * ss;
      const y2 = p2.y * ss;
      if (y1 === y2) continue;
      edges.push([p1.x * ss, y1, p2.x * ss, y2]);
      if (y1 < ymin) ymin = y1;
      if (y2 < ymin) ymin = y2;
      if (y1 > ymax) ymax = y1;
      if (y2 > ymax) ymax = y2;
    }
  }
  if (edges.length === 0) return nb;
  const yStart = Math.max(0, Math.ceil(ymin - 0.5));
  const yEnd = Math.min(H - 1, Math.ceil(ymax - 0.5) - 1);
  const solid = sampler.solid ?? null;
  const fn = sampler.fn ?? null;
  const xs = [];
  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const e of edges) {
      const [x1, ey1, x2, ey2] = e;
      if ((ey1 <= yc && yc < ey2) || (ey2 <= yc && yc < ey1)) {
        xs.push(x1 + ((yc - ey1) * (x2 - x1)) / (ey2 - ey1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const rowBase = y * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W, Math.ceil(xs[k + 1] - 0.5));
      for (let x = xa; x < xb; x++) {
        const c = solid ?? fn((x + 0.5) / ss, (y + 0.5) / ss);
        const sa = c[3] / 255;
        if (sa <= 0) continue;
        if (sa >= 1) {
          const o = (rowBase + x) * 4;
          buf[o] = c[0];
          buf[o + 1] = c[1];
          buf[o + 2] = c[2];
          continue;
        }
        const o = (rowBase + x) * 4;
        const inv = 1 - sa;
        buf[o] = c[0] * sa + buf[o] * inv;
        buf[o + 1] = c[1] * sa + buf[o + 1] * inv;
        buf[o + 2] = c[2] * sa + buf[o + 2] * inv;
      }
    }
  }
  return nb;
}

export function rasterize(ops, width, height, ss = 2) {
  const W = width * ss;
  const H = height * ss;
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = 255;
  }
  const stats = { poly: 0, batch: 0, text: 0, skipped: 0 };
  for (const op of ops) {
    if (op.kind === "text") {
      stats.text++;
      continue;
    }
    const subpaths = op.kind === "batch" ? op.polys : [op.points];
    const sampler = makeSampler(op.fill, boundsOf(subpaths));
    if (!sampler) {
      stats.skipped++;
      continue;
    }
    if (op.kind === "batch") stats.batch++;
    else stats.poly++;
    fillSubpaths(buf, W, H, subpaths, ss, sampler);
  }
  return { buf, W, H, ss, stats };
}

function boundsOf(subpaths) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const pts of subpaths) {
    for (const p of pts ?? []) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  }
  return [x0, y0, x1, y1];
}

export function downsample(buf, W, H, ss) {
  const w = W / ss;
  const h = H / ss;
  const out = new Uint8ClampedArray(w * h * 4);
  const n = ss * ss;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < ss; dy++) {
        const row = (y * ss + dy) * W;
        for (let dx = 0; dx < ss; dx++) {
          const i = (row + x * ss + dx) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          a += buf[i + 3];
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { out, w, h };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG(rgba, w, h) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [input, output] = positional;
  if (!input || !output) {
    console.error(
      "usage: node scripts/ops-preview.mjs <input.js|input.json> <output.png> [--ss 2] [--width N] [--height N]",
    );
    process.exit(1);
  }
  const ops = loadOps(input);
  const auto = contentBounds(ops);
  const width = opts.width ? parseInt(opts.width, 10) : auto.width;
  const height = opts.height ? parseInt(opts.height, 10) : auto.height;
  const ss = Math.max(1, Math.min(4, parseInt(opts.ss ?? "2", 10)));
  const t0 = Date.now();
  const { buf, W, H, stats } = rasterize(ops, width, height, ss);
  const { out, w, h } = downsample(buf, W, H, ss);
  fs.writeFileSync(output, encodePNG(out, w, h));
  console.log(
    JSON.stringify({
      input,
      output,
      width: w,
      height: h,
      ss,
      ops: stats,
      ms: Date.now() - t0,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
