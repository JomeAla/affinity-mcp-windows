import os from "node:os";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface AffinityToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface AffinityClientOptions {
  baseUrl?: string;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
}

const CLIENT_INFO = { name: "affinity-mcp-windows", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-11-25";

export function defaultBaseUrl(): string {
  const envUrl = process.env.AFFINITY_MCP_URL;
  if (envUrl && envUrl.trim()) return envUrl.trim().replace(/\/+$/, "");
  const envPort = process.env.AFFINITY_MCP_PORT;
  const port = envPort && /^\d+$/.test(envPort) ? envPort : "6767";
  return `http://[::1]:${port}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Client for Affinity's built-in local MCP server (SSE transport).
 *
 * Affinity binds an IPv6 loopback socket on port 6767 and speaks MCP
 * protocol 2025-11-25 over HTTP + SSE:
 *   GET  {baseUrl}/sse               -> event stream (first event: "endpoint")
 *   POST {endpoint}                  -> JSON-RPC requests
 *   SSE "message" events             -> JSON-RPC responses
 */
export class AffinityClient {
  readonly baseUrl: string;
  private readonly explicitBaseUrl: boolean;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;

  private postUrl: string | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private controller: AbortController | null = null;
  private resolveEndpoint: (() => void) | null = null;
  private rejectEndpoint: ((e: Error) => void) | null = null;
  private endpointReady: Promise<void> | null = null;
  private streamAlive = false;
  private initialized = false;
  private preambleDone = false;
  private tools = new Map<string, AffinityToolInfo>();
  private desktopPath: string | null = null;

  constructor(options: AffinityClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/+$/, "");
    this.explicitBaseUrl = Boolean(options.baseUrl || process.env.AFFINITY_MCP_URL || process.env.AFFINITY_MCP_PORT);
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 120_000;
  }

  get isConnected(): boolean {
    return this.initialized && this.streamAlive;
  }

  listCachedTools(): AffinityToolInfo[] {
    return [...this.tools.values()];
  }

  getCachedDesktopPath(): string | null {
    return this.desktopPath;
  }

  async ensureConnected(): Promise<void> {
    if (this.isConnected) return;
    this.reset();
    await this.connect();
  }

  close(): void {
    this.reset();
  }

  private reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.postUrl = null;
    this.streamAlive = false;
    this.initialized = false;
    this.preambleDone = false;
    this.tools.clear();
    this.failAllPending(new Error("Affinity connection reset"));
  }

  async connect(): Promise<void> {
    const candidates = this.candidateUrls();
    let lastError: Error | null = null;
    for (const base of candidates) {
      try {
        await this.connectTo(base);
        return;
      } catch (err) {
        lastError = err as Error;
        this.reset();
      }
    }
    throw new Error(
      `Could not connect to Affinity's MCP server (${candidates.join(", ")}). ` +
        `Make sure Affinity is running and Edit > Settings > Model Context Protocol > "Enable Affinity MCP" is on. ` +
        `Details: ${lastError?.message ?? "unknown error"}`,
    );
  }

  private candidateUrls(): string[] {
    if (this.explicitBaseUrl) {
      return [this.baseUrl];
    }
    const port = new URL(this.baseUrl).port || "6767";
    return [`http://[::1]:${port}`, `http://127.0.0.1:${port}`];
  }

  private async connectTo(base: string): Promise<void> {
    this.controller = new AbortController();
    this.endpointReady = new Promise<void>((resolve, reject) => {
      this.resolveEndpoint = resolve;
      this.rejectEndpoint = reject;
    });
    void this.readStream(`${base}/sse`);

    try {
      await withTimeout(
        this.endpointReady,
        this.connectTimeoutMs,
        `Timed out waiting for Affinity's SSE endpoint event at ${base}/sse`,
      );
    } catch (err) {
      this.controller.abort();
      throw err as Error;
    }

    if (base !== this.baseUrl) {
      (this as { baseUrl: string }).baseUrl = base;
    }

    await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      this.connectTimeoutMs,
    );
    this.notify("notifications/initialized", {});

    const list = (await this.request("tools/list", {}, this.connectTimeoutMs)) as {
      tools?: AffinityToolInfo[];
    };
    this.tools.clear();
    for (const tool of list?.tools ?? []) {
      if (tool?.name) this.tools.set(tool.name, tool);
    }
    await this.readPreamble().catch(() => undefined);
    this.initialized = true;
  }

  private async readStream(url: string): Promise<void> {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/event-stream" },
        signal: this.controller?.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE HTTP ${res.status} from ${url}`);
      }
      this.streamAlive = true;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.handleEvent(rawEvent);
          boundary = buffer.indexOf("\n\n");
        }
      }
      throw new Error("Affinity SSE stream closed");
    } catch (err) {
      this.streamAlive = false;
      const error = err as Error;
      if (this.controller?.signal.aborted) return;
      this.rejectEndpoint?.(error);
      this.failAllPending(error);
    }
  }

  private handleEvent(rawEvent: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    const payload = dataLines.join("\n");
    if (event === "endpoint") {
      if (payload) {
        this.postUrl = new URL(payload, this.baseUrl).toString();
        this.resolveEndpoint?.();
      }
      return;
    }
    if (event !== "message" || !payload) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(payload) as JsonRpcMessage;
    } catch {
      return;
    }
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        entry.resolve(message.result);
      }
    }
  }

  private failAllPending(error: Error): void {
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
  }

  private async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.postUrl) throw new Error("Not connected to Affinity (no endpoint)");
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    let res: Response;
    try {
      res = await fetch(this.postUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (err) {
      this.pending.delete(id);
      throw new Error(`POST ${method} to Affinity failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      this.pending.delete(id);
      const text = await res.text().catch(() => "");
      throw new Error(`Affinity rejected ${method}: HTTP ${res.status} ${text}`);
    }
    return withTimeout(response, timeoutMs, `Affinity ${method} timed out after ${timeoutMs}ms`);
  }

  private notify(method: string, params: unknown): void {
    if (!this.postUrl) return;
    void fetch(this.postUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    }).catch(() => undefined);
  }

  /** Calls any tool exposed by Affinity's own MCP server. */
  async callAffinityTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    await this.ensureConnected();
    try {
      return await this.request(
        "tools/call",
        { name, arguments: args },
        timeoutMs ?? this.callTimeoutMs,
      );
    } catch (err) {
      const message = (err as Error).message;
      if (/stream closed|fetch failed|reset|timed out waiting/i.test(message)) {
        this.reset();
        await this.connect();
        return this.request("tools/call", { name, arguments: args }, timeoutMs ?? this.callTimeoutMs);
      }
      throw err;
    }
  }

  findTool(suffix: string): AffinityToolInfo | undefined {
    for (const [name, tool] of this.tools) {
      if (name === suffix || name.endsWith(suffix)) return tool;
    }
    return undefined;
  }

  /** Runs JavaScript against Affinity's SDK via the execute_script tool. */
  async executeScript(script: string, timeoutMs?: number): Promise<unknown> {
    await this.ensureConnected();
    const tool = this.findTool("execute_script");
    if (!tool) {
      throw new Error(
        "Affinity's MCP server does not expose execute_script. Update Affinity to 3.2 or later " +
          "and make sure scripting/MCP is enabled in Settings.",
      );
    }
    const argName = this.scriptArgName(tool);
    return this.callAffinityTool(tool.name, { [argName]: script }, timeoutMs);
  }

  private scriptArgName(tool: AffinityToolInfo): string {
    return pickArgName(tool, ["script", "code", "source", "javaScript", "javascript"]);
  }

  /**
   * Affinity requires reading the SDK "preamble" documentation topic once per
   * connection before any script is allowed to run.
   */
  private async readPreamble(): Promise<void> {
    if (this.preambleDone) return;
    const tool = this.findTool("read_sdk_documentation_topic");
    if (!tool) return;
    const argName = pickArgName(tool, ["filename", "topic", "name"]);
    await this.request("tools/call", { name: tool.name, arguments: { [argName]: "preamble" } }, this.connectTimeoutMs);
    this.preambleDone = true;
  }

  /** Reads an SDK documentation topic, adapting to the server's argument name. */
  async readSdkDoc(topic: string): Promise<unknown> {
    await this.ensureConnected();
    const tool = this.findTool("read_sdk_documentation_topic");
    if (!tool) {
      throw new Error("Affinity does not expose read_sdk_documentation_topic (update Affinity).");
    }
    const argName = pickArgName(tool, ["filename", "topic", "name"]);
    return this.callAffinityTool(tool.name, { [argName]: topic });
  }

  /** Returns the session UUID of the current document (needed by render tools). */
  async getCurrentSessionUuid(): Promise<string> {
    const result = await this.executeScript(
      "const { Document } = require('/document'); const d = Document.current; console.log(d ? d.sessionUuid : '');",
      20_000,
    );
    return extractText(result).trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  }

  async getDesktopPath(): Promise<string> {
    if (this.desktopPath) return this.desktopPath;
    try {
      const result = await this.executeScript(
        "const { app } = require('/application'); console.log(app.userDesktopPath);",
        15_000,
      );
      const text = extractText(result).trim().split(/\r?\n/).pop() ?? "";
      if (text) this.desktopPath = text;
    } catch {
      // fall through to OS default
    }
    if (!this.desktopPath) {
      this.desktopPath = os.homedir() ? `${os.homedir()}${process.platform === "win32" ? "\\" : "/"}Desktop` : "";
    }
    return this.desktopPath;
  }
}

function pickArgName(tool: AffinityToolInfo, preferred: string[]): string {
  const props = tool.inputSchema?.properties ?? {};
  for (const name of preferred) {
    if (props[name]) return name;
  }
  for (const name of preferred) {
    const match = Object.keys(props).find((key) => key.toLowerCase().includes(name.toLowerCase()));
    if (match) return match;
  }
  for (const required of tool.inputSchema?.required ?? []) {
    if (props[required]?.type === "string") return required;
  }
  for (const key of Object.keys(props)) {
    if (props[key]?.type === "string") return key;
  }
  return preferred[0] ?? "script";
}

export function extractText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return result === undefined ? "" : JSON.stringify(result);
  return content
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type) return `[${part.type} content]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractLastJson<T = Record<string, unknown>>(result: unknown): T | null {
  const text = extractText(result);
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as T;
    } catch {
      continue;
    }
  }
  return null;
}
