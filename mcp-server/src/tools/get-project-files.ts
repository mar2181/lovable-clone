// Tool: get_project_files
import { z } from "zod";
import { client } from "../client.js";

export const getProjectFilesTool = {
  name: "get_project_files",
  description: "Get all generated files for a project. Returns the full file contents for the latest version (or a specific version).",
  schema: {
    projectId: z.string().describe("Project ID"),
    version: z.number().optional().describe("Specific version number (default: latest)"),
  },
  handler: async ({ projectId, version }: { projectId: string; version?: number }) => {
    const path = version
      ? `/api/versions/${projectId}/${version}`
      : `/api/versions/${projectId}/latest`;

    const res = await client.request(path);

    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `❌ Failed to get files: ${(res.data as any)?.error || "Unknown error"}` }] };
    }

    const versionData = (res.data as any).version;
    const files = versionData.files || {};
    const fileCount = Object.keys(files).length;
    const fileList = Object.keys(files).map(f => `  ${f} (${files[f].length} chars)`).join("\n");

    let output = `📁 Project ${projectId} — Version ${versionData.version}\n`;
    output += `Created: ${versionData.createdAt}\n`;
    output += `Prompt: ${versionData.prompt}\n`;
    output += `Files (${fileCount}):\n${fileList}\n\n`;
    output += `--- FILE CONTENTS ---\n\n`;

    for (const [path, content] of Object.entries(files)) {
      output += `=== ${path} ===\n${content}\n\n`;
    }

    return { content: [{ type: "text" as const, text: output }] };
  },
};
