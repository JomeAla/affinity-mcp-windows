#!/usr/bin/env node
// ops-runtime.mjs — Node-side harness that turns a plain "op list" into a
// runnable Affinity SDK script (the kind `affinity.execute_script` / the
// affinity-driver CLI runs inside the app).
//
// Why: building illustrations by calling `addNode` per shape from Node is slow
// over the bridge (each tool call is a round trip), and pasting hundreds of
// per-shape SDK calls by hand is worse. Instead:
//
//   1. In Node, build `ops` — a JSON-serialisable array describing every shape.
//   2. buildScript(ops, opts) returns a self-contained script string.
//   3. Write it to a .js file and run it via:
//        node scripts/affinity-driver.mjs run path/to/generated.js
//
// Op schema:
//   { kind: "poly",  points: [{x,y}, ...], fill: { type: "solid", color: [r,g,b,a] } }
//   { kind: "poly",  points: [...],        fill: { type: "grad", grad: {...} } }
//   { kind: "batch", polys: [ [{x,y}...], ... ], fill: { type: "solid", color: [...] } }
//   { kind: "text",  text, x, y, size, color: [r,g,b,a] }
//
// `batch` draws many disjoint polygons of one colour as MULTIPLE CURVES INSIDE
// ONE poly-curve node. This is the single most important performance trick:
// per-node `addNode` costs ~4 nodes/sec in a big document, while a multi-curve
// node with hundreds of subpaths costs the same as one node. Grouping window
// dots / fence pickets / ripples by fill colour cuts a 5,500-node scene to a
// few hundred ops that build in seconds.
//
// Gradient spec (linear):
//   { type: "linear", stops: [[position, [r,g,b,a]], ...], bbox: [x0,y0,x1,y1] }
//   Affinity applies a LINEAR gradient along the DIAGONAL of the fill's
//   transform box — i.e. the gradient runs from (x0,y0) to (x1,y1) in the
//   bbox's local space. Position stops 0..1 along that diagonal.
// Gradient spec (radial):
//   { type: "radial", stops: [...], cx, cy, rx, ry }
//
// IMPORTANT: if you generate a panel at local coordinates and later `shift` it
// (e.g. +1200 for a second artboard column), the gradient METADATA must be
// shifted too: bbox[0] and bbox[2] for linear, cx for radial. Shifting only
// the polygon points leaves gradients sampling the untouched transform box.

export function buildScript(ops, opts = {}) {
  const width = opts.width ?? 2400;
  const height = opts.height ?? 1200;
  const savePath = opts.savePath ?? "C:/Users/CHANGE-ME/Desktop/affinity-ops.afdesign";
  const exportPath = opts.exportPath ?? "C:/Users/CHANGE-ME/Desktop/affinity-ops.png";
  const closeOpen = opts.closeOpen ?? true;

  const RUNTIME = `
(function () {
  var D = require('/document');
  var Document = D.Document;
  var NewDocumentOptions = D.NewDocumentOptions;
  var FileExportOptions = D.FileExportOptions;
  var FileExportArea = D.FileExportArea;
  var UnitType = require('/units').UnitType;
  var NodeChildType = require('/commands').NodeChildType;
  var PolyCurveNodeDefinition = require('/nodes').PolyCurveNodeDefinition;
  var ArtTextNodeDefinition = require('/nodes').ArtTextNodeDefinition;
  var CurveBuilder = require('/geometry').CurveBuilder;
  var PolyCurve = require('/geometry').PolyCurve;
  var Transform = require('/geometry').Transform;
  var FillDescriptor = require('/fills').FillDescriptor;
  var GradientFill = require('/fills').GradientFill;
  var GradientFillType = require('/fills').GradientFillType;
  var LineStyleDescriptor = require('/linestyle').LineStyleDescriptor;
  var RGBA8 = require('/colours').RGBA8;
  var Gradient = require('/colours').Gradient;
  var StoryBuilder = require('/storybuilder').StoryBuilder;
  var StoryDelta = require('/storydelta').StoryDelta;
  var FontWeight = require('/fonts').FontWeight;
  var GlyphAttDoubleType = require('/glyphatts').GlyphAttDoubleType;
  var BlendMode = require('affinity:common').BlendMode;

  var SAVE_PATH = '__SAVE_PATH__';
  var EXPORT_PATH = '__EXPORT_PATH__';
  var DOC_W = __WIDTH__, DOC_H = __HEIGHT__;
  var CLOSE_OPEN = __CLOSE__;
  var report = { stages: [], errors: [] };
  function stage(name, fn) {
    var before = doc ? doc.layers.length : 0;
    try { fn(); report.stages.push(name + ':ok(+' + ((doc ? doc.layers.length : 0) - before) + ')'); }
    catch (e) { report.errors.push(name + ': ' + String((e && e.message) || e)); }
  }
  function col(c) { return RGBA8(c[0], c[1], c[2], c[3] == null ? 255 : c[3]); }

  function fillFor(spec) {
    if (!spec) return FillDescriptor.createNone();
    if (spec.type === 'solid') return FillDescriptor.createSolid(col(spec.color), BlendMode.Normal);
    if (spec.type === 'grad') {
      var g = spec.grad;
      var grad = Gradient.create(g.stops.map(function (s) { return { colour: col(s[1]), position: s[0] }; }));
      var t = g.type === 'radial' ? GradientFillType.Radial : GradientFillType.Linear;
      var gf = GradientFill.create(grad, t);
      var xf = null;
      if (g.type === 'linear') {
        var bb = g.bbox;
        xf = Transform.createTranslate(bb[0], bb[1]).postmultiplyBy(Transform.createScale(bb[2] - bb[0], bb[3] - bb[1]));
      } else {
        xf = Transform.createTranslate(g.cx, g.cy).postmultiplyBy(Transform.createScale(g.rx, g.ry));
      }
      return FillDescriptor.create(gf, false, xf, BlendMode.Normal, false);
    }
    return FillDescriptor.createNone();
  }

  function curveFromPts(pts) {
    if (!pts || pts.length < 3) return null;
    var cb = new CurveBuilder();
    cb.beginXY(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) cb.lineToXY(pts[i].x, pts[i].y);
    cb.close();
    var poly = PolyCurve.create();
    poly.addCurve(cb.createCurve());
    return poly;
  }
  function multiFromPolys(list) {
    var poly = PolyCurve.create();
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || list[i].length < 3) continue;
      var cb = new CurveBuilder();
      cb.beginXY(list[i][0].x, list[i][0].y);
      for (var j = 1; j < list[i].length; j++) cb.lineToXY(list[i][j].x, list[i][j].y);
      cb.close();
      poly.addCurve(cb.createCurve());
      n++;
    }
    return n ? poly : null;
  }

  function addNodeFromPoly(poly, fill) {
    if (!poly) return null;
    var brush = fillFor(fill);
    var pen = FillDescriptor.createNone();
    var line = LineStyleDescriptor.createDefault(0);
    var def = PolyCurveNodeDefinition.create(poly, brush, pen, line, FillDescriptor.createNone());
    doc.addNode(def, doc.spreads.first, NodeChildType.Main);
    return doc.layers.at(doc.layers.length - 1);
  }

  function addPoly(pts, fill) { return addNodeFromPoly(curveFromPts(pts), fill); }
  function addBatch(polys, fill) { return addNodeFromPoly(multiFromPolys(polys), fill); }

  function addText(t) {
    var sb = StoryBuilder.create();
    sb.setToFrameTextDefaultStyle(doc.dpi, doc.rasterFormat);
    sb.applyGlyphDelta(StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, t.size));
    try { sb.applyGlyphDelta(StoryDelta.createWeight(FontWeight.Bold)); } catch (e) {}
    try { sb.applyGlyphDelta(StoryDelta.createBrushFill(FillDescriptor.createSolid(col(t.color), BlendMode.Normal))); } catch (e) {}
    sb.addText(t.text);
    var def = ArtTextNodeDefinition.createFromStoryBuilder({ x: t.x, y: t.y }, sb);
    doc.addNode(def, doc.spreads.first, NodeChildType.Main);
    return doc.layers.at(doc.layers.length - 1);
  }

  var doc = null;
  stage('doc', function () {
    if (CLOSE_OPEN) {
      var open = [];
      for (var d of Document.all) open.push(d);
      for (var d of open) { try { d.close(); } catch (e) {} }
    }
    var opts = NewDocumentOptions.createDefault();
    opts.units = UnitType.Pixel;
    opts.width = DOC_W;
    opts.height = DOC_H;
    opts.dpi = 300;
    opts.viewDpi = 72;
    doc = Document.createFromOptions(opts);
  });
  if (!doc) { console.log(JSON.stringify(report)); return; }

  var ops = __OPS__;
  stage('ops', function () {
    var counts = { poly: 0, batch: 0, text: 0, errors: 0 };
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      try {
        if (o.kind === 'poly') { addPoly(o.points, o.fill); counts.poly++; }
        else if (o.kind === 'batch') { addBatch(o.polys, o.fill); counts.batch++; }
        else if (o.kind === 'text') { addText(o); counts.text++; }
      } catch (e) {
        counts.errors++;
        if (report.errors.length < 20) report.errors.push('op ' + i + ': ' + String((e && e.message) || e));
      }
    }
    report.counts = counts;
  });

  stage('save', function () {
    try { doc.saveAs(SAVE_PATH); report.saved = true; } catch (e) { report.saved = false; report.errors.push('save: ' + e.message); }
    try {
      var opts2 = FileExportOptions.createWithPresetName('PNG');
      var recs = doc.export(EXPORT_PATH, opts2, FileExportArea.createForWholeDocument(), null);
      var ok = false;
      for (var r of recs.all) { if (r.isSuccess) ok = true; }
      report.exported = ok;
    } catch (e) { report.exported = false; report.errors.push('export: ' + e.message); }
  });
  console.log(JSON.stringify(report));
})();
`;

  return RUNTIME
    .replace("__OPS__", JSON.stringify(ops))
    .replace("__SAVE_PATH__", savePath)
    .replace("__EXPORT_PATH__", exportPath)
    .replace("__WIDTH__", String(width))
    .replace("__HEIGHT__", String(height))
    .replace("__CLOSE__", closeOpen ? "true" : "false");
}
