// Lovable Clone MCP Server — Entry Point
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./tools/index.js";

const server = new McpServer({
  name: "lovable-clone",
  version: "1.0.0",
});

// Register all tools
for (const tool of tools) {
  server.tool(
    tool.name,
    tool.description,
    tool.schema,
    tool.handler as any
  );
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Lovable Clone MCP server running on stdio");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
