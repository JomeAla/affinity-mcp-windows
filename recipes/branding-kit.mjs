#!/usr/bin/env node
// branding-kit.mjs — reusable identity-construction toolkit for affinity-mcp-windows.
//
// Everything is polygon-native: every primitive returns point arrays (with an
// optional analytic `d` when a shape has a cleaner exact path), so the same
// build can be emitted as:
//   - SVG markup  (open in Affinity via `affinity.open_svg` / open_file), and
//   - ops JSON    (offline preview with scripts/ops-preview.mjs, or run with
//                  recipes/ops-runtime.mjs inside Affinity).
//
// Ships with a parametric high-contrast Didone letter engine (stress-modulated
// variable-width stroke expansion), so display wordmarks can be drawn without
// relying on installed fonts. Includes culinary-mark generators (marbling
// veins, sear stripes), badge/seal geometry and deterministic RNG.
//
// Shape: { points: [{x,y}, ...], d?: string, subs?: [points, ...], evenodd?: bool }
//   - `subs` + `evenodd` describe compound shapes like rings (even-odd fills
//     cancel — same semantics as an Affinity PolyCurve holding several curves,
//     and as a `batch` op in ops-preview).
//
// CLI:
//   node recipes/branding-kit.mjs specimen out.svg [--ops out-ops.json] [--fill '#F2E8D8']

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// numbers, geometry sampling
// ---------------------------------------------------------------------------

export function fn(x) {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pt = (cx, cy, r, aDeg) => {
  const a = (aDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

export const lerp = (a, b, t) => a + (b - a) * t;

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export function sampleArc(cx, cy, rx, ry, a0, a1, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

export function sampleQuadratic(p0, c, p1, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    });
  }
  return out;
}

export function resampleEven(points, step) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = dist(a, b);
    let t = step - carry;
    while (t < d) {
      out.push({ x: lerp(a.x, b.x, t / d), y: lerp(a.y, b.y, t / d) });
      t += step;
    }
    carry = (carry + d) % step;
  }
  if (dist(out[out.length - 1], points[points.length - 1]) > 1e-6) out.push(points[points.length - 1]);
  return out;
}

export function catmullRom(points, samplesPerSeg = 12) {
  if (points.length < 3) return points.slice();
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// polygon primitives
// ---------------------------------------------------------------------------

export function circlePoly(cx, cy, r, tol = 0.2) {
  const steps = Math.max(24, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)))));
  return sampleArc(cx, cy, r, r, 0, 360, steps);
}

export function circleShape(cx, cy, r, tol = 0.2) {
  return { points: circlePoly(cx, cy, r, tol), d: `M ${fn(cx - r)} ${fn(cy)} A ${fn(r)} ${fn(r)} 0 1 1 ${fn(cx + r)} ${fn(cy)} A ${fn(r)} ${fn(r)} 0 1 1 ${fn(cx - r)} ${fn(cy)} Z` };
}

export function rectShape(x, y, w, h) {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    d: `M ${fn(x)} ${fn(y)} H ${fn(x + w)} V ${fn(y + h)} H ${fn(x)} Z`,
  };
}

export function roundedRectShape(x, y, w, h, r) {
  const rr = Math.min(Math.max(r, 0), w / 2, h / 2);
  if (rr <= 0) return rectShape(x, y, w, h);
  const d =
    `M ${fn(x + rr)} ${fn(y)} H ${fn(x + w - rr)} A ${fn(rr)} ${fn(rr)} 0 0 1 ${fn(x + w)} ${fn(y + rr)} ` +
    `V ${fn(y + h - rr)} A ${fn(rr)} ${fn(rr)} 0 0 1 ${fn(x + w - rr)} ${fn(y + h)} ` +
    `H ${fn(x + rr)} A ${fn(rr)} ${fn(rr)} 0 0 1 ${fn(x)} ${fn(y + h - rr)} ` +
    `V ${fn(y + rr)} A ${fn(rr)} ${fn(rr)} 0 0 1 ${fn(x + rr)} ${fn(y)} Z`;
  const pts = [];
  const arc = (acx, acy, a0) => {
    const steps = Math.max(6, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - 0.2 / rr))) / 2));
    for (let i = 0; i <= steps; i++) pts.push(pt(acx, acy, rr, a0 + (90 * i) / steps));
    pts.pop();
  };
  pts.push({ x: x + rr, y });
  pts.push({ x: x + w - rr, y });
  arc(x + w - rr, y + rr, -90);
  pts.push({ x: x + w, y: y + h - rr });
  arc(x + w - rr, y + h - rr, 0);
  pts.push({ x: x + rr, y: y + h });
  arc(x + rr, y + h - rr, 90);
  pts.push({ x, y: y + rr });
  arc(x + rr, y + rr, 180);
  return { points: pts, d };
}

export function ringShape(x, y, w, h, r, thickness) {
  const ti = Math.max(1, thickness);
  const inner = roundedRectShape(x + ti, y + ti, w - ti * 2, h - ti * 2, Math.max(0, r - ti));
  const outer = roundedRectShape(x, y, w, h, r);
  return {
    subs: [outer.points, inner.points],
    evenodd: true,
    d: outer.d + " " + inner.d,
  };
}

export function ringSectorShape(cx, cy, rOuter, rInner, a0, a1) {
  const span = a1 - a0;
  const large = Math.abs(span) > 180 ? 1 : 0;
  const o0 = pt(cx, cy, rOuter, a0);
  const o1 = pt(cx, cy, rOuter, a1);
  const i1 = pt(cx, cy, rInner, a1);
  const i0 = pt(cx, cy, rInner, a0);
  const swO = span >= 0 ? 1 : 0;
  const swI = span >= 0 ? 0 : 1;
  return {
    points: [...sampleArc(cx, cy, rOuter, rOuter, a0, a1, Math.max(6, Math.ceil(Math.abs(span) / 6))), ...sampleArc(cx, cy, rInner, rInner, a1, a0, Math.max(6, Math.ceil(Math.abs(span) / 6)))],
    d:
      `M ${fn(o0.x)} ${fn(o0.y)} A ${fn(rOuter)} ${fn(rOuter)} 0 ${large} ${swO} ${fn(o1.x)} ${fn(o1.y)} ` +
      `L ${fn(i1.x)} ${fn(i1.y)} A ${fn(rInner)} ${fn(rInner)} 0 ${large} ${swI} ${fn(i0.x)} ${fn(i0.y)} Z`,
  };
}

export function sparkShape(cx, cy, R, bulge = 0.18) {
  const p = R * bulge;
  const corners = [
    { x: cx, y: cy - R },
    { x: cx + R, y: cy },
    { x: cx, y: cy + R },
    { x: cx - R, y: cy },
  ];
  const controls = [
    { x: cx + p, y: cy - p },
    { x: cx + p, y: cy + p },
    { x: cx - p, y: cy + p },
    { x: cx - p, y: cy - p },
  ];
  const pts = [];
  for (let i = 0; i < 4; i++) pts.push(...sampleQuadratic(corners[i], controls[i], corners[(i + 1) % 4], 12).slice(0, -1));
  const d =
    `M ${fn(corners[0].x)} ${fn(corners[0].y)} ` +
    `Q ${fn(controls[0].x)} ${fn(controls[0].y)} ${fn(corners[1].x)} ${fn(corners[1].y)} ` +
    `Q ${fn(controls[1].x)} ${fn(controls[1].y)} ${fn(corners[2].x)} ${fn(corners[2].y)} ` +
    `Q ${fn(controls[2].x)} ${fn(controls[2].y)} ${fn(corners[3].x)} ${fn(corners[3].y)} ` +
    `Q ${fn(controls[3].x)} ${fn(controls[3].y)} ${fn(corners[0].x)} ${fn(corners[0].y)} Z`;
  return { points: pts, d };
}

// Thick segment, butt caps (perpendicular ends), optionally analytic quad.
export function barShape(x0, y0, x1, y1, w) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  const pts = [
    { x: x0 + nx, y: y0 + ny },
    { x: x0 - nx, y: y0 - ny },
    { x: x1 - nx, y: y1 - ny },
    { x: x1 + nx, y: y1 + ny },
  ];
  if (Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9) {
    const x = Math.min(pts[0].x, pts[2].x);
    const y = Math.min(pts[0].y, pts[2].y);
    return rectShape(x, y, Math.abs(dx) + w * (dx === 0 ? 1 : 0), Math.abs(dy) + w * (dy === 0 ? 1 : 0));
  }
  return {
    points: pts,
    d: `M ${fn(pts[0].x)} ${fn(pts[0].y)} L ${fn(pts[3].x)} ${fn(pts[3].y)} L ${fn(pts[2].x)} ${fn(pts[2].y)} L ${fn(pts[1].x)} ${fn(pts[1].y)} Z`,
  };
}

export function capsuleShape(x0, y0, x1, y1, w) {
  const r = w / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const arcA = sampleArc(x0, y0, r, r, angle + 90, angle + 270, 16).slice(0, -1);
  const arcB = sampleArc(x1, y1, r, r, angle - 90, angle + 90, 16).slice(0, -1);
  const pts = [...arcB, ...arcA];
  const at = (cx, cy, a0, a1) => {
    const p0 = pt(cx, cy, r, a0);
    const p1 = pt(cx, cy, r, a1);
    return `A ${fn(r)} ${fn(r)} 0 0 1 ${fn(p1.x)} ${fn(p1.y)}`;
  };
  const b0 = pt(x1, y1, r, angle - 90);
  return {
    points: pts,
    d: `M ${fn(b0.x)} ${fn(b0.y)} ${at(x1, y1, angle - 90, angle + 90)} L ${fn(pt(x0, y0, r, angle + 90).x)} ${fn(pt(x0, y0, r, angle + 90).y)} ${at(x0, y0, angle + 90, angle + 270)} Z`,
  };
}

// ---------------------------------------------------------------------------
// variable-width stroke expansion (the Didone engine's core)
// ---------------------------------------------------------------------------

// points: dense polyline. widthFn(t01, i0, tx, ty) -> full stroke width.
// Returns a closed polygon outline with butt caps.
export function ribbon(points, widthFn, { taper = 0 } = {}) {
  const n = points.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;
    let w = widthFn(i / (n - 1), i, tx, ty);
    if (taper > 0) {
      const edge = Math.min(i / (n - 1), 1 - i / (n - 1));
      w *= lerp(1 - taper, 1, Math.min(1, edge * 8));
    }
    const hw = Math.max(w / 2, 0.01);
    left.push({ x: p.x - ty * hw, y: p.y + tx * hw });
    right.push({ x: p.x + ty * hw, y: p.y - tx * hw });
  }
  return { points: [...left, ...right.reverse()] };
}

// Didone width modulation: full width from tangent angle vs vertical stress.
// c = |ty| for unit tangent (1 = vertical stroke = thickest).
export function didoneWidthFn(thick, hair, power = 1.8, hairFloor = 1) {
  const lo = hair * hairFloor;
  return (t, i, tx, ty) => {
    const c = Math.min(1, Math.abs(ty));
    return lo + (thick - lo) * Math.pow(c, power);
  };
}

// ---------------------------------------------------------------------------
// high-contrast Didone letter engine (FAUX REAL letter set + more)
// ---------------------------------------------------------------------------

export const DIDONE_DEFAULTS = {
  H: 1000,
  thickFrac: 0.155,
  hairFrac: 0.034,
  contrastPower: 1.8,
  trackingFrac: 0.055,
  wordSpaceFrac: 0.34,
  letterOverrides: {},
};

function didoneParams(opts = {}) {
  const H = opts.H ?? DIDONE_DEFAULTS.H;
  const thick = opts.thickFrac != null ? opts.thickFrac * H : DIDONE_DEFAULTS.thickFrac * H;
  const hair = opts.hairFrac != null ? opts.hairFrac * H : DIDONE_DEFAULTS.hairFrac * H;
  const power = opts.contrastPower ?? DIDONE_DEFAULTS.contrastPower;
  return { H, T: thick, t: hair, power };
}

function armSerif(x, yCenter, t) {
  return rectShape(x - (t * 1.5) / 2, yCenter - t * 1.35, t * 1.5, t * 2.7);
}

function stemSerif(xc, yEdge, w, t, below = false) {
  return rectShape(xc - w / 2, below ? yEdge - t : yEdge, w, t);
}

function glyphF(P) {
  const { H, T, t } = P;
  const shapes = [];
  const stemX = T / 2;
  const armEnd = H * 0.6;
  const midEnd = H * 0.52;
  const midY = H * 0.5;
  shapes.push(barShape(stemX, 0, stemX, H, T));
  shapes.push(stemSerif(stemX, 0, T * 1.95, t));
  shapes.push(stemSerif(stemX, H, T * 1.95, t, true));
  shapes.push(barShape(stemX, t / 2, armEnd, t / 2, t));
  shapes.push(armSerif(armEnd + t * 0.35, t / 2, t));
  shapes.push(barShape(stemX, midY, midEnd, midY, t * 0.94));
  shapes.push(armSerif(midEnd + t * 0.35, midY, t));
  return { width: armEnd + t * 2.2, shapes };
}

function glyphA(P) {
  const { H, T, t } = P;
  const W = H * 0.875;
  const shapes = [];
  const apexX = W * 0.5;
  const footL = T * 1.05;
  const footR = W - T * 1.05;
  const wL = lerp(t, T, 0.6);
  const wR = T * 0.94;
  const apexY = t * 0.45;
  const crossY = H * 0.56;
  shapes.push(barShape(apexX + t * 0.15, apexY, footR, H, wR));
  shapes.push(barShape(apexX - t * 0.15, apexY, footL, H, wL));
  shapes.push(rectShape(apexX - wR * 0.52, apexY - t * 0.55, wR * 1.04, t * 1.1));
  const horizHalf = (from, to, y, w) => {
    const len = Math.hypot(to - from, H - apexY) || 1;
    return (w / 2) * (len / (H - apexY));
  };
  const leftXAtY = lerp(apexX - t * 0.15, footL, (crossY - apexY) / (H - apexY));
  const rightXAtY = lerp(apexX + t * 0.15, footR, (crossY - apexY) / (H - apexY));
  const cbL = leftXAtY + horizHalf(apexX - t * 0.15, footL, crossY, wL) - wL * 0.12;
  const cbR = rightXAtY - horizHalf(apexX + t * 0.15, footR, crossY, wR) + wR * 0.12;
  shapes.push(barShape(cbL, crossY, cbR, crossY, t * 0.92));
  shapes.push(stemSerif(footL + wL * 0.35, H, T * 2.1, t, true));
  shapes.push(stemSerif(footR - wR * 0.3, H, T * 2.1, t, true));
  return { width: W, shapes };
}

function glyphU(P) {
  const { H, T, t, power } = P;
  const W = H * 0.84;
  const shapes = [];
  const Rm = (W - T) / 2;
  const yc = H - Rm;
  const skel = [];
  for (let i = 0; i <= 10; i++) skel.push({ x: T / 2, y: (yc * i) / 10 });
  skel.push(...sampleArc(W / 2, yc, Rm, Rm, 180, 0, 72));
  for (let i = 1; i <= 10; i++) skel.push({ x: W - T / 2, y: yc - (yc * i) / 10 });
  const wfn = didoneWidthFn(T, t, power, 1.35);
  shapes.push(ribbon(skel, wfn));
  shapes.push(stemSerif(T / 2, 0, T * 1.95, t));
  shapes.push(stemSerif(W - T / 2, 0, T * 1.95, t));
  return { width: W, shapes };
}

function glyphX(P) {
  const { H, T, t } = P;
  const W = H * 0.875;
  const shapes = [];
  const wD = lerp(t, T, 0.8);
  shapes.push(barShape(0, 0, W, H, wD));
  shapes.push(barShape(W, 0, 0, H, wD));
  const dxTip = (wD / 2) * 1.35;
  const topY = t / 2;
  const botY = H - t / 2;
  shapes.push(stemSerif(dxTip, topY, T * 1.9, t));
  shapes.push(stemSerif(W - dxTip, topY, T * 1.9, t));
  shapes.push(stemSerif(W - dxTip, botY, T * 1.9, t, true));
  shapes.push(stemSerif(dxTip, botY, T * 1.9, t, true));
  return { width: W, shapes };
}

function glyphR(P) {
  const { H, T, t, power } = P;
  const W = H * 0.78;
  const shapes = [];
  const stemX = T / 2;
  shapes.push(barShape(stemX, 0, stemX, H, T));
  shapes.push(stemSerif(stemX, 0, T * 1.95, t));
  shapes.push(stemSerif(stemX, H, T * 1.95, t, true));
  const bcx = T * 0.9;
  const bcy = H * 0.3;
  const brx = W - T * 1.0 - bcx;
  const bry = H * 0.26;
  const bowl = sampleArc(bcx, bcy, brx, bry, -95, 62, 64);
  const wfn = didoneWidthFn(T, t, power, 1.15);
  shapes.push(ribbon(bowl, wfn));
  const legFrom = { x: lerp(bcx, bcx + brx, Math.cos((58 * Math.PI) / 180)), y: lerp(bcy, bcy + bry, Math.sin((58 * Math.PI) / 180)) };
  const ballR = t * 1.85;
  const ballC = { x: W - ballR * 0.9, y: H - ballR * 0.95 };
  const leg = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    leg.push({ x: lerp(legFrom.x, ballC.x, s), y: lerp(legFrom.y, ballC.y, s) });
  }
  shapes.push(ribbon(leg, (tt) => lerp(T * 0.82, t * 1.5, tt)));
  shapes.push(circleShape(ballC.x, ballC.y, ballR));
  return { width: W, shapes };
}

function glyphE(P) {
  const { H, T, t } = P;
  const shapes = [];
  const stemX = T / 2;
  shapes.push(barShape(stemX, 0, stemX, H, T));
  shapes.push(stemSerif(stemX, 0, T * 1.95, t));
  shapes.push(stemSerif(stemX, H, T * 1.95, t, true));
  const topEnd = H * 0.6;
  const midEnd = H * 0.55;
  const botEnd = H * 0.66;
  const midY = H * 0.5;
  shapes.push(barShape(stemX, t / 2, topEnd, t / 2, t));
  shapes.push(armSerif(topEnd + t * 0.35, t / 2, t));
  shapes.push(barShape(stemX, midY, midEnd, midY, t * 0.94));
  shapes.push(armSerif(midEnd + t * 0.35, midY, t));
  shapes.push(barShape(stemX, H - t / 2, botEnd, H - t / 2, t));
  shapes.push(armSerif(botEnd + t * 0.35, H - t / 2, t));
  return { width: topEnd + t * 2.2, shapes };
}

function glyphL(P) {
  const { H, T, t } = P;
  const shapes = [];
  const stemX = T / 2;
  shapes.push(barShape(stemX, 0, stemX, H, T));
  shapes.push(stemSerif(stemX, 0, T * 1.95, t));
  const footEnd = H * 0.64;
  shapes.push(barShape(stemX, H - t / 2, footEnd, H - t / 2, t));
  shapes.push(armSerif(footEnd + t * 0.35, H - t / 2, t));
  return { width: footEnd + t * 2.2, shapes };
}

const GLYPHS = { F: glyphF, A: glyphA, U: glyphU, X: glyphX, R: glyphR, E: glyphE, L: glyphL };

export function didoneGlyph(ch, opts = {}) {
  const P = didoneParams(opts);
  if (ch === " ") return { width: P.H * 0.34, shapes: [] };
  const g = GLYPHS[ch.toUpperCase()];
  if (!g) throw new Error(`branding-kit: no didone glyph for "${ch}"`);
  return g(P);
}

export function didoneWord(text, opts = {}) {
  const P = didoneParams(opts);
  const tracking = (opts.trackingFrac ?? DIDONE_DEFAULTS.trackingFrac) * P.H;
  const kern = opts.kern ?? {};
  const letters = [];
  let x = 0;
  let prev = "";
  for (const ch of text.toUpperCase()) {
    const g = didoneGlyph(ch, opts);
    x += (kern[prev + ch] ?? 0) * P.H;
    letters.push({ ch, x, width: g.width, shapes: g.shapes });
    x += g.width + tracking;
    prev = ch;
  }
  const width = Math.max(0, x - tracking);
  const bbox = shapeBounds(letters.flatMap((l) => l.shapes));
  return {
    width,
    height: P.H,
    letters,
    bounds: bbox,
    opt: P,
    svg(fill, { transform = "" } = {}) {
      const body = letters
        .filter((l) => l.shapes.length)
        .map(
          (l) =>
            `<g transform="translate(${fn(l.x)} 0)">\n` +
            l.shapes.map((s) => `  <path d="${shapeD(s)}"/>`).join("\n") +
            "\n</g>",
        )
        .join("\n");
      return `<g fill="${fill}"${transform ? ` transform="${transform}"` : ""}>\n${body}\n</g>`;
    },
    ops(fill) {
      return letters.flatMap((l) => shiftShapes(l.shapes, l.x, 0)).flatMap((s) => shapeToOps(s, fill));
    },
  };
}

// ---------------------------------------------------------------------------
// culinary generators: marbling veins, sear stripes, tick rings
// ---------------------------------------------------------------------------

export function marbleVeins({ x = 0, y = 0, w = 800, h = 500, count = 5, seed = 7, thickness = 16, curl = 0.5, angle = 12 } = {}) {
  const rnd = mulberry32(seed);
  const shapes = [];
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let i = 0; i < count; i++) {
    const band = (i + 0.5) / count;
    const off = (band - 0.5) * h * 0.82 + (rnd() - 0.5) * h * 0.08;
    const phase = rnd() * TAU;
    const phase2 = rnd() * TAU;
    const wob = 0.1 + rnd() * 0.12;
    const rise = 0.04 + rnd() * 0.05;
    const pts = [];
    const steps = 56;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const along = (u - 0.5) * w * 1.02;
      const across =
        off +
        Math.sin(u * 3.1 + phase) * h * wob * curl +
        Math.sin(u * 7.3 + phase2) * h * rise * curl +
        (u - 0.5) * h * 0.06 * (rnd() * 2 - 1);
      pts.push({ x: cx + along * cos - across * sin, y: cy + along * sin + across * cos });
    }
    const t0 = thickness * (0.7 + rnd() * 0.6);
    const wfn = (t) => {
      const peak = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.55);
      return Math.max(0.6, t0 * (0.25 + 0.75 * peak));
    };
    shapes.push(ribbon(catmullRom(pts, 4), wfn, { taper: 0.85 }));
  }
  return shapes;
}

export function searStripes({ x = 0, y = 0, w = 800, h = 300, stripes = 5, thickness = 30, gap = 12, angle = -16, radius = 14, skew = 0 } = {}) {
  const shapes = [];
  const totalW = stripes * thickness + (stripes - 1) * gap;
  const rad = (angle * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let i = 0; i < stripes; i++) {
    const bx = -(totalW / 2) + i * (thickness + gap);
    const bar = roundedRectShape(bx, -h / 2, thickness, h, radius);
    const shifted = bar.points.map((p) => {
      const sx = p.x + skew * p.y;
      return { x: cx + sx * Math.cos(rad) - p.y * Math.sin(rad), y: cy + sx * Math.sin(rad) + p.y * Math.cos(rad) };
    });
    shapes.push({ points: shifted });
  }
  return shapes;
}

export function tickRing(cx, cy, rOuter, len, count, { a0 = 0, a1 = 360, gapFrac = 0.45 } = {}) {
  const shapes = [];
  const step = (a1 - a0) / count;
  for (let i = 0; i < count; i++) {
    const a = a0 + i * step + step * gapFrac * 0.5;
    const b = a0 + i * step + step * (1 - gapFrac * 0.5);
    shapes.push(ringSectorShape(cx, cy, rOuter, rOuter - len, a, b));
  }
  return shapes;
}

// ---------------------------------------------------------------------------
// shape utilities, emitters
// ---------------------------------------------------------------------------

function shapeD(s) {
  if (s.d) return s.d;
  const ring = (pts) => "M " + pts.map((p, i) => `${i ? "L " : ""}${fn(p.x)} ${fn(p.y)}`).join(" ") + " Z";
  if (s.subs) return s.subs.map(ring).join(" ");
  return ring(s.points);
}

export function shapeBounds(shapes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (pts) => {
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  };
  for (const s of shapes) {
    if (s.subs) s.subs.forEach(scan);
    else if (s.points) scan(s.points);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function shiftShapes(shapes, dx, dy) {
  if (!dx && !dy) return shapes;
  const shift = (p) => ({ x: p.x + dx, y: p.y + dy });
  return shapes.map((s) => {
    const out = { ...s, d: undefined };
    if (s.points) out.points = s.points.map(shift);
    if (s.subs) out.subs = s.subs.map((sub) => sub.map(shift));
    return out;
  });
}

export function scaleShapes(shapes, sx, sy = sx) {
  const sc = (p) => ({ x: p.x * sx, y: p.y * sy });
  return shapes.map((s) => {
    const out = { ...s, d: undefined };
    if (s.points) out.points = s.points.map(sc);
    if (s.subs) out.subs = s.subs.map((sub) => sub.map(sc));
    return out;
  });
}

export function normalizeShapes(shapes, pad = 0) {
  const b = shapeBounds(shapes);
  return shiftShapes(shapes, -b.minX + pad, -b.minY + pad);
}

export function hexToRgba(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

export function shapeToOps(s, fillHex) {
  const fill = { type: "solid", color: hexToRgba(fillHex) };
  if (s.subs) return [{ kind: "batch", polys: s.subs, fill }];
  if (s.points) return [{ kind: "poly", points: s.points, fill }];
  return [];
}

export function shapesToOps(shapes, fillHex) {
  return shapes.flatMap((s) => shapeToOps(s, fillHex));
}

export function shapesMarkup(shapes, fill, { fillRule } = {}) {
  const attrs = fillRule ? ` fill-rule="${fillRule}"` : "";
  return `<g fill="${fill}">\n` + shapes.map((s) => `  <path${s.evenodd || fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""} d="${shapeD(s)}"/>`).join("\n") + "\n</g>";
}

export function svgDoc({ width, height, body, extra = "" }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">\n` +
    (extra ? extra + "\n" : "") +
    body +
    "\n</svg>\n"
  );
}

// ---------------------------------------------------------------------------
// specimen CLI: eyeball the Didone engine + generators in one sheet
// ---------------------------------------------------------------------------

function buildSpecimen({ fill = "#F2E8D8" } = {}) {
  const W = 2400;
  const H = 1500;
  const parts = [];
  const ops = [];

  const word = didoneWord("FAUX REAL", { H: 300, trackingFrac: 0.06 });
  const wordX = (W - word.width) / 2;
  const wordY = 120;
  parts.push(`<g transform="translate(${fn(wordX - word.bounds.minX)} ${fn(wordY - word.bounds.minY)})">\n${word.svg(fill)}\n</g>`);
  ops.push(...shiftShapes(word.letters.flatMap((l) => shiftShapes(l.shapes, l.x, 0)), wordX - word.bounds.minX, wordY - word.bounds.minY).flatMap((s) => shapeToOps(s, fill)));

  const row = "F A U X R E L".split(" ").map((ch) => didoneGlyph(ch, { H: 190 }));
  let x = 160;
  const rowY = 620;
  row.forEach((g) => {
    const bs = g.shapes;
    const b = shapeBounds(bs);
    parts.push(`<g transform="translate(${fn(x - b.minX)} ${fn(rowY - b.minY)})">\n${shapesMarkup(bs, fill)}\n</g>`);
    ops.push(...shiftShapes(bs, x - b.minX, rowY - b.minY).flatMap((s) => shapeToOps(s, fill)));
    x += g.width + 150;
  });

  const veins = marbleVeins({ x: 170, y: 950, w: 880, h: 340, count: 5, seed: 11, thickness: 22, curl: 0.55, angle: 10 });
  parts.push(shapesMarkup(veins, fill));
  ops.push(...shapesToOps(veins, fill));

  const sear = searStripes({ x: 1300, y: 950, w: 620, h: 300, stripes: 5, thickness: 42, gap: 26, angle: -18, radius: 20 });
  parts.push(shapesMarkup(sear, fill));
  ops.push(...shapesToOps(sear, fill));

  const ring = ringShape(2050, 1010, 300, 260, 90, 34);
  parts.push(shapesMarkup([ring], fill));
  ops.push(...shapesToOps([ring], fill));

  const ticks = tickRing(2050, 1140, 128, 30, 24, { a0: 0, a1: 360 });
  parts.push(shapesMarkup(ticks, fill));
  ops.push(...shapesToOps(ticks, fill));

  return { svg: svgDoc({ width: W, height: H, body: parts.join("\n"), extra: `<rect width="${W}" height="${H}" fill="#191412"/>` }), ops };
}

function main() {
  const [, , cmd, outArg] = process.argv;
  if (cmd !== "specimen" || !outArg) {
    console.log("usage: node recipes/branding-kit.mjs specimen out.svg [--ops out-ops.json] [--fill '#F2E8D8']");
    process.exitCode = 1;
    return;
  }
  const opsIdx = process.argv.indexOf("--ops");
  const fillIdx = process.argv.indexOf("--fill");
  const fill = fillIdx > -1 ? process.argv[fillIdx + 1] : "#F2E8D8";
  const { svg, ops } = buildSpecimen({ fill });
  fs.writeFileSync(outArg, svg, "utf8");
  if (opsIdx > -1) fs.writeFileSync(process.argv[opsIdx + 1], JSON.stringify(ops), "utf8");
  console.log(`specimen: ${outArg}${opsIdx > -1 ? ` + ${process.argv[opsIdx + 1]}` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
