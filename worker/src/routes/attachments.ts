import { Hono } from "hono";
import { nanoid } from "nanoid";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import {
  safeFilename,
  deriveExtension,
  validateMimeType,
  validateSize,
  deriveKind,
  buildPublicUrl,
  updateProjectAttachmentList,
  removeFromProjectAttachmentList,
  checkRateLimit,
} from "../services/attachments";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC } from "../types/attachment";

const attachmentsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();
attachmentsRouter.use("*", authMiddleware);

// ── POST / — upload a new attachment ────────────────────────────────────────
attachmentsRouter.post("/", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const form = await c.req.formData();
    const file = form.get("file") as File | null;
    const projectId = form.get("projectId") as string | null;

    if (!file || !projectId) {
      return c.json({ error: "Missing file or projectId" }, 400);
    }
    if (!file.name || file.size === 0) {
      return c.json({ error: "File is empty" }, 400);
    }
    if (!validateMimeType(file.type)) {
      console.warn(
        `[Attachments] action=create userId=${userId} projectId=${projectId} status=fail reason=bad-mime mime=${file.type}`,
      );
      return c.json({ error: "Unsupported file type" }, 415);
    }
    if (!validateSize(file.size)) {
      console.warn(
        `[Attachments] action=create userId=${userId} projectId=${projectId} status=fail reason=oversize size=${file.size}`,
      );
      return c.json({ error: "File exceeds 100 MB limit" }, 413);
    }

    // Rate limit
    const allowed = await checkRateLimit(kv, userId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC);
    if (!allowed) {
      return c.json({ error: "Too many uploads. Please wait a few minutes." }, 429);
    }

    // Ownership check
    const projStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projStr) {
      return c.json({ error: "Project not found" }, 404);
    }

    const id = nanoid(12);
    const ext = deriveExtension(file.type);
    const r2Key = `attachments/${userId}/${projectId}/${id}.${ext}`;
    const kind = deriveKind(file.type);

    // Upload to R2. Pass the File (Blob) directly — passing file.stream()
    // silently no-ops in the Workers runtime (PUT returns 200 but writes 0
    // bytes; KV thinks the object exists, but a GET on the public URL 404s).
    // Blob input lets R2 see the full content-length and write atomically.
    const body = await file.arrayBuffer();
    await r2.put(r2Key, body, {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        userId,
        projectId,
        attachmentId: id,
        filename: safeFilename(file.name),
      },
    });

    // Build public URL
    const domain = c.env.R2_PUBLIC_DOMAIN;
    if (!domain) {
      console.error("[Attachments] R2_PUBLIC_DOMAIN is not set");
      return c.json(
        { error: "Storage not fully configured — R2_PUBLIC_DOMAIN is missing" },
        500,
      );
    }
    const publicUrl = buildPublicUrl(domain, r2Key);

    const record = {
      id,
      userId,
      projectId,
      filename: safeFilename(file.name),
      mimeType: file.type,
      kind,
      sizeBytes: file.size,
      r2Key,
      publicUrl,
      uploadedAt: new Date().toISOString(),
    };

    // Index in KV
    await kv.put(`project:${projectId}:attachment:${id}`, JSON.stringify(record));
    await updateProjectAttachmentList(kv, projectId, id);

    console.log(
      `[Attachments] action=create userId=${userId} projectId=${projectId} attachmentId=${id} status=ok mime=${file.type} size=${file.size}`,
    );

    return c.json(record, 201);
  } catch (error: any) {
    console.error(
      `[Attachments] action=create status=fail error="${error?.message || "unknown"}" stack="${error?.stack || ""}"`,
    );
    return c.json({ error: "Upload failed. Please try again." }, 500);
  }
});

// ── GET /?projectId=xxx — list attachments for a project ─────────────────────
attachmentsRouter.get("/", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;
  const projectId = c.req.query("projectId");

  if (!projectId) {
    return c.json({ error: "Missing projectId query parameter" }, 400);
  }

  try {
    const projStr = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projStr) {
      return c.json({ error: "Project not found" }, 404);
    }

    const listKey = `project:${projectId}:attachments`;
    const listStr = await kv.get(listKey);
    if (!listStr) {
      return c.json({ attachments: [] });
    }

    const { ids } = JSON.parse(listStr) as { ids: string[] };
    const records = await Promise.all(
      ids.map(async (aid) => {
        const raw = await kv.get(`project:${projectId}:attachment:${aid}`);
        return raw ? JSON.parse(raw) : null;
      }),
    );

    return c.json({ attachments: records.filter(Boolean) });
  } catch (error: any) {
    console.error(
      `[Attachments] action=list projectId=${projectId} status=fail error="${error?.message || "unknown"}"`,
    );
    return c.json({ error: "Failed to list attachments" }, 500);
  }
});

// ── DELETE /:id — delete an attachment ───────────────────────────────────────
attachmentsRouter.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;
  const attachmentId = c.req.param("id");

  if (!attachmentId) {
    return c.json({ error: "Missing attachment id" }, 400);
  }

  try {
    // Find the attachment by scanning project attachments (attachment records
    // are scoped under project, so we need to locate the owning project first).
    // We look up the record from the global user's project list.
    const projectKeys = await kv.list({ prefix: `user:${userId}:project:` });
    let record: any = null;
    let owningProjectId: string | null = null;

    for (const key of projectKeys.keys) {
      const projectId = key.name.split(":").pop()!;
      const raw = await kv.get(`project:${projectId}:attachment:${attachmentId}`);
      if (raw) {
        record = JSON.parse(raw);
        owningProjectId = projectId;
        break;
      }
    }

    if (!record || !owningProjectId) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    // Delete R2 object
    await r2.delete(record.r2Key);

    // Delete KV records
    await kv.delete(`project:${owningProjectId}:attachment:${attachmentId}`);
    await removeFromProjectAttachmentList(kv, owningProjectId, attachmentId);

    console.log(
      `[Attachments] action=delete userId=${userId} projectId=${owningProjectId} attachmentId=${attachmentId} status=ok`,
    );

    return c.json({ success: true });
  } catch (error: any) {
    console.error(
      `[Attachments] action=delete attachmentId=${attachmentId} status=fail error="${error?.message || "unknown"}"`,
    );
    return c.json({ error: "Failed to delete attachment" }, 500);
  }
});

export default attachmentsRouter;
