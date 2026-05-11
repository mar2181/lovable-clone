import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_ATTACHMENTS_PER_PROJECT,
  AttachmentRecord,
} from "../types/attachment";

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export function deriveExtension(mimeType: string): string {
  const ext = mimeType.split("/")[1] || "bin";
  if (ext === "quicktime") return "mov";
  if (ext === "x-m4v") return "m4v";
  return ext;
}

export function validateMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export function validateSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_UPLOAD_BYTES;
}

export function deriveKind(mimeType: string): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

export function buildPublicUrl(domain: string, r2Key: string): string {
  const base = domain.replace(/\/+$/, "");
  return `${base}/${r2Key}`;
}

export async function updateProjectAttachmentList(
  kv: KVNamespace,
  projectId: string,
  attachmentId: string,
): Promise<void> {
  const listKey = `project:${projectId}:attachments`;
  const existing = await kv.get(listKey);
  const data: { ids: string[] } = existing
    ? JSON.parse(existing)
    : { ids: [] };
  data.ids = [attachmentId, ...data.ids].slice(0, MAX_ATTACHMENTS_PER_PROJECT);
  await kv.put(listKey, JSON.stringify(data));
}

export async function removeFromProjectAttachmentList(
  kv: KVNamespace,
  projectId: string,
  attachmentId: string,
): Promise<void> {
  const listKey = `project:${projectId}:attachments`;
  const existing = await kv.get(listKey);
  if (!existing) return;
  const data: { ids: string[] } = JSON.parse(existing);
  data.ids = data.ids.filter((id: string) => id !== attachmentId);
  await kv.put(listKey, JSON.stringify(data));
}

export async function checkRateLimit(
  kv: KVNamespace,
  userId: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const key = `ratelimit:upload:${userId}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current) : 0;
  if (count >= max) return false;
  // Best-effort increment with expiry. TTL is reset on each write; acceptable
  // for a lightweight rate limiter (not strictly atomic).
  await kv.put(key, String(count + 1), { expirationTtl: windowSec });
  return true;
}

export interface AttachmentPromptEntry {
  kind: "image" | "video";
  mimeType: string;
  filename: string;
  publicUrl: string;
}

export function buildAttachmentPromptBlock(
  attachments: AttachmentPromptEntry[],
  failedFilenames?: string[],
): string {
  const entries = attachments
    .map(
      (a, i) =>
        `Attachment ${i + 1}:\n- kind: ${a.kind}\n- mimeType: ${a.mimeType}\n- url: ${a.publicUrl}\n- filename: ${a.filename}`,
    )
    .join("\n\n");

  const failedBlock =
    failedFilenames && failedFilenames.length > 0
      ? `\n\n⚠️ IMPORTANT: ${failedFilenames.length > 1 ? "These images" : "This image"} could NOT be loaded from storage and ${failedFilenames.length > 1 ? "were" : "was"} NOT sent to you as vision input: ${failedFilenames.join(", ")}. The URL${failedFilenames.length > 1 ? "s" : ""} above still point${failedFilenames.length > 1 ? "" : "s"} to the correct location${failedFilenames.length > 1 ? "s" : ""} — use the URL${failedFilenames.length > 1 ? "s" : ""} in your code but do NOT attempt to describe or analyze the content of the failed ${failedFilenames.length > 1 ? "images" : "image"}.`
      : "";

  return `The user has attached the following media to this message. Use each URL EXACTLY as provided in the appropriate HTML element's src attribute. Do NOT base64-encode, transcode, or describe the contents — these are real assets the user wants embedded in the generated site.

${entries}${failedBlock}

Embedding rules:
- For kind=image: use <img src="..." alt="..."> with a meaningful alt derived from the user's prompt or filename.
- For kind=video: use <video src="..." autoPlay muted loop playsInline className="..."> unless the user requests otherwise (e.g. "with controls", "no autoplay").
- Always preserve aspect ratio with object-fit: cover unless user requests otherwise.
- If the user's prompt is silent on placement, place the asset prominently (hero / section header / card image).`;
}
