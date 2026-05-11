import { Hono } from "hono";
import type { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { storeDataUrlAsset } from "../services/assets";

const assetsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

assetsRouter.get("/:projectId/:filename", async (c) => {
  const projectId = c.req.param("projectId");
  const filename = c.req.param("filename");
  const key = `assets/${projectId}/${filename}`;
  const object = await c.env.R2_PROJECTS.get(key);

  if (!object) {
    return c.json({ error: "Asset not found" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
});

assetsRouter.post("/:projectId", authMiddleware, async (c) => {
  const projectId = c.req.param("projectId");
  if (!projectId) return c.json({ error: "Missing projectId" }, 400);
  const body = await c.req.json<{
    imageBase64?: string;
    dataUrl?: string;
    filename?: string;
  }>();

  const dataUrl = body.dataUrl || body.imageBase64;
  if (!dataUrl) {
    return c.json({ error: "Missing dataUrl/imageBase64" }, 400);
  }

  try {
    const asset = await storeDataUrlAsset({
      r2: c.env.R2_PROJECTS,
      projectId,
      dataUrl,
      publicBaseUrl: new URL(c.req.url).origin,
      filenameHint: body.filename || "uploaded-image",
    });

    return c.json({ asset });
  } catch (error: any) {
    console.error("Asset upload failed:", error?.message || error);
    return c.json({ error: error?.message || "Asset upload failed" }, 400);
  }
});

export default assetsRouter;
