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
  let hex = input.trim().replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return fallback;
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
    const def = PolyCurveNodeDefinition.create(poly, FillDescriptor.createNone(), line, ${rgbaExpr(params.strokeColour)}, FillDescriptor.createNone());
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
  colourProvided: boolean;
}

export function addTextScript(params: AddTextParams): string {
  return `(function () {
  const { Document } = require('/document');
  const { StoryBuilder } = require('/storybuilder');
  const { StoryDelta } = require('/storydelta');
  const { GlyphAttDoubleType } = require('/glyphatts');
  const { ArtTextNodeDefinition, NodeChildType } = require('/nodes');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ added: false, error: 'no open document' }));
      return;
    }
    const pxPerPt = doc.dpi / 72;
    const sb = StoryBuilder.create();
    sb.applyGlyphDelta(StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, ${params.fontSize} * pxPerPt));
    sb.addText(${JSON.stringify(params.text)});
    const def = ArtTextNodeDefinition.createFromStoryBuilder({ x: ${params.x}, y: ${params.y} }, sb);
    doc.addNode(def, doc.spreads.first, NodeChildType.Main);
    console.log(JSON.stringify({
      added: true,
      text: ${JSON.stringify(params.text)},
      font_size_pt: ${params.fontSize},
      colour_note: ${params.colourProvided ? JSON.stringify("text colour is not applied in v1; set it in Affinity or ask for it as a script") : "null"},
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
