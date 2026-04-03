import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import { defaultFiles } from "../ai/default-project";

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
    
    // Delete files from R2 (simplified: optimally we should list and delete all versions)
    // For a real production app we'd use a background task or worker cron to clean up R2
    
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Failed to delete project" }, 500);
  }
});

export default projectsRouter;
