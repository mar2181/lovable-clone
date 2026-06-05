// Tool: retarget_site
import { z } from "zod";
import { client } from "../client.js";
import { config } from "../config.js";

export const retargetSiteTool = {
  name: "retarget_site",
  description:
    "Clone-and-swap a personal-injury law-firm template to a NEW firm by scraping that firm's website. " +
    "Scrapes sourceUrl, extracts the firm identity (name, attorney, phone, address, logo) with an LLM, then " +
    "globally swaps it across all files into a new project. Use dryRun=true to preview the extracted identity " +
    "WITHOUT swapping (confirm before committing). Returns the extracted identity, the new project id, any " +
    "residual un-swapped strings, and images that still need a client-specific replacement.",
  schema: {
    projectId: z.string().describe("Source project ID — the pristine master template or a fresh clone of it"),
    sourceUrl: z.string().describe("The target firm's website to scrape (must start with http:// or https://)"),
    dryRun: z.boolean().optional().describe("If true, return the extracted identity WITHOUT swapping (preview/confirm). Default: false"),
    newProjectName: z.string().optional().describe("Name for the new cloned project (defaults to the scraped firm name)"),
  },
  handler: async ({ projectId, sourceUrl, dryRun, newProjectName }: {
    projectId: string;
    sourceUrl: string;
    dryRun?: boolean;
    newProjectName?: string;
  }) => {
    const body: Record<string, unknown> = { sourceUrl };
    if (dryRun !== undefined) body.dryRun = dryRun;
    if (newProjectName !== undefined) body.newProjectName = newProjectName;

    // Scrape + LLM extraction can be slow — use the generation timeout.
    const res = await client.request(`/api/retarget/${projectId}/from-url`, {
      method: "POST",
      body,
      timeout: config.requestTimeout,
    });

    if (!res.ok) {
      const err = res.data as any;
      // 422 dry-run / missing-fields carries useful detail.
      let msg = `❌ Retarget failed: ${err?.error || JSON.stringify(err)}`;
      if (err?.missing?.length) msg += `\n- Missing: ${err.missing.join(", ")}`;
      if (err?.extracted) msg += `\n- Extracted so far: ${JSON.stringify(err.extracted)}`;
      return { content: [{ type: "text" as const, text: msg }] };
    }

    const data = res.data as any;

    // Preview / dry-run path: no swap performed, just the extracted identity.
    if (data.dryRun === true || (!data.project && data.extracted)) {
      let out = `🔎 Dry-run preview — no swap performed.\n`;
      out += `- Extracted identity: ${JSON.stringify(data.target || data.extracted, null, 2)}\n`;
      if (data.missing?.length) out += `- Still missing: ${data.missing.join(", ")}\n`;
      if (data.sourceMeta) out += `- Source: ${data.sourceMeta.url || sourceUrl} (${data.sourceMeta.title || "no title"})\n`;
      out += `\nRe-run with dryRun=false to perform the swap.`;
      return { content: [{ type: "text" as const, text: out }] };
    }

    // Swap performed.
    let out = `✅ Retargeted!\n`;
    out += `- New project: ${data.project?.name} (ID: ${data.project?.id})\n`;
    out += `- Created copy: ${data.createdCopy}\n`;
    out += `- Source ID: ${data.sourceId}\n`;
    out += `- New version: ${data.newVersion}\n`;
    out += `- Replacements applied: ${data.appliedTotal}\n`;
    if (data.target) out += `- Identity: ${JSON.stringify(data.target)}\n`;
    if (data.byRule && Object.keys(data.byRule).length) {
      out += `- By rule: ${JSON.stringify(data.byRule)}\n`;
    }

    const residualKeys = data.residuals ? Object.keys(data.residuals) : [];
    if (residualKeys.length) {
      out += `\n⚠️ Residual (un-swapped) source identity still present:\n`;
      for (const [label, info] of Object.entries(data.residuals as Record<string, any>)) {
        out += `  - ${label}: ${info.count}× in ${info.files.join(", ")}\n`;
      }
    } else {
      out += `\n✅ No residual source identity remaining.\n`;
    }

    if (data.imagesNeedingReplacement?.length) {
      out += `\n🖼️ Images needing a client-specific replacement (${data.imagesNeedingReplacement.length}):\n`;
      out += data.imagesNeedingReplacement.map((i: string) => `  - ${i}`).join("\n");
    }

    return { content: [{ type: "text" as const, text: out }] };
  },
};
