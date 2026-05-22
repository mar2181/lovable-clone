import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import { defaultFiles } from "../ai/default-project";
import { extractHeroImageUrl } from "../services/thumbnail";

const projectsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All project routes require authentication
projectsRouter.use("*", authMiddleware);

// Get all projects for current user
projectsRouter.get("/", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;

  try {
    const listResult = await kv.list({ prefix: `user:${userId}:project:` });
    
    const projects = await Promise.all(
      listResult.keys.map(async (key) => {
        const data = await kv.get(key.name);
        return data ? JSON.parse(data) : null;
      })
    );

    return c.json({ projects: projects.filter(Boolean) });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return c.json({ error: "Failed to fetch projects" }, 500);
  }
});

// Get specific project
projectsRouter.get("/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const kv = c.env.KV_METADATA;

  try {
    const projectStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectStr) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json({ project: JSON.parse(projectStr) });
  } catch (error) {
    return c.json({ error: "Failed to fetch project" }, 500);
  }
});

// Refresh the project's thumbnail (hero image) — called when the editor opens
projectsRouter.post("/:id/thumbnail", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const projectStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectStr) {
      return c.json({ error: "Project not found" }, 404);
    }
    const project = JSON.parse(projectStr);

    // Load the latest file version from R2
    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    let files: Record<string, string> = {};
    if (latestVersionStr) {
      const latestData = await r2.get(`${projectId}/v${latestVersionStr}.json`);
      if (latestData) {
        const versionData = JSON.parse(await latestData.text());
        files = versionData.files || {};
      }
    }

    const heroUrl = extractHeroImageUrl(files);

    if (heroUrl && heroUrl !== project.thumbnailUrl) {
      project.thumbnailUrl = heroUrl;
      project.thumbnailUpdatedAt = new Date().toISOString();
      await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));
    }

    return c.json({ thumbnailUrl: heroUrl || project.thumbnailUrl || null });
  } catch (error) {
    console.error("Thumbnail refresh error:", error);
    return c.json({ error: "Failed to refresh thumbnail" }, 500);
  }
});

// Create new project
projectsRouter.post("/", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;
  
  try {
    const body = await c.req.json();
    const { name, description } = body;

    if (!name) {
      return c.json({ error: "Name is required" }, 400);
    }

    const projectId = nanoid(10);
    const now = new Date().toISOString();

    const project = {
      id: projectId,
      userId,
      name,
      description: description || "",
      createdAt: now,
      updatedAt: now,
    };

    // Save project metadata to KV
    await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));

    // Save initial versions to R2 (default react template)
    const initialVersionData = {
      version: 1,
      createdAt: now,
      prompt: "Initial Setup",
      files: defaultFiles
    };
    
    await r2.put(`${projectId}/v1.json`, JSON.stringify(initialVersionData));
    
    // Update latest version pointer in KV
    await kv.put(`project:${projectId}:latest_version`, "1");

    return c.json({ project, version: 1 }, 201);
  } catch (error) {
    console.error("Create project error:", error);
    return c.json({ error: "Failed to create project" }, 500);
  }
});

// Rename/Update project
projectsRouter.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const kv = c.env.KV_METADATA;
  
  try {
    const body = await c.req.json();
    const { name } = body;
    
    const projectStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectStr) {
      return c.json({ error: "Project not found" }, 404);
    }
    
    const project = JSON.parse(projectStr);
    project.name = name || project.name;
    project.updatedAt = new Date().toISOString();
    
    await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));
    
    return c.json({ project });
  } catch (error) {
    return c.json({ error: "Failed to update project" }, 500);
  }
});

// Delete project
projectsRouter.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;
  
  try {
    // Check if exists
    const projectStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectStr) {
      return c.json({ error: "Project not found" }, 404);
    }
    
    // Delete from KV
    await kv.delete(`user:${userId}:project:${projectId}`);
    await kv.delete(`project:${projectId}:latest_version`);

    // Cascade-unlink Supabase (keep OAuth tokens — other projects may use them)
    try {
      await kv.delete(`project:${projectId}:supabase`);
      await kv.delete(`project:${projectId}:supabase_schema`);
      await kv.delete(`project:${projectId}:supabase_migrations`);
    } catch (err: any) {
      console.error(`[Projects] Supabase cascade-unlink failed: ${err?.message || "unknown"}`);
    }

    // ── Cascade-delete attachments ──────────────────────────────────────────────
    try {
      const attListKey = `project:${projectId}:attachments`;
      const attListStr = await kv.get(attListKey);
      if (attListStr) {
        const { ids } = JSON.parse(attListStr) as { ids: string[] };
        for (const aid of ids) {
          try {
            const recRaw = await kv.get(`project:${projectId}:attachment:${aid}`);
            if (recRaw) {
              const rec = JSON.parse(recRaw);
              await r2.delete(rec.r2Key);
            }
            await kv.delete(`project:${projectId}:attachment:${aid}`);
          } catch (err: any) {
            // Queue for GC cron if individual delete fails
            console.error(
              `[Projects] cascade-delete attachment ${aid} failed: ${err?.message || "unknown"}`,
            );
            await kv.put(
              `gc:attachment:${aid}`,
              JSON.stringify({ deletedAt: new Date().toISOString(), r2Key: `attachments/${userId}/${projectId}/${aid}.*` }),
            );
          }
        }
        await kv.delete(attListKey);
      }
    } catch (err: any) {
      console.error(
        `[Projects] cascade-delete attachments for project ${projectId} failed: ${err?.message || "unknown"}`,
      );
      // Non-fatal — project metadata is already deleted. Orphans queued for GC.
    }

    // Delete version files from R2 (best-effort: delete known versions)
    try {
      const latestVer = await kv.get(`project:${projectId}:latest_version`);
      // latest_version was already deleted above, but we read it before deletion for the cascade.
      // Re-read isn't possible since we deleted it. Instead, list R2 objects.
      const r2Objects = await r2.list({ prefix: `${projectId}/` });
      for (const obj of r2Objects.objects) {
        try {
          await r2.delete(obj.key);
        } catch (err: any) {
          console.error(`[Projects] R2 delete ${obj.key} failed: ${err?.message || "unknown"}`);
        }
      }
    } catch (err: any) {
      console.error(`[Projects] R2 cleanup for ${projectId} failed: ${err?.message || "unknown"}`);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to delete project" }, 500);
  }
});

export default projectsRouter;
