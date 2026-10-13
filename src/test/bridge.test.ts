import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakeAffinity } from "./fake-affinity.js";
import { AffinityClient, extractText } from "../affinity/sse-client.js";
import { createServer } from "../server.js";
import {
  anchorToDesktop,
  exportOutlinedScript,
  exportPreset,
  exportScript,
  filterScript,
  isAbsolutePath,
  openFileScript,
  parseHexColour,
  supportedFilters,
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
    "affinity.add_text",
    "affinity.change_color",
    "affinity.execute_script",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }

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
});
