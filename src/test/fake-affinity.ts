import http from "node:http";
import { AddressInfo } from "node:net";

/**
 * Minimal fake of Affinity's built-in MCP server (HTTP + SSE, protocol 2025-11-25).
 * Used by the test-suite so the bridge can be exercised without Affinity running.
 */
export interface FakeAffinityOptions {
  /** Rename the execute_script argument to prove schema-driven adaptation. */
  scriptArgName?: string;
}

export interface FakeAffinityServer {
  url: string;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  close: () => Promise<void>;
}

export async function startFakeAffinity(options: FakeAffinityOptions = {}): Promise<FakeAffinityServer> {
  const scriptArg = options.scriptArgName ?? "script";
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const sessions = new Map<string, http.ServerResponse>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/sse") {
      const sessionId = `sess-${sessions.size + 1}`;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      sessions.set(sessionId, res);
      res.write(`event: endpoint\r\ndata: /message?session_id=${sessionId}\r\n\r\n`);
      req.on("close", () => sessions.delete(sessionId));
      return;
    }

    if (req.method === "POST" && url.pathname === "/message") {
      const sessionId = url.searchParams.get("session_id") ?? "";
      const session = sessions.get(sessionId);
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(202).end();
        if (!session) return;
        let message: { id?: number; method?: string; params?: Record<string, unknown> };
        try {
          message = JSON.parse(body);
        } catch {
          return;
        }
        const send = (payload: unknown) =>
          session.write(`event: message\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`);

        if (message.method === "initialize") {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "fake-affinity", version: "9.9.9" },
            },
          });
          return;
        }
        if (message.method === "tools/list") {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [
                {
                  name: "execute_script",
                  description: "run JS",
                  inputSchema: { type: "object", properties: { [scriptArg]: { type: "string" } }, required: [scriptArg] },
                },
                {
                  name: "render_spread",
                  description: "render",
                  inputSchema: { type: "object", properties: { format: { type: "string" } } },
                },
                {
                  name: "read_sdk_documentation_topic",
                  description: "docs",
                  inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
                },
              ],
            },
          });
          return;
        }
        if (message.method === "tools/call") {
          const params = message.params as { name?: string; arguments?: Record<string, unknown> };
          calls.push({ name: params.name ?? "", args: params.arguments ?? {} });
          if (params.name === "execute_script") {
            const script = String((params.arguments ?? {})[scriptArg] ?? "");
            const result = script.includes("userDesktopPath")
              ? "C:\\Users\\tester\\Desktop"
              : `ran ${script.length} chars`;
            send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: result }] } });
            return;
          }
          if (params.name === "read_sdk_documentation_topic") {
            send({
              jsonrpc: "2.0",
              id: message.id,
              result: { content: [{ type: "text", text: `doc:${String((params.arguments ?? {}).topic ?? "")}` }] },
            });
            return;
          }
          send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "rendered" }] } });
          return;
        }
        if (message.id !== undefined) {
          send({ jsonrpc: "2.0", id: message.id, result: {} });
        }
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        for (const [, res] of sessions) res.end();
        sessions.clear();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
