// Tool: health_check
import { z } from "zod";
import { client } from "../client.js";

export const healthCheckTool = {
  name: "health_check",
  description: "Verify the Lovable Clone worker is alive and reachable. Call this first to confirm the system is operational.",
  schema: {},
  handler: async () => {
    try {
      const res = await client.request("/health", { timeout: 5000 });
      if (res.ok && res.data && (res.data as any).status === "ok") {
        return { content: [{ type: "text" as const, text: "✅ Worker is healthy and running." }] };
      }
      return { content: [{ type: "text" as const, text: `⚠️ Worker responded but status unexpected: ${JSON.stringify(res.data)}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `❌ Worker unreachable: ${msg}` }] };
    }
  },
};
