// Tool: retarget_site_manual
import { z } from "zod";
import { client } from "../client.js";

export const retargetSiteManualTool = {
  name: "retarget_site_manual",
  description:
    "Clone-and-swap a personal-injury law-firm template to a NEW firm using a CALLER-SUPPLIED identity " +
    "(no scraping). Globally swaps the firm name, logo split, attorney name(s), phone(s) + tel: href, address, " +
    "city/state/zip, concierge token, and optional brand colors/per-image swaps across all files into a new " +
    "project. Use this when you already know the firm's details. Returns the new project id, any residual " +
    "un-swapped strings, and images that still need a client-specific replacement.",
  schema: {
    projectId: z.string().describe("Source project ID — the pristine master template or a fresh clone of it"),
    target: z.object({
      firmFull: z.string().describe("Full firm name, e.g. 'Marrero Injury Law Firm'"),
      logo: z.object({
        first: z.string(),
        accent: z.string(),
        suffix: z.string(),
      }).optional().describe("Logo word split (first / highlighted-accent / suffix). Derived from firmFull if omitted"),
      attorneyFull: z.string().describe("Lead attorney full name, e.g. 'David Marrero'"),
      attorneyLast: z.string().optional().describe("Attorney last name. Derived from attorneyFull if omitted"),
      phone: z.string().describe("Primary phone, formatted '(XXX) XXX-XXXX'"),
      addressLine: z.string().describe("Street + suite only, e.g. '4200 N 10th St, Suite 200'"),
      city: z.string().describe("City, e.g. 'McAllen'"),
      state: z.string().describe("2-letter USPS state code, e.g. 'TX'"),
      zip: z.string().describe("ZIP code, e.g. '78501'"),
      embedToken: z.string().nullable().optional().describe("Concierge data-token; source token is kept if null/omitted"),
      colorMap: z.record(z.string(), z.string()).nullable().optional().describe("Brand color remap, e.g. { '#C9A84C': '#1d4ed8' }"),
      images: z.record(z.string(), z.string()).optional().describe("Per-image swaps, e.g. { oldUrl: newUrl }"),
    }).describe("The new firm's identity. firmFull, attorneyFull, phone, addressLine, city, state, zip are required"),
  },
  handler: async ({ projectId, target }: {
    projectId: string;
    target: Record<string, unknown>;
  }) => {
    const res = await client.request(`/api/retarget/${projectId}`, {
      method: "POST",
      body: { target },
    });

    if (!res.ok) {
      const err = res.data as any;
      let msg = `❌ Retarget failed: ${err?.error || JSON.stringify(err)}`;
      if (err?.missing?.length) msg += `\n- Missing required fields: ${err.missing.join(", ")}`;
      return { content: [{ type: "text" as const, text: msg }] };
    }

    const data = res.data as any;
    let out = `✅ Retargeted!\n`;
    out += `- New project: ${data.project?.name} (ID: ${data.project?.id})\n`;
    out += `- Created copy: ${data.createdCopy}\n`;
    out += `- Source ID: ${data.sourceId}\n`;
    out += `- New version: ${data.newVersion}\n`;
    out += `- Replacements applied: ${data.appliedTotal}\n`;
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
