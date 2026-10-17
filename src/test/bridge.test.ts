import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakeAffinity } from "./fake-affinity.js";
import { AffinityClient, extractText } from "../affinity/sse-client.js";
import { createServer } from "../server.js";
import {
  arcToCubics,
  addTextScript,
  anchorToDesktop,
  drawPathScript,
  exportOutlinedScript,
  exportPreset,
  exportScript,
  exportSizesScript,
  filterScript,
  isAbsolutePath,
  openFileScript,
  parseHexColour,
  parseSvgPath,
  saveDocumentScript,
  supportedFilters,
  tryParseHexColour,
  type DrawPathParams,
} from "../scripts/generators.js";

test("client handshakes with fake Affinity and executes a script", async (t) => {
  const fake = await startFakeAffinity();
  t.after(() => fake.close());
  const client = new AffinityClient({ baseUrl: fake.url, connectTimeoutMs: 5000, callTimeoutMs: 5000 });
  t.after(() => client.close());
  const result = await client.executeScript("console.log('hello');");
  assert.match(extractText(result), /ran \d+ chars/);
  assert.ok(fake.calls.some((call) => call.name === "read_sdk_documentation_topic"));
  const call = fake.calls.find((c) => c.name === "execute_script");
  assert.ok(call);
  assert.ok(String(call?.args.script).includes("console.log('hello')"));
});

test("client adapts the execute_script argument name from the tool schema", async (t) => {
  const fake = await startFakeAffinity({ scriptArgName: "code" });
  t.after(() => fake.close());
  const client = new AffinityClient({ baseUrl: fake.url, connectTimeoutMs: 5000, callTimeoutMs: 5000 });
  t.after(() => client.close());
  await client.executeScript("console.log('adapted');");
  const call = fake.calls.find((c) => c.name === "execute_script");
  assert.ok(String(call?.args.code).includes("console.log('adapted')"));
});

test("client discovers the Desktop path through the SDK", async (t) => {
  const fake = await startFakeAffinity();
  t.after(() => fake.close());
  const client = new AffinityClient({ baseUrl: fake.url, connectTimeoutMs: 5000, callTimeoutMs: 5000 });
  t.after(() => client.close());
  const desktop = await client.getDesktopPath();
  assert.equal(desktop, "C:\\Users\\tester\\Desktop");
});

test("MCP server exposes affinity tools and runs one end to end", async (t) => {
  const fake = await startFakeAffinity();
  t.after(() => fake.close());
  const bridgeClient = new AffinityClient({ baseUrl: fake.url, connectTimeoutMs: 5000, callTimeoutMs: 5000 });
  const server = createServer(bridgeClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test-host", version: "1.0.0" });
  await mcp.connect(clientTransport);
  t.after(async () => {
    await mcp.close();
    await server.close();
    bridgeClient.close();
  });

  const tools = await mcp.listTools();
  const names = tools.tools.map((tool) => tool.name);
  for (const expected of [
    "affinity.open_file",
    "affinity.create_new",
    "affinity.export",
    "affinity.export_outlined",
    "affinity.apply_filter",
    "affinity.get_active_document",
    "affinity.close_document",
    "affinity.batch_open_files",
    "affinity.batch_export",
    "affinity.draw_pikachu",
    "affinity.draw_shape",
    "affinity.draw_path",
    "affinity.open_svg",
    "affinity.export_sizes",
    "affinity.save_document",
    "affinity.add_text",
    "affinity.change_color",
    "affinity.execute_script",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }

  const sized = await mcp.callTool({
    name: "affinity.export_sizes",
    arguments: { sizes: [512, 128], path_pattern: "icon-{size}.png" },
  });
  const sizedText = (sized.content as Array<{ type: string; text: string }>)[0]!.text;
  assert.match(sizedText, /ran \d+ chars/);
  const exportCall = [...fake.calls].reverse().find((c) => c.name === "execute_script");
  assert.ok(String(exportCall?.args.script).includes('"size":512'));
  assert.ok(String(exportCall?.args.script).includes("C:/Users/tester/Desktop/icon-512.png"));
  assert.ok(String(exportCall?.args.script).includes("width: entry.size"));

  const status = await mcp.callTool({ name: "affinity.status", arguments: {} });
  const statusText = (status.content as Array<{ type: string; text: string }>)[0]!.text;
  assert.match(statusText, /"connected": true/);
});

test("script generation helpers behave", () => {
  assert.ok(openFileScript("C:\\tmp\\a.jpg").includes('Document.load("C:\\\\tmp\\\\a.jpg")'));
  assert.equal(exportPreset("jpg"), "JPEG (Best quality)");
  assert.equal(exportPreset("svg"), "SVG (for export)");
  assert.equal(exportPreset("eps"), "EPS (for export)");
  assert.ok(exportScript("C:/tmp/out.pdf", "pdf").includes('createWithPresetName("PDF (for print)")'));
  assert.ok(exportOutlinedScript("C:/tmp/out.svg", "svg").includes("convertToCurves"));
  assert.ok(exportOutlinedScript("C:/tmp/out.svg", "svg").includes('createWithPresetName("SVG (for export)")'));
  assert.ok(exportOutlinedScript("C:/tmp/out.svg", "svg").includes("doc.undo()"));
  assert.equal(filterScript("not-a-filter", 10), null);
  assert.equal(filterScript("blur", 33)?.includes("GaussianBlurFilterRasterNodeDefinition"), true);
  assert.ok(supportedFilters().includes("motion"));
  assert.equal(isAbsolutePath("C:\\x\\y.png"), true);
  assert.equal(isAbsolutePath("out.png"), false);
  assert.equal(anchorToDesktop("C:\\Users\\tester\\Desktop", "out.png"), "C:/Users/tester/Desktop/out.png");
  assert.deepEqual(parseHexColour("#FFD700", { r: 0, g: 0, b: 0, a: 0 }), { r: 255, g: 215, b: 0, a: 255 });
  assert.deepEqual(parseHexColour("#fff", { r: 0, g: 0, b: 0, a: 0 }), { r: 255, g: 255, b: 255, a: 255 });
  assert.equal(tryParseHexColour("nope"), null);
  assert.deepEqual(tryParseHexColour("#0a0b0c0d"), { r: 10, g: 11, b: 12, a: 13 });
});

test("SVG path parser handles moves, lines, implicit lineto and close", () => {
  const square = parseSvgPath("M10 10 L20 10 L20 20 Z");
  assert.equal(square.length, 1);
  assert.deepEqual(square[0]!.start, [10, 10]);
  assert.equal(square[0]!.segments.length, 2);
  assert.equal(square[0]!.closed, true);
  assert.deepEqual(square[0]!.segments[0], { kind: "line", to: [20, 10] });

  const relative = parseSvgPath("m10 10 l10 0 l0 10 z");
  assert.deepEqual(relative[0]!.segments[1], { kind: "line", to: [20, 20] });

  const implicit = parseSvgPath("M0 0 10 0 10 10");
  assert.equal(implicit[0]!.segments.length, 2);
  assert.deepEqual(implicit[0]!.segments[1], { kind: "line", to: [10, 10] });

  const afterClose = parseSvgPath("M0 0 L10 0 Z L20 20");
  assert.equal(afterClose.length, 2);
  assert.deepEqual(afterClose[1]!.start, [0, 0]);
  assert.deepEqual(afterClose[1]!.segments[0], { kind: "line", to: [20, 20] });

  assert.throws(() => parseSvgPath("M0 0 L"), /invalid number/);
  assert.deepEqual(parseSvgPath(""), []);
});

test("SVG path parser handles cubics, quadratics and smooth variants", () => {
  const cubic = parseSvgPath("M0 0 C0 10 10 10 10 0");
  assert.equal(cubic[0]!.segments.length, 1);
  const seg = cubic[0]!.segments[0]!;
  assert.equal(seg.kind, "cubic");
  if (seg.kind === "cubic") {
    assert.deepEqual(seg.c1, [0, 10]);
    assert.deepEqual(seg.c2, [10, 10]);
    assert.deepEqual(seg.to, [10, 0]);
  }

  const smooth = parseSvgPath("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
  const seg2 = smooth[0]!.segments[1]!;
  if (seg2.kind === "cubic") {
    assert.deepEqual(seg2.c1, [10, -10]);
  }

  const quad = parseSvgPath("M0 0 Q10 0 10 10 T20 20");
  const q2 = quad[0]!.segments[1]!;
  if (q2.kind === "cubic") {
    assert.ok(Math.abs(q2.c1[0] - 10) < 1e-9);
    assert.ok(Math.abs(q2.c1[1] - 50 / 3) < 1e-9);
  }
});

test("arc conversion matches the quarter-circle bezier approximation", () => {
  const segments = arcToCubics(1, 0, 1, 1, 0, false, true, 0, 1);
  assert.equal(segments.length, 1);
  const seg = segments[0]!;
  assert.ok(Math.abs(seg.to[0] - 0) < 1e-9);
  assert.ok(Math.abs(seg.to[1] - 1) < 1e-9);
  assert.ok(Math.abs(seg.c1[1] - 0.5523) < 0.001);
  assert.ok(Math.abs(seg.c2[0] - 0.5523) < 0.001);
});

test("drawPathScript emits CurveBuilder calls and correct node arguments", () => {
  const params: DrawPathParams = {
    pathData: "M0 0 L100 0 L100 100 Z",
    fill: { r: 20, g: 20, b: 24, a: 255 },
    stroke: { r: 255, g: 255, b: 255, a: 255 },
    strokeWidth: 6,
    strokeCap: "round",
    strokeJoin: "round",
    offsetX: 40,
    offsetY: 50,
    scale: 1,
    spreadIndex: 0,
    name: "Mark",
  };
  const script = drawPathScript(params);
  assert.ok(script);
  assert.ok(script!.includes("CurveBuilder.create()"));
  assert.ok(script!.includes("b0.beginXY(40, 50)"));
  assert.ok(script!.includes("b0.lineToXY(140, 50)"));
  assert.ok(script!.includes("b0.close()"));
  assert.ok(script!.includes("PolyCurveNodeDefinition.create(poly, brushFill, lineFill, lineStyle"));
  assert.ok(script!.includes("LineCap.Round"));
  assert.ok(script!.includes("LineJoin.Round"));
  assert.ok(script!.includes('def.userDescription = "Mark"'));
  assert.equal(drawPathScript({ ...params, pathData: "M0 0 L" }), null);
  const scaled = drawPathScript({ ...params, scale: 2, offsetX: 0, offsetY: 0 });
  assert.ok(scaled!.includes("b0.lineToXY(200, 0)"));
  assert.ok(scaled!.includes("b0.lineToXY(200, 200)"));
});

test("exportSizesScript, saveDocumentScript and addTextScript build the right calls", () => {
  const sizes = exportSizesScript([
    { path: "C:/tmp/icon-512.png", size: 512, preset: "PNG" },
    { path: "C:/tmp/icon-16.png", size: 16, preset: "PNG" },
  ]);
  assert.ok(sizes.includes('"size":512'));
  assert.ok(sizes.includes("width: entry.size, height: entry.size"));
  assert.ok(sizes.includes('createWithPresetName(entry.preset)'));

  const save = saveDocumentScript("C:/tmp/master.af");
  assert.ok(save.includes('doc.saveAs("C:/tmp/master.af")'));

  const text = addTextScript({
    text: "JAPLUX",
    x: 100,
    y: 200,
    fontSize: 48,
    colour: { r: 255, g: 215, b: 0, a: 255 },
    fontFamily: "Segoe UI",
    styleName: "Bold",
    characterSpacing: 2,
    spreadIndex: 2,
  });
  assert.ok(text.includes("FontFamily.all"));
  assert.ok(text.includes("setGlyphAtts"));
  assert.ok(text.includes("GlyphAttDoubleType.CharacterSpacing"));
  assert.ok(text.includes("FillDescriptor.createSolid(RGBA8(255, 215, 0, 255))"));
  assert.ok(text.includes("isBold"));
  assert.ok(text.includes("createSetCurrentSpread"));
  assert.ok(text.includes("spreads[2]"));
});
