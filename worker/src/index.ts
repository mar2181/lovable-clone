import { Hono } from "hono";
import { cors } from "hono/cors";

import projectsRouter from "./routes/projects";
import versionsRouter from "./routes/versions";
import chatRouter from "./routes/chat";
import creditsRouter from "./routes/credits";
import exportRouter from "./routes/export";
import githubRouter from "./routes/github";
import vercelRouter from "./routes/vercel";
import templateRouter from "./routes/template";
import blogRouter from "./routes/blog";
import bridgeRouter from "./routes/bridge";
import buildRouter from "./routes/build";
import assetsRouter from "./routes/assets";

// Define the environment variables / bindings for the Worker
export type Bindings = {
  R2_PROJECTS: R2Bucket;
  KV_METADATA: KVNamespace;
  CLERK_SECRET_KEY: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  CLERK_DOMAIN: string; // Clerk frontend API domain (e.g. "clerk.your-app.com")
  OPENROUTER_API_KEY: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  FAL_KEY: string;
  ENVIRONMENT: string;
  GITHUB_PAT: string;
  VERCEL_API_KEY: string;
  ALLOWED_ORIGINS: string; // Comma-separated list of allowed CORS origins
};

// Define custom variables that persist through the request (like userId)
export type Variables = {
  userId: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Enable CORS for frontend
app.use(
  "/*",
  cors({
    origin: (origin, c) => {
      // Always allow local dev frontends on any port.
      // WSL/Windows often requires moving ports when another local service is already bound.
      if (
        origin &&
        /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(origin)
      ) {
        return origin;
      }

      // Allow any *.vercel.app subdomain
      if (origin && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) {
        return origin;
      }

      // Allow configured extra origins (comma-separated)
      const envOrigins = (c.env as any).ALLOWED_ORIGINS;
      if (envOrigins) {
        const allowed = envOrigins.split(",").map((s: string) => s.trim());
        if (allowed.includes(origin)) {
          return origin;
        }
      }

      // Deny — return undefined (CORS headers won't be set)
      return undefined;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
    exposeHeaders: ["Content-Length"],
    credentials: true,
  })
);

// Mount routers
app.route("/api/projects", projectsRouter);
app.route("/api/versions", versionsRouter);
app.route("/api/chat", chatRouter);
app.route("/api/credits", creditsRouter);
app.route("/api/export", exportRouter);
app.route("/api/github", githubRouter);
app.route("/api/vercel", vercelRouter);
app.route("/api/template", templateRouter);
app.route("/api/blog", blogRouter);
app.route("/api/bridge", bridgeRouter);
app.route("/api/build", buildRouter);
app.route("/api/assets", assetsRouter);
app.route("/assets", assetsRouter);

app.get("/", (c) => {
  return c.text("HS Solutions API is running!");
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const kv = env.KV_METADATA;
    const r2 = env.R2_PROJECTS;

    // ── GC: clean up orphaned attachment R2 objects ──────────────────────────
    // Walk gc:attachment:* keys queued by failed KV writes or cascade deletes.
    try {
      const gcKeys = await kv.list({ prefix: "gc:attachment:" });
      for (const key of gcKeys.keys) {
        try {
          const raw = await kv.get(key.name);
          if (!raw) continue;
          const { r2Key } = JSON.parse(raw);
          await r2.delete(r2Key);
          await kv.delete(key.name);
          console.log(`[GC] Deleted orphan R2 object: ${r2Key}`);
        } catch (err: any) {
          console.error(`[GC] Failed to clean up ${key.name}: ${err?.message || "unknown"}`);
        }
      }
    } catch (err: any) {
      console.error(`[GC] List failed: ${err?.message || "unknown"}`);
    }

    // ── GC: scan R2 for orphaned attachments (older than 30 days, no KV record) ──
    try {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const objects = await r2.list({ prefix: "attachments/" });
      for (const obj of objects.objects) {
        try {
          if (obj.uploaded && obj.uploaded.getTime() < thirtyDaysAgo) {
            // Derive attachment KV key from path
            const r2Key = obj.key;
            const parts = r2Key.split("/");
            if (parts.length >= 4) {
              const projectId = parts[2];
              const filePart = parts[3];
              const attachmentId = filePart.split(".")[0];
              const kvKey = `project:${projectId}:attachment:${attachmentId}`;
              const record = await kv.get(kvKey);
              if (!record) {
                await r2.delete(r2Key);
                console.log(`[GC] Deleted orphan R2 object (no KV record): ${r2Key}`);
              }
            }
          }
        } catch (err: any) {
          console.error(`[GC] Error processing R2 object ${obj.key}: ${err?.message || "unknown"}`);
        }
      }
    } catch (err: any) {
      console.error(`[GC] R2 scan failed: ${err?.message || "unknown"}`);
    }

    console.log("[GC] Scheduled cleanup complete");
  },
};
