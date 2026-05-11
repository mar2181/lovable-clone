// Tool: create_project
import { z } from "zod";
import { client } from "../client.js";

export const createProjectTool = {
  name: "create_project",
  description: "Create a new empty project in the Lovable Clone. Returns the project ID needed for send_message and other operations.",
  schema: {
    name: z.string().describe("Project name (e.g., 'ClearCross Dental Clinic')"),
    description: z.string().optional().describe("Optional project description"),
  },
  handler: async ({ name, description }: { name: string; description?: string }) => {
    const res = await client.request("/api/projects", {
      method: "POST",
      body: { name, description },
    });

    if (!res.ok) {
      const err = res.data as any;
      return { content: [{ type: "text" as const, text: `❌ Failed to create project: ${err.error || JSON.stringify(err)}` }] };
    }

    const data = res.data as any;
    return {
      content: [{
        type: "text" as const,
        text: `✅ Project created!\n- ID: ${data.project.id}\n- Name: ${data.project.name}\n- Version: ${data.version}\n- Created: ${data.project.createdAt}`,
      }],
    };
  },
};
