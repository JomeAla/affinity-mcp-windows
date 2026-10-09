#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[affinity-mcp-windows] stdio server ready. Bridge target: http://[::1]:6767");
}

main().catch((err) => {
  console.error("[affinity-mcp-windows] fatal:", (err as Error).message);
  process.exit(1);
});
