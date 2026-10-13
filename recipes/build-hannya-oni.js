'use strict';
// build-hannya-oni.js
// Complete parametric build: HANNYA oni mask tee print, 3600x4800 px @300dpi, transparent.
// Set MODE to 'inverse' and re-run in a fresh document for the black-garment version.
//
// Run via affinity.execute_script. The document is created by the script itself.

const { Document, NewDocumentOptions } = require('/document.js');
const { UnitType } = require('/units.js');
const { PolyCurveNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { Curve, PolyCurve, CurveBuilder, Rectangle, Transform } = require('/geometry.js');
const { FillDescriptor } = require('/fills.js');
const { RGBA8 } = require('/colours.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts } = require('/glyphatts.js');
const { Font } = require('/fonts.js');
const { RasterFormat } = require('/rasterobject.js');

const MODE = 'ink'; // 'ink' for light garments, 'inverse' for black garments
const SUMI = [11, 11, 13, 255], BONE = [232, 228, 218, 255], CRIMSON = [138, 15, 23, 255], GOLD = [201, 162, 39, 255];
const FACE = MODE === 'ink' ? SUMI : BONE;
const FNEG = MODE === 'ink' ? BONE : SUMI;
const SPLAT = FACE;
const TEXTCOL = FACE;

const opts = NewDocumentOptions.createDefault();
opts.units = UnitType.Pixel;
opts.dpi = 300;
opts.width = 3600;
opts.height = 4800;
opts.isTransparentBackground = true;
const doc = Document.createFromOptions(opts);

const none = FillDescriptor.createNone();
const ls = LineStyleDescriptor.createDefault();
const add = (poly, c) => doc.addNode(PolyCurveNodeDefinition.create(poly, FillDescriptor.createSolid(RGBA8(c[0], c[1], c[2], c[3])), none, ls, none));
const addOpen = (poly, c, w) => doc.addNode(PolyCurveNodeDefinition.create(poly, none, FillDescriptor.createSolid(RGBA8(c[0], c[1], c[2], c[3])), LineStyleDescriptor.createDefault(w), none));
const one = (curve) => { const p = PolyCurve.create(); p.addCurve(curve); return p; };
const circ = (cx, cy, r) => { const p = PolyCurve.create(); p.addCurve(Curve.createEllipse(new Rectangle(cx - r, cy - r, r * 2, r * 2))); return p; };
const mirror = (curve) => { const c = curve.clone(); c.transform(Transform.createTranslate(3600, 0).multiply(Transform.createScale(-1, 1))); return c; };
const smoothClosed = (pts) => {
  const N = pts.length; const b = CurveBuilder.create();
  b.beginXY(pts[0].x, pts[0].y);
  for (let i = 1; i <= N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i % N], p2 = pts[(i + 1) % N];
    const tx = (p2.x - p0.x) * 0.36, ty = (p2.y - p0.y) * 0.36;
    b.addBezierXY(p1.x - tx, p1.y - ty, p1.x + tx, p1.y + ty, p1.x, p1.y);
  }
  b.close(); const poly = PolyCurve.create(); poly.addCurve(b.createCurve()); return poly;
};
const blob = (cx, cy, r, seed) => {
  const N = 20, pts = []; const ti = Math.floor((seed * 3.7) % N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let rr = r * (1 + 0.12 * Math.sin(2 * a + seed) + 0.10 * Math.sin(5 * a + seed * 1.7) + 0.06 * Math.sin(9 * a + seed * 3.1));
    if (i === ti) rr *= 1.45;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return smoothClosed(pts);
};

add(circ(1800, 2450, 1430), CRIMSON);

const fb = CurveBuilder.create();
fb.beginXY(1800, 1420);
fb.addBezierXY(1880, 1430, 1930, 1460, 1980, 1500);
fb.lineToXY(2130, 1610);
fb.addBezierXY(2220, 1660, 2260, 1690, 2300, 1720);
fb.addBezierXY(2430, 1810, 2520, 1890, 2560, 1980);
fb.addBezierXY(2620, 2100, 2660, 2230, 2680, 2350);
fb.addBezierXY(2620, 2480, 2500, 2580, 2400, 2640);
fb.addBezierXY(2320, 2700, 2210, 2860, 2100, 2980);
fb.addBezierXY(2040, 3060, 1960, 3150, 1910, 3230);
fb.addBezierXY(1870, 3280, 1848, 3310, 1830, 3330);
fb.lineToXY(1770, 3330);
fb.addBezierXY(1752, 3310, 1730, 3280, 1690, 3230);
fb.addBezierXY(1640, 3150, 1560, 3060, 1500, 2980);
fb.addBezierXY(1390, 2860, 1280, 2700, 1200, 2640);
fb.addBezierXY(1100, 2580, 980, 2480, 920, 2350);
fb.addBezierXY(940, 2230, 980, 2100, 1040, 1980);
fb.addBezierXY(1080, 1890, 1170, 1810, 1300, 1720);
fb.addBezierXY(1340, 1690, 1380, 1660, 1470, 1610);
fb.lineToXY(1620, 1500);
fb.addBezierXY(1670, 1460, 1720, 1430, 1800, 1420);
fb.close();
add(one(fb.createCurve()), FACE);

const hb = CurveBuilder.create();
hb.beginXY(2320, 1680);
hb.addBezierXY(2540, 1350, 2660, 1080, 2660, 880);
hb.addBezierXY(2540, 1080, 2300, 1500, 2170, 1700);
hb.close();
add(one(hb.createCurve()), GOLD);
add(one(mirror(hb.createCurve())), GOLD);

const eb = CurveBuilder.create();
eb.beginXY(1905, 2065);
eb.addBezierXY(2030, 1970, 2140, 1930, 2270, 1935);
eb.addBezierXY(2265, 1990, 2245, 2050, 2205, 2085);
eb.addBezierXY(2145, 2140, 2030, 2185, 1925, 2165);
eb.addBezierXY(1935, 2130, 1905, 2100, 1905, 2065);
eb.close();
add(one(eb.createCurve()), FNEG);
add(one(mirror(eb.createCurve())), FNEG);
add(circ(2090, 2050, 58), CRIMSON);
add(circ(1510, 2050, 58), CRIMSON);

const brb = CurveBuilder.create();
brb.beginXY(1915, 1925); brb.lineToXY(2295, 1795); brb.lineToXY(2325, 1855); brb.lineToXY(1950, 1985); brb.close();
add(one(brb.createCurve()), CRIMSON);
add(one(mirror(brb.createCurve())), CRIMSON);

const nb = CurveBuilder.create();
nb.beginXY(1720, 2430); nb.lineToXY(1880, 2430); nb.lineToXY(1800, 2700); nb.close();
add(one(nb.createCurve()), FNEG);

const mb = CurveBuilder.create();
mb.beginXY(1400, 2920);
mb.addBezierXY(1650, 2860, 1950, 2860, 2200, 2920);
mb.addBezierXY(2235, 2990, 2235, 3050, 2200, 3120);
mb.addBezierXY(1950, 3180, 1650, 3180, 1400, 3120);
mb.addBezierXY(1365, 3050, 1365, 2990, 1400, 2920);
mb.close();
add(one(mb.createCurve()), CRIMSON);

const tri = (x0, x1, yTop, depth) => { const b = CurveBuilder.create(); b.beginXY(x0, yTop); b.lineToXY(x1, yTop); b.lineToXY((x0 + x1) / 2, yTop + depth); b.close(); return b.createCurve(); };
for (const seg of [[1500, 1590], [1660, 1750], [1850, 1940], [2010, 2100]]) add(one(tri(seg[0], seg[1], 2928, 85)), FNEG);
for (const seg of [[1560, 1650], [1740, 1830], [1920, 2010]]) add(one(tri(seg[0], seg[1], 3110, -75)), FNEG);
const canR = CurveBuilder.create();
canR.beginXY(2200, 2925); canR.lineToXY(2100, 2938); canR.lineToXY(2155, 3180); canR.close();
add(one(canR.createCurve()), FNEG);
add(one(mirror(canR.createCurve())), FNEG);

const cb = CurveBuilder.create();
cb.beginXY(2380, 2650); cb.lineToXY(2265, 2765); cb.lineToXY(2335, 2855); cb.lineToXY(2225, 2940);
addOpen(one(cb.createCurve()), CRIMSON, 16);
addOpen(one(mirror(cb.createCurve())), CRIMSON, 16);

for (const s of [[560, 1480, 150, 1.1], [2800, 1250, 140, 4.2], [2980, 2520, 120, 7.4], [650, 4000, 140, 5.8], [2560, 3920, 110, 2.7]]) add(blob(s[0], s[1], s[2], s[3]), SPLAT);
for (const s of [[430, 1330, 35], [700, 1700, 25], [2950, 1150, 30], [2900, 2680, 30], [660, 4160, 32], [2430, 4060, 26], [1140, 4380, 28], [2300, 760, 22]]) add(circ(s[0], s[1], s[2]), SPLAT);
for (let i = 0; i < 7; i++) { const a = (130 + (55 * i) / 6) * Math.PI / 180; add(circ(1800 + Math.cos(a) * 1540, 2450 + Math.sin(a) * 1540, 46 - i * 5), SPLAT); }
for (let i = 0; i < 6; i++) { const a = (305 + (45 * i) / 5) * Math.PI / 180; add(circ(1800 + Math.cos(a) * 1540, 2450 + Math.sin(a) * 1540, 40 - i * 4.5), SPLAT); }
for (const d of [[1785, 3470, 16], [1815, 3525, 20], [1795, 3575, 14], [1810, 3620, 10]]) add(circ(d[0], d[1], d[2]), SPLAT);

const buildText = (txt, family, c, hgt) => {
  const b = StoryBuilder.create();
  b.setToArtisticTextDefaultStyle(doc.dpi, RasterFormat.RGBA8);
  const ga = GlyphAtts.create();
  ga.font = Font.create(family, 400, false, 5);
  ga.height = hgt;
  ga.brushFill = FillDescriptor.createSolid(RGBA8(c[0], c[1], c[2], c[3]));
  b.setGlyphAtts(ga);
  b.addText(txt);
  doc.addNode(ArtTextNodeDefinition.createFromStoryBuilder({ x: 0, y: -99999 }, b));
  return doc.layers.last;
};

const specs = [
  ['HANNYA', 'Impact', 2600, 1800, 140],
  ['MASK OF THE JEALOUS DEMON', 'Franklin Gothic Medium', 2000, 1800, 3660],
  ['\u822c\u82e5', 'MS Gothic', 900, 1800, 4320],
];
const ratios = [];
for (const s of specs) {
  const m = buildText(s[0], s[1], TEXTCOL, 100);
  const mb = m.baseBox;
  ratios.push(mb.width / 100);
  m.delete();
}
const finals = [];
for (let i = 0; i < specs.length; i++) {
  finals.push({ node: buildText(specs[i][0], specs[i][1], TEXTCOL, specs[i][2] / ratios[i]), cx: specs[i][3], ty: specs[i][4] });
}
for (const f of finals) {
  const bb = f.node.baseBox;
  doc.applyTransform(Transform.createTranslate(f.cx - (bb.x + bb.width / 2), f.ty - bb.y), f.node.selfSelection);
}

add(one(Curve.createRectangle(new Rectangle(2950, 4388, 300, 300))), CRIMSON);
const sealChar = buildText('\u822c', 'MS Gothic', BONE, 208);
const yb = sealChar.baseBox;
doc.applyTransform(Transform.createTranslate(3100 - (yb.x + yb.width / 2), 4438 - yb.y), sealChar.selfSelection);

console.log(JSON.stringify({ built: true, mode: MODE, layers: doc.layers.length, title: doc.title }));
