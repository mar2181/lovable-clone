// Tool: export_project
import { z } from "zod";
import { client } from "../client.js";

export const exportProjectTool = {
  name: "export_project",
  description: "Export a project as a downloadable ZIP file. Returns the file size and download info.",
  schema: {
    projectId: z.string().describe("Project ID"),
    version: z.number().optional().describe("Version to export (default: latest)"),
  },
  handler: async ({ projectId, version }: { projectId: string; version?: number }) => {
    // First get the latest version number if not specified
    let targetVersion = version;
    if (!targetVersion) {
      const verRes = await client.request(`/api/versions/${projectId}/latest`);
      if (!verRes.ok) {
        return { content: [{ type: "text" as const, text: "❌ Could not find project version." }] };
      }
      targetVersion = (verRes.data as any).version.version;
    }

    try {
      const { data, filename } = await client.fetchBinary(`/api/export/${projectId}/${targetVersion}`);
      const sizeKB = Math.round(data.byteLength / 1024);

      return {
        content: [{
          type: "text" as const,
          text: `✅ Export ready!\n- File: ${filename}\n- Size: ${sizeKB} KB\n- Version: ${targetVersion}\n\nNote: ZIP contains all project files. Use push_github or deploy_vercel for live deployment.`,
        }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `❌ Export failed: ${msg}` }] };
    }
  },
};
