// MCP Server Configuration
export const config = {
  // 8788 because 8787 is held by another local service in this dev environment.
  workerUrl: process.env.WORKER_URL || "http://localhost:8788",
  apiKey: process.env.MCP_API_KEY || "",
  userId: process.env.MCP_USER_ID || "mcp-service-user",
  requestTimeout: 120_000,  // 2 min for AI generation
  defaultTimeout: 30_000,   // 30s for normal requests
  maxImageSize: 5 * 1024 * 1024, // 5MB
};

if (!config.apiKey) {
  console.error("[MCP] WARNING: MCP_API_KEY not set. Worker auth will fail.");
}
