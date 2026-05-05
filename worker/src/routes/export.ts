import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import type { SupabaseLinkRecord } from "../types/supabase";
import * as fflate from "fflate";

const exportRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

exportRouter.use("*", authMiddleware);

exportRouter.get("/:projectId/:versionNum", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const versionNum = c.req.param("versionNum");
  
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // Verify ownership
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // Fetch version data from R2
    const versionObj = await r2.get(`${projectId}/v${versionNum}.json`);
    if (!versionObj) return c.json({ error: "Version not found" }, 404);

    const versionData = await versionObj.json() as { files: Record<string, string> };

    // Inject .env.example if Supabase is linked
    const supabaseLinkRaw = await kv.get(`project:${projectId}:supabase`);
    if (supabaseLinkRaw) {
      const link: SupabaseLinkRecord = JSON.parse(supabaseLinkRaw);
      versionData.files[".env.example"] =
        `VITE_SUPABASE_URL=${link.restUrl}\nVITE_SUPABASE_ANON_KEY=${link.anonKey}\n`;
    }

    // Create ZIP in memory using fflate
    const zipData: Record<string, Uint8Array> = {};
    const textEncoder = new TextEncoder();

    for (const [filePath, content] of Object.entries(versionData.files)) {
      // Remove leading slash for ZIP compatibility
      const cleanPath = filePath.startsWith("/") ? filePath.substring(1) : filePath;
      zipData[cleanPath] = textEncoder.encode(content);
    }

    const zipped = fflate.zipSync(zipData);

    const project = JSON.parse(projectExists);
    const safeName = project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // Return the specific file as a downloadable Blob
    return new Response(zipped, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-v${versionNum}.zip"`
      }
    });
    
  } catch (error) {
    console.error("Failed to export project:", error);
    return c.json({ error: "Failed to export project" }, 500);
  }
});

export default exportRouter;
