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

// Define the environment variables / bindings for the Worker
export type Bindings = {
  R2_PROJECTS: R2Bucket;
  KV_METADATA: KVNamespace;
  CLERK_SECRET_KEY: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  OPENROUTER_API_KEY: string;
  FAL_KEY: string;
  ENVIRONMENT: string;
  GITHUB_PAT: string;
  VERCEL_API_KEY: string;
  MCP_API_KEY: string;
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
    origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3003", "https://localhost:3000"], // Add prod URL later
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

app.get("/", (c) => {
  return c.text("Lovable Clone API is running!");
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export default app;
