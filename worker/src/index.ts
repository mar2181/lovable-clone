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
import shareRouter from "./routes/share";
import supabaseRouter from "./routes/supabase";
import attachmentsRouter from "./routes/attachments";
import improvePromptRouter from "./routes/improve-prompt";
import retargetRouter from "./routes/retarget";
import seoPagesRouter from "./routes/seo-pages";
import specRouter from "./routes/spec";

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
  DEV_BYPASS_AUTH?: string;
  OWNER_CLERK_SUB?: string; // prod Clerk subject id of the owner; remapped onto the legacy "dev-local-user" workspace
  GITHUB_PAT: string;
  VERCEL_API_KEY: string;
  MCP_API_KEY: string;
  TAVILY_API_KEY: string; // Tavily web search/extract — powers web_search + web_fetch tools
  FIRECRAWL_API_KEY: string; // Firecrawl — powers web_scrape (JS-rendered full-page scrape)
  R2_PUBLIC_DOMAIN: string;
  SUPABASE_PAT: string;
  ALLOWED_ORIGINS: string; // Comma-separated list of allowed CORS origins
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_USER_ID?: string;
  TWILIO_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  MARIO_PHONE?: string;
};

// Define custom variables that persist through the request (like userId)
export type Variables = {
  userId: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS origin list. Sourced from the ALLOWED_ORIGINS env var (comma-separated)
// with a small built-in fallback for the production hostname and the two
// localhost ports we always use. We keep the env var as the single source of
// truth so local dev (.dev.vars), preview, and prod can each ship their own
// list without code edits.
const FALLBACK_ORIGINS = [
  "http://localhost:3015",
  "http://127.0.0.1:3015",
  "https://hswebappbuilder.space",
];
function buildOriginList(env: Bindings | undefined): string[] {
  const fromEnv = (env?.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = new Set<string>([...fromEnv, ...FALLBACK_ORIGINS]);
  return Array.from(merged);
}

app.use("/*", async (c, next) => {
  const allowList = buildOriginList(c.env);
  const handler = cors({
    origin: (incoming) => (allowList.includes(incoming) ? incoming : null),
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-User-Id"],
    allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
    exposeHeaders: ["Content-Length"],
    credentials: true,
  });
  return handler(c, next);
});

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
app.route("/api/share", shareRouter);
app.route("/api/supabase", supabaseRouter);
app.route("/api/attachments", attachmentsRouter);
app.route("/api/improve-prompt", improvePromptRouter);
app.route("/api/retarget", retargetRouter);
app.route("/api/seo-pages", seoPagesRouter);
app.route("/api/spec.json", specRouter);

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
