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

// Clone a project — seeds a brand-new project with the source's CURRENT files
// as v1. Version history, chat history, project memory and integrations are
// intentionally NOT copied: each clone is a clean, fully independent project.
projectsRouter.post("/:id/clone", async (c) => {
  const userId = c.get("userId");
  const sourceId = c.req.param("id");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // Verify the source project exists and is owned by the caller
    const sourceStr = await kv.get(`user:${userId}:project:${sourceId}`);
    if (!sourceStr) {
      return c.json({ error: "Project not found" }, 404);
    }
    const source = JSON.parse(sourceStr);

    // Load the source's latest version files from R2
    const latestVersionStr = await kv.get(`project:${sourceId}:latest_version`);
    if (!latestVersionStr) {
      return c.json({ error: "Source project has no versions to clone" }, 422);
    }
    const sourceObj = await r2.get(`${sourceId}/v${latestVersionStr}.json`);
    if (!sourceObj) {
      return c.json({ error: "Source version data missing" }, 422);
    }
    const sourceVersion = JSON.parse(await sourceObj.text());
    const files = sourceVersion?.files;
    if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
      return c.json({ error: "Source project has no files to clone" }, 422);
    }

    // Build the new project
    const body = await c.req.json().catch(() => ({}));
    const requestedName = typeof body?.name === "string" ? body.name.trim() : "";
    const newProjectId = nanoid(10);
    const now = new Date().toISOString();

    const newProject = {
      id: newProjectId,
      userId,
      name: requestedName || `Copy of ${source.name}`,
      description: source.description || "",
      createdAt: now,
      updatedAt: now,
    };

    const newVersionData: Record<string, unknown> = {
      version: 1,
      createdAt: now,
      prompt: `Cloned from ${source.name}`,
      files,
    };
    if (sourceVersion?.dependencies) {
      newVersionData.dependencies = sourceVersion.dependencies;
    }

    await r2.put(`${newProjectId}/v1.json`, JSON.stringify(newVersionData));
    await kv.put(`project:${newProjectId}:latest_version`, "1");
    await kv.put(`user:${userId}:project:${newProjectId}`, JSON.stringify(newProject));

    return c.json({ project: newProject, version: 1 }, 201);
  } catch (error) {
    console.error("Clone project error:", error);
    return c.json({ error: "Failed to clone project" }, 500);
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

// ── POST /:id/inline-edits — apply a batch of bounded edits without an AI turn ─
// Used by the visual editor's Inspector panel. Each edit is a literal string
// swap (text or img src). We reject ambiguous matches so a single edit can't
// silently rewrite unrelated occurrences elsewhere in the project.
//
// Body shape:
//   { edits: [{ kind: "text" | "img-src", oldValue: string, newValue: string }] }
//
// Response:
//   { newVersion: number, files: {...}, dependencies: {...}, applied: N,
//     rejected: [{ index, reason }] }
interface InlineEdit {
  kind: "text" | "img-src";
  oldValue: string;
  newValue: string;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

projectsRouter.post("/:id/inline-edits", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // Ownership
    const projStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projStr) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.edits) || body.edits.length === 0) {
      return c.json({ error: "Body must include a non-empty edits array" }, 400);
    }
    if (body.edits.length > 20) {
      return c.json({ error: "Too many edits in one request (max 20)" }, 400);
    }

    const edits: InlineEdit[] = body.edits.filter(
      (e: any) =>
        e &&
        (e.kind === "text" || e.kind === "img-src") &&
        typeof e.oldValue === "string" &&
        typeof e.newValue === "string" &&
        e.oldValue.length > 0,
    );
    if (edits.length === 0) {
      return c.json({ error: "No valid edits in payload" }, 400);
    }

    // Load latest version files
    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    if (!latestVersionStr) {
      return c.json({ error: "Project has no versions yet" }, 422);
    }
    const latestVersion = parseInt(latestVersionStr);
    const obj = await r2.get(`${projectId}/v${latestVersion}.json`);
    if (!obj) return c.json({ error: "Latest version data missing" }, 422);
    const versionData = JSON.parse(await obj.text());
    const files: Record<string, string> = { ...(versionData?.files || {}) };
    const dependencies = versionData?.dependencies || {};

    // Apply each edit, tracking outcomes
    const rejected: Array<{ index: number; reason: string }> = [];
    let appliedCount = 0;

    edits.forEach((edit, idx) => {
      if (edit.oldValue === edit.newValue) {
        rejected.push({ index: idx, reason: "no change" });
        return;
      }
      let totalMatches = 0;
      const matchingFiles: string[] = [];
      for (const [path, content] of Object.entries(files)) {
        const n = countOccurrences(content, edit.oldValue);
        if (n > 0) {
          totalMatches += n;
          matchingFiles.push(path);
        }
      }
      if (totalMatches === 0) {
        rejected.push({ index: idx, reason: `original value not found in any file` });
        return;
      }
      if (totalMatches > 1) {
        rejected.push({
          index: idx,
          reason: `ambiguous — original value appears ${totalMatches}× across ${matchingFiles.length} file(s); edit it in the code panel instead`,
        });
        return;
      }
      // Exactly one occurrence — safe to swap
      const file = matchingFiles[0];
      const before = files[file];
      const i = before.indexOf(edit.oldValue);
      files[file] = before.slice(0, i) + edit.newValue + before.slice(i + edit.oldValue.length);
      appliedCount++;
    });

    if (appliedCount === 0) {
      return c.json({ applied: 0, rejected, files: versionData.files, dependencies }, 200);
    }

    // Save as a new version (append-only — never overwrites)
    const newVersionNum = latestVersion + 1;
    const newVersionData = {
      version: newVersionNum,
      createdAt: new Date().toISOString(),
      prompt: `Inline edits (${appliedCount} ${appliedCount === 1 ? "change" : "changes"})`,
      files,
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    };
    await r2.put(`${projectId}/v${newVersionNum}.json`, JSON.stringify(newVersionData));
    await kv.put(`project:${projectId}:latest_version`, newVersionNum.toString());

    console.log(
      `[InlineEdits] user=${userId} project=${projectId} v${newVersionNum} applied=${appliedCount} rejected=${rejected.length}`,
    );

    return c.json({
      newVersion: newVersionNum,
      files,
      dependencies,
      applied: appliedCount,
      rejected,
    });
  } catch (error: any) {
    console.error("[InlineEdits] failed:", error?.message || error);
    return c.json({ error: "Failed to apply inline edits" }, 500);
  }
});

export default projectsRouter;
