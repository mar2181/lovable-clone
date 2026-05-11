export interface AttachmentRecord {
  id: string;
  userId: string;
  projectId: string;
  filename: string;
  mimeType: string;
  kind: "image" | "video";
  sizeBytes: number;
  r2Key: string;
  publicUrl: string;
  uploadedAt: string;
}

export interface AttachmentInput {
  id: string;
  url: string;
  r2Key: string;
  kind: "image" | "video";
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
]);

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_ATTACHMENTS_PER_PROJECT = 20;
export const RATE_LIMIT_MAX = 30;
export const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
