/**
 * JavaScript generators executed inside Affinity's scripting engine via the
 * `execute_script` MCP tool. Output is collected through console.log (JSON per line).
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHexColour(input: string | undefined, fallback: Rgba): Rgba {
  if (!input) return fallback;
  return tryParseHexColour(input) ?? fallback;
}

export function tryParseHexColour(input: string): Rgba | null {
  let hex = input.trim().replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return { r, g, b, a };
}

const COLOUR_INIT = `const { RGBA8 } = require('/colours');`;

function rgbaExpr(c: Rgba): string {
  return `RGBA8(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

const NOT_CONNECTED_DOC = `
(function () {
  const { Document } = require('/document');
  const doc = Document.current;
  if (!doc) {
    console.log(JSON.stringify({ ok: false, error: 'no open document' }));
    return;
  }`;

export function openFileScript(path: string): string {
  const p = JSON.stringify(path);
  return `(function () {
  const { Document } = require('/document');
  try {
    const doc = Document.load(${p});
    console.log(JSON.stringify({ opened: true, path: ${p}, title: doc ? doc.title : null }));
  } catch (e) {
    console.log(JSON.stringify({ opened: false, path: ${p}, error: String((e && e.message) || e) }));
  }
})();`;
}

export function createNewScript(width: number, height: number): string {
  return `(function () {
  const { Document, NewDocumentOptions } = require('/document');
  const { UnitType } = require('/units');
  try {
    const opts = NewDocumentOptions.createDefault();
    opts.units = UnitType.Pixel;
    opts.width = ${Math.round(width)};
    opts.height = ${Math.round(height)};
    opts.dpi = 300;
    opts.viewDpi = 72;
    const doc = Document.createFromOptions(opts);
    console.log(JSON.stringify({
      created: true,
      title: doc.title,
      width_px: doc.widthPixels,
      height_px: doc.heightPixels,
    }));
  } catch (e) {
    console.log(JSON.stringify({ created: false, error: String((e && e.message) || e) }));
  }
})();`;
}

// Preset names must match Affinity's export presets exactly. The plain names
// "PDF"/"SVG"/"JPEG"/"TIFF" do not exist in Affinity and made those exports
// fail with a bare error record.
const EXPORT_PRESETS: Record<string, string> = {
  pdf: "PDF (for print)",
  png: "PNG",
  jpg: "JPEG (Best quality)",
  jpeg: "JPEG (Best quality)",
  tiff: "TIFF RGB 8-bit",
  svg: "SVG (for export)",
  eps: "EPS (for export)",
};

export function exportPreset(format: string): string | null {
  return EXPORT_PRESETS[format.trim().toLowerCase()] ?? null;
}

export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

export function anchorToDesktop(desktopPath: string, target: string): string {
  if (isAbsolutePath(target)) return target;
  return `${desktopPath.replace(/[\\/]+$/, "")}/${target}`.replace(/\\/g, "/");
}

export function exportScript(path: string, format: string): string {
  const preset = exportPreset(format) ?? "PNG";
  const p = JSON.stringify(path);
  return `(function () {
  const { Document, FileExportOptions, FileExportArea } = require('/document');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ exported: false, error: 'no open document' }));
      return;
    }
    const target = ${p};
    const opts = FileExportOptions.createWithPresetName(${JSON.stringify(preset)});
    const records = doc.export(target, opts, FileExportArea.createForWholeDocument(), null);
    const results = [];
    for (const r of records.all) {
      results.push({
        path: r.path,
        ok: r.isSuccess,
        warnings: r.hasWarnings ? r.warningMessage : undefined,
        error: r.isSuccess ? undefined : r.errorMessage,
      });
    }
    console.log(JSON.stringify({ exported: results.some(function (r) { return r.ok; }), results: results }));
  } catch (e) {
    console.log(JSON.stringify({ exported: false, path: ${p}, error: String((e && e.message) || e) }));
  }
})();`;
}

export function exportOutlinedScript(path: string, format: string): string {
  const preset = exportPreset(format) ?? "SVG (for export)";
  const p = JSON.stringify(path);
  return `(function () {
  const { Document, FileExportOptions, FileExportArea } = require('/document');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ exported: false, error: 'no open document' }));
      return;
    }
    const nodes = [];
    for (const n of doc.layers) nodes.push(n);
    const texts = nodes.filter(function (n) { return n.isArtTextNode; });
    for (const t of texts) {
      doc.convertToCurves(t.selfSelection);
    }
    let exported = false;
    const results = [];
    try {
      const target = ${p};
      const opts = FileExportOptions.createWithPresetName(${JSON.stringify(preset)});
      const records = doc.export(target, opts, FileExportArea.createForWholeDocument(), null);
      for (const r of records.all) {
        results.push({
          path: r.path,
          ok: r.isSuccess,
          error: r.isSuccess ? undefined : r.errorMessage,
        });
      }
      exported = results.some(function (r) { return r.ok; });
    } finally {
      for (let i = 0; i < texts.length; i++) doc.undo();
    }
    console.log(JSON.stringify({ exported: exported, outlined_text_nodes: texts.length, results: results }));
  } catch (e) {
    console.log(JSON.stringify({ exported: false, path: ${p}, error: String((e && e.message) || e) }));
  }
})();`;
}

interface FilterSpec {
  params: string;
  definition: string;
  radiusField: string;
  extraInit?: string;
  needsDoc?: boolean;
}

const FILTERS: Record<string, FilterSpec> = {
  blur: { params: "GaussianBlurFilterParameters", definition: "GaussianBlurFilterRasterNodeDefinition", radiusField: "radius" },
  gaussian: { params: "GaussianBlurFilterParameters", definition: "GaussianBlurFilterRasterNodeDefinition", radiusField: "radius" },
  gaussianblur: { params: "GaussianBlurFilterParameters", definition: "GaussianBlurFilterRasterNodeDefinition", radiusField: "radius" },
  median: { params: "MedianBlurFilterParameters", definition: "MedianBlurFilterRasterNodeDefinition", radiusField: "radius" },
  box: { params: "BoxBlurFilterParameters", definition: "BoxBlurFilterRasterNodeDefinition", radiusField: "radius" },
  lens: { params: "LensBlurFilterParameters", definition: "LensBlurFilterRasterNodeDefinition", radiusField: "radius" },
  maximum: { params: "MaximumBlurFilterParameters", definition: "MaximumBlurFilterRasterNodeDefinition", radiusField: "radius" },
  minimum: { params: "MinimumBlurFilterParameters", definition: "MinimumBlurFilterRasterNodeDefinition", radiusField: "radius" },
  bilateral: {
    params: "BilateralBlurFilterParameters",
    definition: "BilateralBlurFilterRasterNodeDefinition",
    radiusField: "radius",
  },
  motion: {
    params: "MotionBlurFilterParameters",
    definition: "MotionBlurFilterRasterNodeDefinition",
    radiusField: "radius",
    extraInit: "params.angle = 0;",
  },
  radial: {
    params: "RadialBlurFilterParameters",
    definition: "RadialBlurFilterRasterNodeDefinition",
    radiusField: "angle",
  },
  field: {
    params: "FieldBlurFilterParameters",
    definition: "FieldBlurFilterRasterNodeDefinition",
    radiusField: "globalRadius",
    needsDoc: true,
  },
};

export function supportedFilters(): string[] {
  return Object.keys(FILTERS);
}

export function filterSpec(name: string): FilterSpec | null {
  return FILTERS[name.trim().toLowerCase()] ?? null;
}

export function filterScript(name: string, intensity: number): string | null {
  const spec = filterSpec(name);
  if (!spec) return null;
  const radius = Math.max(0, Math.min(1024, intensity));
  const createDefault = spec.needsDoc ? "createDefault(doc)" : "createDefault()";
  return `(function () {
  const { Document } = require('/document');
  const { NodeChildType, ${spec.definition} } = require('/nodes');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ applied: false, filter: ${JSON.stringify(name)}, error: 'no open document' }));
      return;
    }
    const params = new ${spec.params}();
    params.${spec.radiusField} = ${radius};
    ${spec.extraInit ?? ""}
    const def = ${spec.definition}.${createDefault};
    def.parameters = params;
    doc.addNode(def, doc.spreads.first, NodeChildType.Main);
    console.log(JSON.stringify({ applied: true, filter: ${JSON.stringify(name)}, value: ${radius} }));
  } catch (e) {
    console.log(JSON.stringify({ applied: false, filter: ${JSON.stringify(name)}, error: String((e && e.message) || e) }));
  }
})();`;
}

export function getActiveDocumentScript(): string {
  return `(function () {
  const { Document } = require('/document');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ is_open: false, open_document_count: Document.all.length }));
      return;
    }
    console.log(JSON.stringify({
      is_open: true,
      name: doc.title,
      path: doc.path,
      dpi: doc.dpi,
      width_px: doc.widthPixels,
      height_px: doc.heightPixels,
      open_document_count: Document.all.length,
    }));
  } catch (e) {
    console.log(JSON.stringify({ is_open: false, error: String((e && e.message) || e) }));
  }
})();`;
}

export function closeDocumentScript(): string {
  return `(function () {
  const { Document } = require('/document');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ closed: false, error: 'no open document' }));
      return;
    }
    doc.close();
    console.log(JSON.stringify({ closed: true }));
  } catch (e) {
    console.log(JSON.stringify({ closed: false, error: String((e && e.message) || e) }));
  }
})();`;
}

export function batchOpenScript(paths: string[]): string {
  const list = JSON.stringify(paths);
  return `(function () {
  const { Document } = require('/document');
  const paths = ${list};
  const results = [];
  let ok = 0;
  let failed = 0;
  for (const p of paths) {
    try {
      const doc = Document.load(p);
      ok += 1;
      results.push({ path: p, opened: true, title: doc ? doc.title : null });
    } catch (e) {
      failed += 1;
      results.push({ path: p, opened: false, error: String((e && e.message) || e) });
    }
  }
  console.log(JSON.stringify({ success_count: ok, failure_count: failed, results: results }));
})();`;
}

export interface ExportEntry {
  path: string;
  format: string;
}

export function batchExportScript(entries: ExportEntry[]): string {
  const prepared = entries.map((entry) => ({
    path: entry.path,
    preset: exportPreset(entry.format) ?? "PNG",
  }));
  return `(function () {
  const { Document, FileExportOptions, FileExportArea } = require('/document');
  const entries = ${JSON.stringify(prepared)};
  const results = [];
  let ok = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      const doc = Document.current;
      if (!doc) {
        failed += 1;
        results.push({ path: entry.path, exported: false, error: 'no open document' });
        continue;
      }
      const target = entry.path;
      const opts = FileExportOptions.createWithPresetName(entry.preset);
      const records = doc.export(target, opts, FileExportArea.createForWholeDocument(), null);
      const record = records.all.length > 0 ? records.all[records.all.length - 1] : null;
      const success = !!record && record.isSuccess;
      if (success) ok += 1;
      else failed += 1;
      results.push({
        path: target,
        exported: success,
        warnings: record && record.hasWarnings ? record.warningMessage : undefined,
        error: success ? undefined : (record ? record.errorMessage : 'no export record'),
      });
    } catch (e) {
      failed += 1;
      results.push({ path: entry.path, exported: false, error: String((e && e.message) || e) });
    }
  }
  console.log(JSON.stringify({ success_count: ok, failure_count: failed, results: results }));
})();`;
}

export interface DrawShapeParams {
  shapeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colour: Rgba;
  strokeColour: Rgba;
  strokeWidth: number;
}

export function drawShapeScript(params: DrawShapeParams): string | null {
  const type = params.shapeType.trim().toLowerCase();
  if (type === "line") {
    return lineScript(params);
  }
  const shapeName = type === "circle" || type === "ellipse" ? "Ellipse" : "Rectangle";
  const width = type === "circle" ? Math.min(params.width, params.height) : params.width;
  const height = type === "circle" ? Math.min(params.width, params.height) : params.height;
  return `(function () {
  const { Document } = require('/document');
  const { ShapeNodeDefinition, NodeChildType } = require('/nodes');
  const { Shape, ShapeType } = require('/shapes');
  const { Rectangle } = require('/geometry');
  const { LineStyleDescriptor } = require('/linestyle');
  ${COLOUR_INIT}
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ drawn: false, error: 'no open document' }));
      return;
    }
    const shape = Shape.create(ShapeType.${shapeName});
    const rect = new Rectangle(${params.x}, ${params.y}, ${width}, ${height});
    const line = LineStyleDescriptor.createDefault(${params.strokeWidth});
    const def = ShapeNodeDefinition.create(shape, rect, ${rgbaExpr(params.colour)}, ${rgbaExpr(params.strokeColour)}, line);
    doc.addNode(def, doc.spreads.first, NodeChildType.Main);
    console.log(JSON.stringify({ drawn: true, shape_type: ${JSON.stringify(type)}, width: ${width}, height: ${height} }));
  } catch (e) {
    console.log(JSON.stringify({ drawn: false, shape_type: ${JSON.stringify(type)}, error: String((e && e.message) || e) }));
  }
})();`;
}

function lineScript(params: DrawShapeParams): string {
  const x2 = params.x + params.width;
  const y2 = params.y + params.height;
  return `(function () {
  const { Document } = require('/document');
  const { PolyCurveNodeDefinition, NodeChildType } = require('/nodes');
  const { Curve, PolyCurve } = require('/geometry');
  const { FillDescriptor } = require('/fills');
  const { LineStyleDescriptor } = require('/linestyle');
  ${COLOUR_INIT}
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ drawn: false, error: 'no open document' }));
      return;
    }
    const poly = new PolyCurve();
    poly.addCurve(Curve.createLineXY(${params.x}, ${params.y}, ${x2}, ${y2}));
    const line = LineStyleDescriptor.createDefault(${params.strokeWidth});
    const def = PolyCurveNodeDefinition.create(poly, FillDescriptor.createNone(), ${rgbaExpr(params.strokeColour)}, line, FillDescriptor.createNone());
    doc.addNode(def, doc.spreads.first, NodeChildType.Main);
    console.log(JSON.stringify({ drawn: true, shape_type: 'line' }));
  } catch (e) {
    console.log(JSON.stringify({ drawn: false, shape_type: 'line', error: String((e && e.message) || e) }));
  }
})();`;
}

export interface AddTextParams {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  colour: Rgba | null;
  fontFamily: string | null;
  styleName: string | null;
  characterSpacing: number | null;
  spreadIndex: number;
}

export function addTextScript(params: AddTextParams): string {
  const colourExpr = params.colour ? rgbaExpr(params.colour) : null;
  const fontBlock = params.fontFamily
    ? `
    const familyName = ${JSON.stringify(params.fontFamily)};
    const family = FontFamily.all.find(function (f) { return f.name.toLowerCase() === familyName.toLowerCase(); });
    if (family) {
      const fonts = family.fonts;
      const want = ${JSON.stringify(params.styleName ?? "")}.toLowerCase();
      let pick = null;
      if (want) {
        pick = fonts.find(function (ft) { return String(ft.traitsName || "").toLowerCase() === want; }) || null;
        if (!pick) {
          const bold = want.indexOf("bold") >= 0;
          const italic = want.indexOf("italic") >= 0 || want.indexOf("oblique") >= 0;
          pick = fonts.find(function (ft) {
            return (bold ? ft.isBold : !ft.isBold) && (italic ? ft.isItalic : !ft.isItalic);
          }) || null;
        }
      }
      if (!pick) pick = fonts.find(function (ft) { return ft.isNormal && !ft.isBold && !ft.isItalic; }) || fonts[0];
      if (pick) {
        ga.font = pick;
        fontStatus = "applied";
        fontName = pick.postscriptName || pick.familyName || familyName;
      } else {
        fontStatus = "no-style";
      }
    } else {
      fontStatus = "missing";
    }`
    : "";
  return `(function () {
  const { Document } = require('/document');
  const { StoryBuilder } = require('/storybuilder');
  const { GlyphAttDoubleType } = require('/glyphatts');
  const { FontFamily } = require('/fonts');
  const { FillDescriptor } = require('/fills');
  const { RGBA8 } = require('/colours');
  const { ArtTextNodeDefinition, NodeChildType } = require('/nodes');
  const { DocumentCommand } = require('/commands');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ added: false, error: 'no open document' }));
      return;
    }
    const spreads = [];
    for (const s of doc.spreads) spreads.push(s);
    const target = spreads[${Math.max(0, Math.round(params.spreadIndex))}] || spreads[0] || null;
    if (!target) {
      console.log(JSON.stringify({ added: false, error: 'document has no spreads' }));
      return;
    }
    const currentSpread = doc.currentSpread;
    if (!currentSpread || !currentSpread.isSameNode(target)) {
      doc.executeCommand(DocumentCommand.createSetCurrentSpread(target));
    }
    const pxPerPt = doc.dpi / 72;
    const sb = StoryBuilder.create();
    const ga = sb.glyphAtts.clone();
    ga.setDoubleValue(GlyphAttDoubleType.Height, ${params.fontSize} * pxPerPt);
    ${colourExpr ? `ga.brushFill = FillDescriptor.createSolid(${colourExpr});` : ""}
    ${
      params.characterSpacing != null
        ? `ga.setDoubleValue(GlyphAttDoubleType.CharacterSpacing, ${params.characterSpacing} * pxPerPt);`
        : ""
    }
    let fontStatus = null;
    let fontName = null;${fontBlock}
    sb.setGlyphAtts(ga);
    sb.addText(${JSON.stringify(params.text)});
    const def = ArtTextNodeDefinition.createFromStoryBuilder({ x: ${params.x}, y: ${params.y} }, sb);
    doc.addNode(def, target, NodeChildType.Main);
    console.log(JSON.stringify({
      added: true,
      text: ${JSON.stringify(params.text)},
      font_size_pt: ${params.fontSize},
      font_status: fontStatus,
      font: fontName,
      colour_applied: ${colourExpr ? "true" : "false"},
      spread_index: ${Math.max(0, Math.round(params.spreadIndex))},
    }));
  } catch (e) {
    console.log(JSON.stringify({ added: false, error: String((e && e.message) || e) }));
  }
})();`;
}

export interface ChangeColourParams {
  colour: Rgba;
  fillSelection: boolean;
}

export function changeColourScript(params: ChangeColourParams): string {
  return `(function () {
  const { Document } = require('/document');
  ${COLOUR_INIT}
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ changed: false, error: 'no open document' }));
      return;
    }
    const sel = doc.selection;
    const hasSelection = !!(sel && sel.nodes && sel.nodes.length);
    if (!hasSelection && ${!params.fillSelection}) {
      console.log(JSON.stringify({ changed: false, error: 'nothing selected; select an object first or set fill_selection true' }));
      return;
    }
    const target = hasSelection ? sel : doc.layers.first;
    doc.setBrushFillDescriptor(${rgbaExpr(params.colour)}, target, null, false);
    console.log(JSON.stringify({ changed: true, colour: ${JSON.stringify(
      `rgba(${params.colour.r}, ${params.colour.g}, ${params.colour.b}, ${params.colour.a})`,
    )} }));
  } catch (e) {
    console.log(JSON.stringify({ changed: false, error: String((e && e.message) || e) }));
  }
})();`;
}

// ---------------------------------------------------------------------------
// SVG path data -> Affinity vector nodes (affinity.draw_path)
// Parsing happens here in Node (unit-testable); the generated script only emits
// CurveBuilder calls with literal coordinates.
// ---------------------------------------------------------------------------

export interface PathSegmentLine {
  kind: "line";
  to: [number, number];
}

export interface PathSegmentCubic {
  kind: "cubic";
  c1: [number, number];
  c2: [number, number];
  to: [number, number];
}

export type PathSegment = PathSegmentLine | PathSegmentCubic;

export interface PathSubpath {
  start: [number, number];
  segments: PathSegment[];
  closed: boolean;
}

const SVG_PATH_COMMANDS = "MmLlHhVvCcSsQqTtAaZz";

function vecAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  let ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
  if (ux * vy - uy * vx < 0) ang = -ang;
  return ang;
}

/**
 * Convert an SVG endpoint-parameterised elliptical arc to cubic bezier
 * segments (SVG 1.1 spec, appendix F.6.5). Returns cubic segments only.
 */
export function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathSegmentCubic[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    return [{ kind: "cubic", c1: [x1, y1], c2: [x2, y2], to: [x2, y2] }];
  }
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  const den = rx2 * y1p2 + ry2 * x1p2;
  const sign = largeArc !== sweep ? 1 : -1;
  const co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den));
  const cxp = co * ((rx * y1p) / ry);
  const cyp = co * (-(ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;

  const point = (t: number): [number, number] => [
    cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
    cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
  ];
  const deriv = (t: number): [number, number] => [
    -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
    -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi,
  ];

  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / count;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const segments: PathSegmentCubic[] = [];
  for (let i = 0; i < count; i++) {
    const t1 = theta1 + i * step;
    const t2 = t1 + step;
    const p1 = point(t1);
    const p2 = point(t2);
    const d1 = deriv(t1);
    const d2 = deriv(t2);
    segments.push({
      kind: "cubic",
      c1: [p1[0] + alpha * d1[0], p1[1] + alpha * d1[1]],
      c2: [p2[0] - alpha * d2[0], p2[1] - alpha * d2[1]],
      to: p2,
    });
  }
  return segments;
}

/** Parse SVG path data (M L H V C S Q T A Z, absolute and relative) into subpaths. */
export function parseSvgPath(d: string): PathSubpath[] {
  let i = 0;
  const skipSep = (): void => {
    while (i < d.length && (d[i] === " " || d[i] === "," || d[i] === "\t" || d[i] === "\n" || d[i] === "\r")) i++;
  };
  const readNumber = (): number => {
    skipSep();
    const start = i;
    if (d[i] === "+" || d[i] === "-") i++;
    let digits = false;
    while (i < d.length && d[i] >= "0" && d[i] <= "9") {
      i++;
      digits = true;
    }
    if (d[i] === ".") {
      i++;
      while (i < d.length && d[i] >= "0" && d[i] <= "9") {
        i++;
        digits = true;
      }
    }
    if (!digits) throw new Error(`invalid number at position ${start}`);
    if (d[i] === "e" || d[i] === "E") {
      const expStart = i;
      i++;
      if (d[i] === "+" || d[i] === "-") i++;
      let expDigits = false;
      while (i < d.length && d[i] >= "0" && d[i] <= "9") {
        i++;
        expDigits = true;
      }
      if (!expDigits) throw new Error(`invalid exponent at position ${expStart}`);
    }
    return parseFloat(d.slice(start, i));
  };
  const readFlag = (): boolean => {
    skipSep();
    const c = d[i];
    if (c === "0") {
      i++;
      return false;
    }
    if (c === "1") {
      i++;
      return true;
    }
    throw new Error(`invalid arc flag at position ${i}`);
  };
  const readCommand = (): string | null => {
    skipSep();
    const c = d[i];
    if (c && SVG_PATH_COMMANDS.includes(c)) {
      i++;
      return c;
    }
    return null;
  };

  const subpaths: PathSubpath[] = [];
  let current: PathSubpath | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevKind: string | null = null;
  let prevCubicCtrl: [number, number] | null = null;
  let prevQuadCtrl: [number, number] | null = null;
  let command: string | null = null;

  const finalize = (): void => {
    if (current && current.segments.length > 0) subpaths.push(current);
    current = null;
  };
  const ensureSubpath = (): PathSubpath => {
    if (!current) current = { start: [cx, cy], segments: [], closed: false };
    return current;
  };

  while (i < d.length || command !== null) {
    const cmd = readCommand();
    if (cmd) {
      command = cmd;
    } else if (command === null) {
      break;
    } else {
      skipSep();
      if (i >= d.length) break;
    }
    const active: string = command as string;
    const rel: boolean = active === active.toLowerCase();
    const kind = active.toUpperCase();

    switch (kind) {
      case "M": {
        const x = readNumber();
        const y = readNumber();
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        finalize();
        cx = nx;
        cy = ny;
        sx = nx;
        sy = ny;
        current = { start: [nx, ny], segments: [], closed: false };
        command = rel ? "l" : "L";
        break;
      }
      case "L": {
        const x = readNumber();
        const y = readNumber();
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        ensureSubpath().segments.push({ kind: "line", to: [nx, ny] });
        cx = nx;
        cy = ny;
        break;
      }
      case "H": {
        const x = readNumber();
        const nx = rel ? cx + x : x;
        ensureSubpath().segments.push({ kind: "line", to: [nx, cy] });
        cx = nx;
        break;
      }
      case "V": {
        const y = readNumber();
        const ny = rel ? cy + y : y;
        ensureSubpath().segments.push({ kind: "line", to: [cx, ny] });
        cy = ny;
        break;
      }
      case "C": {
        const c1x = readNumber();
        const c1y = readNumber();
        const c2x = readNumber();
        const c2y = readNumber();
        const x = readNumber();
        const y = readNumber();
        const pc1: [number, number] = [rel ? cx + c1x : c1x, rel ? cy + c1y : c1y];
        const pc2: [number, number] = [rel ? cx + c2x : c2x, rel ? cy + c2y : c2y];
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        ensureSubpath().segments.push({ kind: "cubic", c1: pc1, c2: pc2, to: [nx, ny] });
        prevCubicCtrl = pc2;
        cx = nx;
        cy = ny;
        break;
      }
      case "S": {
        const c2x = readNumber();
        const c2y = readNumber();
        const x = readNumber();
        const y = readNumber();
        const c1: [number, number] =
          prevCubicCtrl && (prevKind === "C" || prevKind === "S")
            ? [2 * cx - prevCubicCtrl[0], 2 * cy - prevCubicCtrl[1]]
            : [cx, cy];
        const pc2: [number, number] = [rel ? cx + c2x : c2x, rel ? cy + c2y : c2y];
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        ensureSubpath().segments.push({ kind: "cubic", c1, c2: pc2, to: [nx, ny] });
        prevCubicCtrl = pc2;
        cx = nx;
        cy = ny;
        break;
      }
      case "Q": {
        const qx = readNumber();
        const qy = readNumber();
        const x = readNumber();
        const y = readNumber();
        const q: [number, number] = [rel ? cx + qx : qx, rel ? cy + qy : qy];
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        ensureSubpath().segments.push({
          kind: "cubic",
          c1: [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)],
          c2: [nx + (2 / 3) * (q[0] - nx), ny + (2 / 3) * (q[1] - ny)],
          to: [nx, ny],
        });
        prevQuadCtrl = q;
        cx = nx;
        cy = ny;
        break;
      }
      case "T": {
        const x = readNumber();
        const y = readNumber();
        const q: [number, number] =
          prevQuadCtrl && (prevKind === "Q" || prevKind === "T")
            ? [2 * cx - prevQuadCtrl[0], 2 * cy - prevQuadCtrl[1]]
            : [cx, cy];
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        ensureSubpath().segments.push({
          kind: "cubic",
          c1: [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)],
          c2: [nx + (2 / 3) * (q[0] - nx), ny + (2 / 3) * (q[1] - ny)],
          to: [nx, ny],
        });
        prevQuadCtrl = q;
        cx = nx;
        cy = ny;
        break;
      }
      case "A": {
        const rx = readNumber();
        const ry = readNumber();
        const rot = readNumber();
        const large = readFlag();
        const sweep = readFlag();
        const x = readNumber();
        const y = readNumber();
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        const segments = arcToCubics(cx, cy, rx, ry, rot, large, sweep, nx, ny);
        const sub = ensureSubpath();
        for (const seg of segments) sub.segments.push(seg);
        cx = nx;
        cy = ny;
        break;
      }
      case "Z": {
        if (current) {
          current.closed = true;
          finalize();
        }
        cx = sx;
        cy = sy;
        break;
      }
      default:
        throw new Error(`unsupported path command: ${command}`);
    }
    prevKind = kind;
  }
  finalize();
  return subpaths;
}

export interface DrawPathParams {
  pathData: string;
  fill: Rgba | null;
  stroke: Rgba | null;
  strokeWidth: number;
  strokeCap: string;
  strokeJoin: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  spreadIndex: number;
  name: string | null;
}

const LINE_CAPS: Record<string, string> = { round: "Round", butt: "Butt", square: "Square" };
const LINE_JOINS: Record<string, string> = { round: "Round", miter: "Miter", bevel: "Bevel" };

function fmtCoord(n: number): string {
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

export function drawPathScript(params: DrawPathParams): string | null {
  let subpaths: PathSubpath[];
  try {
    subpaths = parseSvgPath(params.pathData);
  } catch {
    return null;
  }
  if (subpaths.length === 0) return null;
  const cap = LINE_CAPS[params.strokeCap.trim().toLowerCase()] ?? "Round";
  const join = LINE_JOINS[params.strokeJoin.trim().toLowerCase()] ?? "Round";
  const ox = params.offsetX;
  const oy = params.offsetY;
  const s = params.scale;
  const tx = (v: number) => fmtCoord(v * s + ox);
  const ty = (v: number) => fmtCoord(v * s + oy);
  const build: string[] = ["    const poly = PolyCurve.create();"];
  subpaths.forEach((sp, idx) => {
    build.push(`    const b${idx} = CurveBuilder.create();`);
    build.push(`    b${idx}.beginXY(${tx(sp.start[0])}, ${ty(sp.start[1])});`);
    for (const seg of sp.segments) {
      if (seg.kind === "line") {
        build.push(`    b${idx}.lineToXY(${tx(seg.to[0])}, ${ty(seg.to[1])});`);
      } else {
        build.push(
          `    b${idx}.addBezierXY(${tx(seg.c1[0])}, ${ty(seg.c1[1])}, ` +
            `${tx(seg.c2[0])}, ${ty(seg.c2[1])}, ` +
            `${tx(seg.to[0])}, ${ty(seg.to[1])});`,
        );
      }
    }
    if (sp.closed) build.push(`    b${idx}.close();`);
    build.push(`    poly.addCurve(b${idx}.createCurve());`);
  });
  const brush = params.fill ? `FillDescriptor.createSolid(${rgbaExpr(params.fill)})` : "FillDescriptor.createNone()";
  const lineFill = params.stroke ? `FillDescriptor.createSolid(${rgbaExpr(params.stroke)})` : "FillDescriptor.createNone()";
  const nameLine = params.name ? `    def.userDescription = ${JSON.stringify(params.name)};\n` : "";
  return `(function () {
  const { Document } = require('/document');
  const { PolyCurveNodeDefinition, NodeChildType } = require('/nodes');
  const { PolyCurve, CurveBuilder } = require('/geometry');
  const { FillDescriptor } = require('/fills');
  const { RGBA8 } = require('/colours');
  const { LineStyle, LineStyleDescriptor, LineCap, LineJoin } = require('/linestyle');
  const { DocumentCommand } = require('/commands');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ drawn: false, error: 'no open document' }));
      return;
    }
    const spreads = [];
    for (const s of doc.spreads) spreads.push(s);
    const target = spreads[${Math.max(0, Math.round(params.spreadIndex))}] || spreads[0] || null;
    if (!target) {
      console.log(JSON.stringify({ drawn: false, error: 'document has no spreads' }));
      return;
    }
    const currentSpread = doc.currentSpread;
    if (!currentSpread || !currentSpread.isSameNode(target)) {
      doc.executeCommand(DocumentCommand.createSetCurrentSpread(target));
    }
${build.join("\n")}
    const brushFill = ${brush};
    const lineFill = ${lineFill};
    const lineStyle = LineStyleDescriptor.create(LineStyle.create({ cap: LineCap.${cap}, join: LineJoin.${join}, weight: ${fmtCoord(params.strokeWidth)} }));
    const def = PolyCurveNodeDefinition.create(poly, brushFill, lineFill, lineStyle, FillDescriptor.createNone());
${nameLine}    doc.addNode(def, target, NodeChildType.Main);
    console.log(JSON.stringify({ drawn: true, subpaths: ${subpaths.length}, filled: ${params.fill ? "true" : "false"}, stroked: ${params.stroke ? "true" : "false"}, name: ${JSON.stringify(params.name)} }));
  } catch (e) {
    console.log(JSON.stringify({ drawn: false, error: String((e && e.message) || e) }));
  }
})();`;
}

// ---------------------------------------------------------------------------
// Multi-size PNG export (affinity.export_sizes)
// ---------------------------------------------------------------------------

export interface SizeExportEntry {
  path: string;
  size: number;
  preset: string;
}

export function exportSizesScript(entries: SizeExportEntry[]): string {
  return `(function () {
  const { Document, FileExportOptions, FileExportArea } = require('/document');
  const entries = ${JSON.stringify(entries)};
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ exported: false, error: 'no open document' }));
      return;
    }
    const results = [];
    for (const entry of entries) {
      try {
        const opts = FileExportOptions.createWithPresetName(entry.preset);
        const records = doc.export(entry.path, opts, FileExportArea.createForWholeDocument(), { width: entry.size, height: entry.size });
        const record = records.all.length > 0 ? records.all[records.all.length - 1] : null;
        const success = !!record && record.isSuccess;
        results.push({
          path: entry.path,
          size: entry.size,
          exported: success,
          error: success ? undefined : (record ? record.errorMessage : 'no export record'),
        });
      } catch (e) {
        results.push({ path: entry.path, size: entry.size, exported: false, error: String((e && e.message) || e) });
      }
    }
    console.log(JSON.stringify({ exported: results.some(function (r) { return r.exported; }), results: results }));
  } catch (e) {
    console.log(JSON.stringify({ exported: false, error: String((e && e.message) || e) }));
  }
})();`;
}

// ---------------------------------------------------------------------------
// Save the open document (affinity.save_document)
// ---------------------------------------------------------------------------

export function saveDocumentScript(path: string): string {
  const p = JSON.stringify(path);
  return `(function () {
  const { Document } = require('/document');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ saved: false, error: 'no open document' }));
      return;
    }
    doc.saveAs(${p});
    console.log(JSON.stringify({ saved: true, path: ${p} }));
  } catch (e) {
    console.log(JSON.stringify({ saved: false, path: ${p}, error: String((e && e.message) || e) }));
  }
})();`;
}

export function pikachuSvg(width: number, height: number): string {
  const w = Math.max(100, Math.round(width));
  const h = Math.max(100, Math.round(height));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 800 800">
  <title>AffinityMCP mascot</title>
  <g transform="translate(400 430)">
    <path d="M -170 -160 L -235 -395 L -90 -235 Z" fill="#F7D02C" stroke="#3A2E00" stroke-width="10" stroke-linejoin="round"/>
    <path d="M -215 -360 L -150 -260 L -110 -290 Z" fill="#3A2E00"/>
    <path d="M 170 -160 L 235 -395 L 90 -235 Z" fill="#F7D02C" stroke="#3A2E00" stroke-width="10" stroke-linejoin="round"/>
    <path d="M 215 -360 L 150 -260 L 110 -290 Z" fill="#3A2E00"/>
    <ellipse cx="0" cy="0" rx="230" ry="205" fill="#F7D02C" stroke="#3A2E00" stroke-width="10"/>
    <circle cx="-95" cy="-60" r="34" fill="#2B2B2B"/>
    <circle cx="-83" cy="-72" r="12" fill="#FFFFFF"/>
    <circle cx="95" cy="-60" r="34" fill="#2B2B2B"/>
    <circle cx="107" cy="-72" r="12" fill="#FFFFFF"/>
    <circle cx="-140" cy="45" r="34" fill="#E23B2E" opacity="0.85"/>
    <circle cx="140" cy="45" r="34" fill="#E23B2E" opacity="0.85"/>
    <path d="M -14 10 q 14 -14 28 0" fill="none" stroke="#2B2B2B" stroke-width="9" stroke-linecap="round"/>
    <path d="M -14 10 q 0 26 -34 30" fill="none" stroke="#2B2B2B" stroke-width="9" stroke-linecap="round"/>
    <path d="M 14 10 q 0 26 34 30" fill="none" stroke="#2B2B2B" stroke-width="9" stroke-linecap="round"/>
  </g>
</svg>
`;
  return svg;
}
