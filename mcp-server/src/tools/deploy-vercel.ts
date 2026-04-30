// Tool: deploy_vercel
import { z } from "zod";
import { client } from "../client.js";

export const deployVercelTool = {
  name: "deploy_vercel",
  description: "Deploy a project to Vercel. Returns the live deployment URL.",
  schema: {
    projectId: z.string().describe("Project ID"),
    version: z.number().optional().describe("Version to deploy (default: latest)"),
  },
  handler: async ({ projectId, version }: { projectId: string; version?: number }) => {
    // Get the files
    let targetVersion = version;
    let files: Record<string, string>;

    if (!targetVersion) {
      const verRes = await client.request(`/api/versions/${projectId}/latest`);
      if (!verRes.ok) {
        return { content: [{ type: "text" as const, text: "❌ Could not find project files." }] };
      }
      const verData = (verRes.data as any).version;
      targetVersion = verData.version;
      files = verData.files;
    } else {
      const verRes = await client.request(`/api/versions/${projectId}/${targetVersion}`);
      if (!verRes.ok) {
        return { content: [{ type: "text" as const, text: "❌ Could not find project files." }] };
      }
      files = (verRes.data as any).version.files;
    }

    // Deploy to Vercel
    const res = await client.request("/api/vercel/deploy", {
      method: "POST",
      body: { files, projectId },
    });

    if (!res.ok) {
      const err = res.data as any;
      return { content: [{ type: "text" as const, text: `❌ Vercel deploy failed: ${err.error || JSON.stringify(err)}` }] };
    }

    const data = res.data as any;
    let output = `✅ Deployed to Vercel!\n`;
    output += `- URL: ${data.deploymentUrl}\n`;
    output += `- Deployment ID: ${data.deploymentId}\n`;
    output += `- Status: ${data.status}\n`;
    output += `\nNote: Vercel builds asynchronously. The URL may take 1-2 minutes to become live.`;

    return { content: [{ type: "text" as const, text: output }] };
  },
};
