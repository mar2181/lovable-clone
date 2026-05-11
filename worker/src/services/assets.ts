export type StoredAsset = {
  key: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  sourceUrl?: string;
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "asset";
}

function extensionFor(contentType: string, fallback = "jpg"): string {
  return IMAGE_EXTENSIONS[contentType.toLowerCase().split(";")[0]] || fallback;
}

function publicAssetUrl(publicBaseUrl: string, projectId: string, filename: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/assets/${encodeURIComponent(projectId)}/${encodeURIComponent(filename)}`;
}

export function parseDataUrl(dataUrl: string): { contentType: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL");
  }

  const contentType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { contentType, bytes };
}

export async function storeDataUrlAsset(args: {
  r2: R2Bucket;
  projectId: string;
  dataUrl: string;
  publicBaseUrl: string;
  filenameHint?: string;
}): Promise<StoredAsset> {
  const { contentType, bytes } = parseDataUrl(args.dataUrl);
  const ext = extensionFor(contentType);
  const filename = `${sanitizeName(args.filenameHint || "uploaded-image")}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const key = `assets/${args.projectId}/${filename}`;

  await args.r2.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { projectId: args.projectId, source: "upload" },
  });

  return {
    key,
    filename,
    contentType,
    size: bytes.byteLength,
    url: publicAssetUrl(args.publicBaseUrl, args.projectId, filename),
  };
}

export async function storeRemoteImageAsset(args: {
  r2: R2Bucket;
  projectId: string;
  remoteUrl: string;
  publicBaseUrl: string;
  filenameHint?: string;
}): Promise<StoredAsset | null> {
  const res = await fetch(args.remoteUrl, {
    headers: { "User-Agent": "HSSolutions/asset-cache" },
  });

  if (!res.ok) {
    console.error("Failed to fetch remote image for asset cache:", res.status, args.remoteUrl);
    return null;
  }

  const contentType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    console.error("Remote asset is not an image:", contentType, args.remoteUrl);
    return null;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = extensionFor(contentType);
  const filename = `${sanitizeName(args.filenameHint || "generated-image")}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const key = `assets/${args.projectId}/${filename}`;

  await args.r2.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { projectId: args.projectId, source: "fal", sourceUrl: args.remoteUrl },
  });

  return {
    key,
    filename,
    contentType,
    size: bytes.byteLength,
    sourceUrl: args.remoteUrl,
    url: publicAssetUrl(args.publicBaseUrl, args.projectId, filename),
  };
}
