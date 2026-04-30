// Tool: push_github
import { z } from "zod";
import { client } from "../client.js";

export const pushGithubTool = {
  name: "push_github",
  description: "Push project files to a GitHub repository. Creates the repo if it doesn't exist and pushes all files.",
  schema: {
    projectId: z.string().describe("Project ID"),
    repoName: z.string().describe("GitHub repository name (e.g., 'clearcross-dental')"),
    version: z.number().optional().describe("Version to push (default: latest)"),
  },
  handler: async ({ projectId, repoName, version }: { projectId: string; repoName: string; version?: number }) => {
    // First get the files
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

    // Push to GitHub
    const res = await client.request("/api/github/push", {
      method: "POST",
      body: { repoName, files, projectId },
    });

    if (!res.ok) {
      const err = res.data as any;
      return { content: [{ type: "text" as const, text: `❌ GitHub push failed: ${err.error || JSON.stringify(err)}` }] };
    }

    const data = res.data as any;
    let output = `✅ Pushed to GitHub!\n`;
    output += `- Repo: ${data.repoUrl}\n`;
    output += `- Files pushed: ${data.pushed}/${data.total}\n`;
    if (data.errors?.length) {
      output += `- Errors: ${data.errors.join(", ")}`;
    }

    return { content: [{ type: "text" as const, text: output }] };
  },
};
