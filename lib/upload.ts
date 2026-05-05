import { WORKER_URL } from "./constants";

export interface AttachmentUploadResult {
  id: string;
  url: string;
  r2Key: string;
  kind: "image" | "video";
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
]);
const MAX_BYTES = 100 * 1024 * 1024;

export function validateAttachmentFile(file: File): string | null {
  if (!ALLOWED.has(file.type)) {
    return "Unsupported file type. We accept JPG, PNG, WebP, GIF, MP4, WebM, MOV, M4V.";
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(0);
    return `File too large (${mb} MB). Max is 100 MB.`;
  }
  if (file.size === 0) {
    return "File is empty.";
  }
  return null;
}

export function uploadAttachment(
  file: File,
  projectId: string,
  token: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<AttachmentUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Bad response from server"));
        }
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          // use default
        }
        reject(new Error(`${xhr.status}: ${msg}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error — upload failed.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.open("POST", `${WORKER_URL}/api/attachments`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(form);
  });
}
