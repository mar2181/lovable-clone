// Tool: list_projects
import { z } from "zod";
import { client } from "../client.js";

export const listProjectsTool = {
  name: "list_projects",
  description: "List all projects for the current user. Use this to find project IDs for other operations.",
  schema: {},
  handler: async () => {
    const res = await client.request("/api/projects");

    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `❌ Failed to list projects: ${(res.data as any)?.error || "Unknown error"}` }] };
    }

    const projects = (res.data as any).projects || [];
    if (projects.length === 0) {
      return { content: [{ type: "text" as const, text: "No projects found. Use create_project to start one." }] };
    }

    const list = projects.map((p: any) =>
      `- ${p.name} (ID: ${p.id}) — ${p.description || "no description"} — updated ${p.updatedAt}`
    ).join("\n");

    return { content: [{ type: "text" as const, text: `📋 Projects (${projects.length}):\n${list}` }] };
  },
};
