'use strict';
// affinity-drawing-helpers.js
// Paste-ready helper block for Affinity execute_script drawings.
// Requires an open document named `doc`. All coordinates are pixels.

const { PolyCurveNodeDefinition } = require('/nodes.js');
const { Curve, PolyCurve, CurveBuilder, Rectangle, Transform } = require('/geometry.js');
const { FillDescriptor } = require('/fills.js');
const { RGBA8 } = require('/colours.js');
const { LineStyleDescriptor } = require('/linestyle.js');

const PALETTE = {
  sumi: [11, 11, 13, 255],
  charcoal: [26, 26, 30, 255],
  bone: [232, 228, 218, 255],
  crimson: [138, 15, 23, 255],
  gold: [201, 162, 39, 255],
};

const none = FillDescriptor.createNone();
const defaultLine = LineStyleDescriptor.createDefault();

function colour(c) {
  return FillDescriptor.createSolid(RGBA8(c[0], c[1], c[2], c[3]));
}

function addPoly(poly, fill) {
  return doc.addNode(PolyCurveNodeDefinition.create(poly, fill, none, defaultLine, none));
}

function addCurve(curve, c) {
  const poly = PolyCurve.create();
  poly.addCurve(curve);
  return addPoly(poly, colour(c));
}

function addOpenCurve(curve, c, weight) {
  const poly = PolyCurve.create();
  poly.addCurve(curve);
  return doc.addNode(PolyCurveNodeDefinition.create(poly, none, colour(c), LineStyleDescriptor.createDefault(weight), none));
}

function circle(cx, cy, r, c) {
  const poly = PolyCurve.create();
  poly.addCurve(Curve.createEllipse(new Rectangle(cx - r, cy - r, r * 2, r * 2)));
  return addPoly(poly, colour(c));
}

function rect(x, y, w, h, c) {
  const poly = PolyCurve.create();
  poly.addCurve(Curve.createRectangle(new Rectangle(x, y, w, h)));
  return addPoly(poly, colour(c));
}

// Ring with a true hole: inner curve wound the opposite way.
function ring(cx, cy, outerR, innerR, c) {
  const outer = Curve.createEllipse(new Rectangle(cx - outerR, cy - outerR, outerR * 2, outerR * 2));
  const inner = Curve.createEllipse(new Rectangle(cx - innerR, cy - innerR, innerR * 2, innerR * 2));
  inner.transform(Transform.createTranslate(cx, cy).multiply(Transform.createScale(-1, 1)).multiply(Transform.createTranslate(-cx, -cy)));
  const poly = PolyCurve.create();
  poly.addCurve(outer);
  poly.addCurve(inner);
  return addPoly(poly, colour(c));
}

function mirrorXAt(curve, axisX) {
  const c = curve.clone();
  c.transform(Transform.createTranslate(axisX * 2, 0).multiply(Transform.createScale(-1, 1)));
  return c;
}

// Catmull-Rom style smoothing through a closed point list.
function smoothClosed(pts) {
  const N = pts.length;
  const b = CurveBuilder.create();
  b.beginXY(pts[0].x, pts[0].y);
  for (let i = 1; i <= N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i % N];
    const p2 = pts[(i + 1) % N];
    const tx = (p2.x - p0.x) * 0.36;
    const ty = (p2.y - p0.y) * 0.36;
    b.addBezierXY(p1.x - tx, p1.y - ty, p1.x + tx, p1.y + ty, p1.x, p1.y);
  }
  b.close();
  const poly = PolyCurve.create();
  poly.addCurve(b.createCurve());
  return poly;
}

// Ink splatter: wobbly blob with a single longer tendril.
function blob(cx, cy, r, seed, c) {
  const N = 20;
  const tendril = Math.floor((seed * 3.7) % N);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let rr = r * (1 + 0.12 * Math.sin(2 * a + seed) + 0.1 * Math.sin(5 * a + seed * 1.7) + 0.06 * Math.sin(9 * a + seed * 3.1));
    if (i === tendril) rr *= 1.45;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  const poly = smoothClosed(pts);
  return addPoly(poly, colour(c));
}

// Halftone arc: circles marching along an arc, sizes falling off.
function halftoneArc(cx, cy, radius, startDeg, endDeg, count, maxDot, minDot, c) {
  for (let i = 0; i < count; i++) {
    const a = ((startDeg + ((endDeg - startDeg) * i) / (count - 1)) * Math.PI) / 180;
    const r = maxDot - ((maxDot - minDot) * i) / (count - 1);
    circle(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, r, c);
  }
}
