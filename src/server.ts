import fs from "node:fs/promises";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AffinityClient, extractLastJson, extractText } from "./affinity/sse-client.js";
import {
  AddTextParams,
  ChangeColourParams,
  DrawShapeParams,
  ExportEntry,
  addTextScript,
  anchorToDesktop,
  batchExportScript,
  batchOpenScript,
  changeColourScript,
  closeDocumentScript,
  createNewScript,
  drawShapeScript,
  exportOutlinedScript,
  exportPreset,
  exportScript,
  filterScript,
  getActiveDocumentScript,
  openFileScript,
  parseHexColour,
  pikachuSvg,
  supportedFilters,
} from "./scripts/generators.js";

export interface ToolContent {
  type: "text";
  text: string;
}

export function textResult(data: unknown, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }], isError };
}

export function rawResult(result: unknown) {
  const content = (result as { content?: unknown[] })?.content;
  if (Array.isArray(content) && content.length > 0) {
    return { content: content as Array<{ type: "text"; text: string }> };
  }
  return textResult(extractText(result));
}

export function createServer(client: AffinityClient = new AffinityClient()): McpServer {
  const server = new McpServer({ name: "affinity-mcp-windows", version: "0.2.0" });

  async function runScript(script: string) {
    const result = await client.executeScript(script);
    const parsed = extractLastJson(result);
    return textResult(parsed ?? extractText(result) ?? "no output");
  }

  server.registerTool(
    "affinity.status",
    {
      description:
        "Check the connection to Affinity's built-in MCP server and report the SDK tools it exposes.",
      inputSchema: {},
    },
    async () => {
      try {
        await client.ensureConnected();
        const desktop = await client.getDesktopPath().catch(() => null);
        return textResult({
          connected: true,
          base_url: client.baseUrl,
          affinity_tools: client.listCachedTools().map((t) => t.name),
          desktop_path: desktop,
        });
      } catch (err) {
        return textResult(
          {
            connected: false,
            base_url: client.baseUrl,
            error: (err as Error).message,
            help:
              "Open Affinity and enable Edit > Settings > Model Context Protocol > Enable Affinity MCP. " +
              "Affinity 3.2+ is required.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "affinity.open_file",
    {
      description:
        "Open a file in Affinity (natural language: 'open the file ...'). Supported by Document.load; the file type is inferred by Affinity.",
      inputSchema: {
        path: z.string().describe("Absolute path of the file to open."),
        app: z
          .enum(["Photo", "Designer", "Publisher"])
          .optional()
          .describe("Accepted for compatibility; Affinity 3.x is one unified app."),
      },
    },
    async ({ path }) => runScript(openFileScript(path)),
  );

  server.registerTool(
    "affinity.create_new",
    {
      description:
        "Create a new Affinity document (natural language: 'create a new document ...'). Sizes are pixels.",
      inputSchema: {
        app: z
          .enum(["Photo", "Designer", "Publisher"])
          .optional()
          .describe("Accepted for compatibility; Affinity 3.x is one unified app."),
        width: z.number().int().positive().optional().describe("Width in pixels (default 1920)."),
        height: z.number().int().positive().optional().describe("Height in pixels (default 1080)."),
      },
    },
    async ({ width, height }) => runScript(createNewScript(width ?? 1920, height ?? 1080)),
  );

  server.registerTool(
    "affinity.export",
    {
      description:
        "Export the current document to a file (natural language: 'export as PDF ...'). Affinity sandboxes file writes to the Desktop; relative paths are anchored there.",
      inputSchema: {
        path: z.string().describe("Target file path. Relative paths land on the Windows Desktop."),
        format: z.enum(["pdf", "png", "jpg", "tiff", "svg", "eps"]).describe("Export format."),
        quality: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe("Accepted for compatibility; v1 exports with the default preset settings."),
      },
    },
    async ({ path, format }) => {
      if (!exportPreset(format)) return textResult({ exported: false, error: `unsupported format: ${format}` }, true);
      const desktop = await client.getDesktopPath();
      return runScript(exportScript(anchorToDesktop(desktop, path), format));
    },
  );

  server.registerTool(
    "affinity.export_outlined",
    {
      description:
        "Export the current document with all text outlined (converted to curves) — the print-safe vector route for SVG/PDF/EPS. The open document's text is restored afterwards via undo.",
      inputSchema: {
        path: z.string().describe("Target file path. Relative paths land on the Windows Desktop."),
        format: z.enum(["svg", "pdf", "eps"]).describe("Vector export format."),
      },
    },
    async ({ path, format }) => {
      const desktop = await client.getDesktopPath();
      return runScript(exportOutlinedScript(anchorToDesktop(desktop, path), format));
    },
  );

  server.registerTool(
    "affinity.apply_filter",
    {
      description:
        "Add a live, non-destructive blur-family filter to the current document. Supported filter names: " +
        supportedFilters().join(", ") +
        ". Intensity maps to the filter radius (0-1024).",
      inputSchema: {
        filter_name: z.string().describe("Filter name, e.g. blur, median, motion, radial, bilateral, lens."),
        intensity: z.number().min(0).max(100).optional().describe("Strength 0-100 (default 50)."),
      },
    },
    async ({ filter_name, intensity }) => {
      const script = filterScript(filter_name, intensity ?? 50);
      if (!script) {
        return textResult(
          { applied: false, filter: filter_name, error: `unsupported filter; supported: ${supportedFilters().join(", ")}` },
          true,
        );
      }
      return runScript(script);
    },
  );

  server.registerTool(
    "affinity.get_active_document",
    {
      description: "Get information about the currently active Affinity document.",
      inputSchema: {},
    },
    async () => runScript(getActiveDocumentScript()),
  );

  server.registerTool(
    "affinity.close_document",
    {
      description: "Close the currently open Affinity document.",
      inputSchema: {},
    },
    async () => runScript(closeDocumentScript()),
  );

  server.registerTool(
    "affinity.batch_open_files",
    {
      description:
        "Open multiple files in Affinity in one call (natural language: 'open these files ...'). Returns per-file results.",
      inputSchema: {
        paths: z.array(z.string()).min(1).max(64).describe("Absolute file paths to open."),
        app: z
          .enum(["Photo", "Designer", "Publisher"])
          .optional()
          .describe("Accepted for compatibility; Affinity 3.x is one unified app."),
      },
    },
    async ({ paths }) => runScript(batchOpenScript(paths)),
  );

  server.registerTool(
    "affinity.batch_export",
    {
      description:
        "Export the current document to multiple files in one call. Affinity sandboxes file writes to the Desktop; relative paths are anchored there.",
      inputSchema: {
        exports: z
          .array(
            z.object({
              path: z.string(),
              format: z.enum(["pdf", "png", "jpg", "tiff", "svg", "eps"]),
              quality: z.number().min(1).max(100).optional(),
            }),
          )
          .min(1)
          .max(64),
      },
    },
    async ({ exports: entries }) => {
      const desktop = await client.getDesktopPath();
      const prepared: ExportEntry[] = entries.map((entry) => ({
        path: anchorToDesktop(desktop, entry.path),
        format: entry.format,
      }));
      return runScript(batchExportScript(prepared));
    },
  );

  server.registerTool(
    "affinity.draw_shape",
    {
      description:
        "Draw a shape in the current Affinity document (natural language: 'draw a circle ...'). Shapes: circle, ellipse, rectangle, line.",
      inputSchema: {
        shape_type: z.enum(["circle", "ellipse", "rectangle", "line"]),
        x: z.number().optional().describe("X position (default 100)."),
        y: z.number().optional().describe("Y position (default 100)."),
        width: z.number().optional().describe("Width (default 200). For line, horizontal delta."),
        height: z.number().optional().describe("Height (default 200). For line, vertical delta."),
        color: z.string().optional().describe("Fill colour as hex, e.g. #FFD700 (default yellow)."),
        stroke_color: z.string().optional().describe("Stroke colour as hex (default black)."),
        stroke_width: z.number().optional().describe("Stroke width (default 2)."),
      },
    },
    async ({ shape_type, x, y, width, height, color, stroke_color, stroke_width }) => {
      const params: DrawShapeParams = {
        shapeType: shape_type,
        x: x ?? 100,
        y: y ?? 100,
        width: width ?? 200,
        height: height ?? 200,
        colour: parseHexColour(color, { r: 255, g: 215, b: 0, a: 255 }),
        strokeColour: parseHexColour(stroke_color, { r: 0, g: 0, b: 0, a: 255 }),
        strokeWidth: stroke_width ?? 2,
      };
      const script = drawShapeScript(params);
      if (!script) return textResult({ drawn: false, error: `unsupported shape: ${shape_type}` }, true);
      return runScript(script);
    },
  );

  server.registerTool(
    "affinity.add_text",
    {
      description:
        "Add artistic text to the current Affinity document (natural language: 'add the text ...'). Font size is in points.",
      inputSchema: {
        text: z.string().min(1),
        x: z.number().optional().describe("X position (default 100)."),
        y: z.number().optional().describe("Y position (default 100)."),
        font_size: z.number().positive().optional().describe("Font size in points (default 24)."),
        color: z.string().optional().describe("Hex colour. Note: v1 does not apply text colour; it is reported back."),
      },
    },
    async ({ text, x, y, font_size, color }) => {
      const params: AddTextParams = {
        text,
        x: x ?? 100,
        y: y ?? 100,
        fontSize: font_size ?? 24,
        colourProvided: Boolean(color),
      };
      return runScript(addTextScript(params));
    },
  );

  server.registerTool(
    "affinity.change_color",
    {
      description:
        "Change the fill colour of the current selection (natural language: 'change the colour to ...').",
      inputSchema: {
        color: z.string().describe("Hex colour, e.g. #FFD700."),
        fill_selection: z
          .boolean()
          .optional()
          .describe("When true, fall back to the first layer if nothing is selected (default false)."),
      },
    },
    async ({ color, fill_selection }) => {
      const parsed = parseHexColour(color, { r: 0, g: 0, b: 0, a: 255 });
      const params: ChangeColourParams = { colour: parsed, fillSelection: fill_selection ?? false };
      return runScript(changeColourScript(params));
    },
  );

  server.registerTool(
    "affinity.draw_pikachu",
    {
      description:
        "Generate a small vector mascot (SVG) and open it in Affinity (natural language: 'draw pikachu'). Output defaults to the Desktop.",
      inputSchema: {
        width: z.number().int().positive().optional().describe("Canvas width (default 800)."),
        height: z.number().int().positive().optional().describe("Canvas height (default 800)."),
        output_path: z.string().optional().describe("SVG target path; relative paths land on the Desktop."),
      },
    },
    async ({ width, height, output_path }) => {
      const desktop = await client.getDesktopPath();
      const target = anchorToDesktop(desktop, output_path ?? "affinity-mcp-mascot.svg");
      const svg = pikachuSvg(width ?? 800, height ?? 800);
      await fs.writeFile(target, svg, "utf8");
      const opened = await runScript(openFileScript(target));
      return textResult({
        drawn: true,
        svg_path: target,
        open_result: JSON.parse(opened.content[0].text as string),
      });
    },
  );

  server.registerTool(
    "affinity.execute_script",
    {
      description:
        "Run arbitrary JavaScript against Affinity's official scripting SDK. Read the SDK docs with affinity.list_sdk_docs / affinity.read_sdk_doc first. Output must be console.log'ed. Filesystem is Desktop-only.",
      inputSchema: {
        script: z.string().min(1).describe("JavaScript source to execute inside Affinity."),
      },
    },
    async ({ script }) => rawResult(await client.executeScript(script)),
  );

  async function callByName(name: string, args: Record<string, unknown>) {
    try {
      const result = await client.callAffinityTool(name, args);
      return rawResult(result);
    } catch (err) {
      return textResult({ error: (err as Error).message }, true);
    }
  }

  async function renderCall(suffix: string, args: Record<string, unknown>) {
    try {
      await client.ensureConnected();
      const tool = client.findTool(suffix);
      if (!tool) {
        return textResult({ error: `Affinity does not expose a '${suffix}' tool (update Affinity).` }, true);
      }
      const merged: Record<string, unknown> = { ...args };
      const props = tool.inputSchema?.properties ?? {};
      if (props.document_session_uuid && !merged.document_session_uuid) {
        const uuid = await client.getCurrentSessionUuid();
        if (!uuid) return textResult({ error: "no open document to render" }, true);
        merged.document_session_uuid = uuid;
      }
      if (props.spread_index && merged.spread_index === undefined) merged.spread_index = 0;
      return rawResult(await client.callAffinityTool(tool.name, merged));
    } catch (err) {
      return textResult({ error: (err as Error).message }, true);
    }
  }

  server.registerTool(
    "affinity.render_spread",
    {
      description:
        "Render the current spread to an image so you can visually verify a change. The document session UUID and spread index are filled in automatically.",
      inputSchema: {
        args: z.record(z.unknown()).optional().describe("Optional render options forwarded to Affinity."),
      },
    },
    async ({ args }) => renderCall("render_spread", args ?? {}),
  );

  server.registerTool(
    "affinity.render_selection",
    {
      description:
        "Render the current selection to an image. The document session UUID is filled in automatically.",
      inputSchema: {
        args: z.record(z.unknown()).optional(),
      },
    },
    async ({ args }) => renderCall("render_selection", args ?? {}),
  );

  server.registerTool(
    "affinity.list_sdk_docs",
    {
      description: "List the Affinity SDK documentation topics available from the running app.",
      inputSchema: {
        args: z.record(z.unknown()).optional(),
      },
    },
    async ({ args }) => callByName("list_sdk_documentation", args ?? {}),
  );

  server.registerTool(
    "affinity.read_sdk_doc",
    {
      description: "Read one Affinity SDK documentation topic (e.g. nodes.js, application.js, storybuilder.js, preamble).",
      inputSchema: {
        topic: z.string().min(1).describe("Documentation topic filename."),
      },
    },
    async ({ topic }) => {
      try {
        return rawResult(await client.readSdkDoc(topic));
      } catch (err) {
        return textResult({ error: (err as Error).message }, true);
      }
    },
  );

  return server;
}
