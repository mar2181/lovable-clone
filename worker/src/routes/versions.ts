import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";

const versionsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

versionsRouter.use("*", authMiddleware);

// =====================================================
// PROJECT MEMORY — persistent context the AI reads every prompt
//
// IMPORTANT: These routes MUST be declared before "/:projectId/:versionNum"
// below, otherwise Hono's first-match wins and GET /memory gets routed to
// the version-fetcher (which then tries to load v"memory".json from R2).
// =====================================================

// Get project memory
versionsRouter.get("/:projectId/memory", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const kv = c.env.KV_METADATA;

  try {
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    const memory = await kv.get(`project:${projectId}:memory`) || "";
    const historyStr = await kv.get(`project:${projectId}:chat_history`);
    const history = historyStr ? JSON.parse(historyStr) : [];

    return c.json({ memory, history });
  } catch (error) {
    return c.json({ error: "Failed to fetch memory" }, 500);
  }
});

// Update project memory
versionsRouter.put("/:projectId/memory", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const kv = c.env.KV_METADATA;

  try {
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    const { memory } = await c.req.json();
    await kv.put(`project:${projectId}:memory`, memory || "");

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to save memory" }, 500);
  }
});

// =====================================================
// VERSION ROUTES
// =====================================================

// Get latest version of a project
versionsRouter.get("/:projectId/latest", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // Verify ownership
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // Get latest version number
    const latestVersion = await kv.get(`project:${projectId}:latest_version`);
    if (!latestVersion) return c.json({ error: "No versions found" }, 404);

    // Fetch version data from R2
    const versionObj = await r2.get(`${projectId}/v${latestVersion}.json`);
    if (!versionObj) return c.json({ error: "Version data missing" }, 404);

    const versionData = await versionObj.json();
    return c.json({ version: versionData });
  } catch (error) {
    console.error("Failed to fetch latest version:", error);
    return c.json({ error: "Failed to fetch version" }, 500);
  }
});

// Get specific version
//
// NOTE: This dynamic route is intentionally declared AFTER all named static
// children of /:projectId (memory, latest). Adding new named children?
// Declare them above this handler.
versionsRouter.get("/:projectId/:versionNum", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const versionNum = c.req.param("versionNum");

  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  // Defensive: reject non-numeric version params so a typo can't accidentally
  // try to fetch e.g. v"foo".json from R2.
  if (!/^\d+$/.test(versionNum)) {
    return c.json({ error: "Version number must be a positive integer" }, 400);
  }

  try {
    // Verify ownership
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // Fetch version data from R2
    const versionObj = await r2.get(`${projectId}/v${versionNum}.json`);
    if (!versionObj) return c.json({ error: "Version not found" }, 404);

    const versionData = await versionObj.json();
    return c.json({ version: versionData });
  } catch (error) {
    return c.json({ error: "Failed to fetch version" }, 500);
  }
});

// List all version history metadata (no heavy file content)
versionsRouter.get("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");

  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // Verify ownership
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    const latestVersion = parseInt(latestVersionStr || "1");

    const history = [];

    // In production, we'd store version metadata in KV to avoid N+1 R2 reads.
    // Read up to 50 past versions to build the timeline.
    const maxVersions = Math.min(latestVersion, 50);
    const promises = [];

    for (let i = latestVersion; i > latestVersion - maxVersions && i > 0; i--) {
      promises.push(r2.get(`${projectId}/v${i}.json`));
    }

    const versionObjects = await Promise.all(promises);

    for (const obj of versionObjects) {
      if (obj) {
        const data = await obj.json() as any;
        history.push({
          version: data.version,
          createdAt: data.createdAt,
          prompt: data.prompt,
          // exclude files from list view
        });
      }
    }

    return c.json({ history });
  } catch (error) {
    console.error("Failed to list history:", error);
    return c.json({ error: "Failed to fetch version history" }, 500);
  }
});

// Restore a previous version.
//
// Append-only: this copies version N's files into a brand-new version and
// points the project at it, so the rollback survives a reload and the full
// history is preserved (nothing is overwritten or deleted).
versionsRouter.post("/:projectId/:versionNum/restore", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const versionNum = c.req.param("versionNum");

  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  if (!/^\d+$/.test(versionNum)) {
    return c.json({ error: "Version number must be a positive integer" }, 400);
  }

  try {
    const projectStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectStr) return c.json({ error: "Project not found" }, 404);

    // Load the version being restored
    const sourceObj = await r2.get(`${projectId}/v${versionNum}.json`);
    if (!sourceObj) return c.json({ error: "Version not found" }, 404);

    const sourceData = (await sourceObj.json()) as any;
    const files = sourceData?.files;
    if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
      return c.json({ error: "Version has no files to restore" }, 422);
    }

    // Append a new version carrying the restored files
    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    const newVersionNum = parseInt(latestVersionStr || "1") + 1;

    const newVersionData: Record<string, unknown> = {
      version: newVersionNum,
      createdAt: new Date().toISOString(),
      prompt: `Restored from version ${versionNum}`,
      files,
    };
    if (sourceData?.dependencies) {
      newVersionData.dependencies = sourceData.dependencies;
    }

    await r2.put(`${projectId}/v${newVersionNum}.json`, JSON.stringify(newVersionData));
    await kv.put(`project:${projectId}:latest_version`, newVersionNum.toString());

    const project = JSON.parse(projectStr);
    project.updatedAt = new Date().toISOString();
    await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));

    return c.json({
      success: true,
      version: newVersionNum,
      files,
      dependencies: sourceData?.dependencies || {},
    });
  } catch (error) {
    console.error("Failed to restore version:", error);
    return c.json({ error: "Failed to restore version" }, 500);
  }
});

// Save a new manual version (e.g. user manually edits code in Monaco)
versionsRouter.post("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");

  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const { files, message } = await c.req.json();

    // Verify ownership
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // Increment version
    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    const newVersionNum = parseInt(latestVersionStr || "1") + 1;

    const newVersionData = {
      version: newVersionNum,
      createdAt: new Date().toISOString(),
      prompt: message || "Manual Edit",
      files
    };

    // Save to R2
    await r2.put(`${projectId}/v${newVersionNum}.json`, JSON.stringify(newVersionData));

    // Update pointer in KV
    await kv.put(`project:${projectId}:latest_version`, newVersionNum.toString());

    // Update project updated timestamp
    const project = JSON.parse(projectExists);
    project.updatedAt = new Date().toISOString();
    await kv.put(`user:${userId}:project:${projectId}`, JSON.stringify(project));

    return c.json({ success: true, version: newVersionNum });
  } catch (error) {
    console.error("Failed to save manual version:", error);
    return c.json({ error: "Failed to save version" }, 500);
  }
});

export default versionsRouter;
