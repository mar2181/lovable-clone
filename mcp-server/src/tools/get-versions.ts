// Tool: get_versions
import { z } from "zod";
import { client } from "../client.js";

export const getVersionsTool = {
  name: "get_versions",
  description: "List version history for a project. Shows what was changed at each version with timestamps and prompts.",
  schema: {
    projectId: z.string().describe("Project ID"),
  },
  handler: async ({ projectId }: { projectId: string }) => {
    const res = await client.request(`/api/versions/${projectId}`);

    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `❌ Failed to get versions: ${(res.data as any)?.error || "Unknown error"}` }] };
    }

    const history = (res.data as any).history || [];
    if (history.length === 0) {
      return { content: [{ type: "text" as const, text: "No version history found." }] };
    }

    const list = history.map((v: any) =>
      `  v${v.version} — ${v.createdAt} — "${v.prompt}"`
    ).join("\n");

    return { content: [{ type: "text" as const, text: `📜 Version History (${history.length} versions):\n${list}` }] };
  },
};
