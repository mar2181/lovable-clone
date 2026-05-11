// fal.ai image generation service
// Uses FLUX pro first for quality, then falls back to schnell for speed/resilience.

import { storeRemoteImageAsset } from "./assets";

const DEFAULT_FAL_ENDPOINT = "https://fal.run/fal-ai/flux-pro/v1.1-ultra";
const FALLBACK_FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell";

type ImageSize = "landscape_16_9" | "square" | "portrait_4_3";

interface FalImageResult {
  images: Array<{
    url: string;
    width?: number;
    height?: number;
    content_type?: string;
  }>;
}

type ImageAssetOptions = {
  r2: R2Bucket;
  projectId: string;
  publicBaseUrl: string;
};

function aspectRatioFor(size: ImageSize): string {
  if (size === "square") return "1:1";
  if (size === "portrait_4_3") return "3:4";
  return "16:9";
}

function promptForQuality(prompt: string): string {
  return `${prompt}, premium commercial photography, realistic lighting, sharp focus, natural composition, high-end editorial quality, no text artifacts, no distorted faces, no extra fingers`;
}

async function callFalEndpoint(args: {
  falKey: string;
  endpoint: string;
  prompt: string;
  size: ImageSize;
  timeoutMs: number;
}): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const isUltra = args.endpoint.includes("flux-pro/v1.1-ultra");
    const body = isUltra
      ? {
          prompt: promptForQuality(args.prompt),
          aspect_ratio: aspectRatioFor(args.size),
          num_images: 1,
          output_format: "jpeg",
          safety_tolerance: "4",
          enhance_prompt: true,
        }
      : {
          prompt: promptForQuality(args.prompt),
          image_size: args.size,
          num_images: 1,
          enable_safety_checker: false,
        };

    const res = await fetch(args.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${args.falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("fal.ai error:", args.endpoint, res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as FalImageResult;
    return data.images?.[0]?.url || null;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error(`fal.ai request timed out after ${args.timeoutMs}ms`, args.endpoint);
    } else {
      console.error("fal.ai request failed:", args.endpoint, err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateImage(
  falKey: string,
  prompt: string,
  size: ImageSize = "landscape_16_9"
): Promise<string | null> {
  const primary = await callFalEndpoint({
    falKey,
    endpoint: DEFAULT_FAL_ENDPOINT,
    prompt,
    size,
    timeoutMs: 30000,
  });

  if (primary) return primary;

  return callFalEndpoint({
    falKey,
    endpoint: FALLBACK_FAL_ENDPOINT,
    prompt,
    size,
    timeoutMs: 12000,
  });
}

// Placeholder marker format used in AI-generated code
const IMAGE_PLACEHOLDER_REGEX = /FAL_IMAGE\[([^\]]+)\]/g;

/**
 * Scans all files for FAL_IMAGE[description] markers,
 * generates real images via fal.ai, stores successful remote images into R2,
 * and replaces markers with app-owned asset URLs.
 */
export async function replaceImagePlaceholders(
  files: Record<string, string>,
  falKey: string,
  assetOptions?: ImageAssetOptions
): Promise<Record<string, string>> {
  // Collect all unique image descriptions across all files
  const placeholders = new Map<string, string>(); // marker -> description

  for (const content of Object.values(files)) {
    let match;
    const regex = new RegExp(IMAGE_PLACEHOLDER_REGEX.source, "g");
    while ((match = regex.exec(content)) !== null) {
      placeholders.set(match[0], match[1]);
    }
  }

  if (placeholders.size === 0) return files;

  console.log(`Generating ${placeholders.size} images via fal.ai...`);

  // Generate all images in parallel with a global timeout
  const imageResults = new Map<string, string>();
  const entries = Array.from(placeholders.entries());

  try {
    // Quality images can take longer than schnell. Keep bounded but don't force ugly fallback too early.
    const globalTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Global image generation timeout (45s)")), 45000)
    );

    const imageWork = Promise.allSettled(
      entries.map(async ([marker, description]) => {
        const remoteUrl = await generateImage(falKey, description);
        if (!remoteUrl) return;

        if (assetOptions) {
          const asset = await storeRemoteImageAsset({
            ...assetOptions,
            remoteUrl,
            filenameHint: description,
          });
          imageResults.set(marker, asset?.url || remoteUrl);
          return;
        }

        imageResults.set(marker, remoteUrl);
      })
    );

    await Promise.race([imageWork, globalTimeout]);
  } catch (err) {
    console.error("Image generation timed out or failed:", err);
  }

  // Replace successful placeholders in all files.
  // For failed ones, use a visible placeholder so failure is obvious in preview.
  const updatedFiles: Record<string, string> = {};
  for (const [filename, content] of Object.entries(files)) {
    let updatedContent = content;
    for (const [marker] of placeholders.entries()) {
      const url = imageResults.get(marker) || "https://placehold.co/1200x675/1e293b/f59e0b?text=Image+Generation+Failed";
      updatedContent = updatedContent.replaceAll(marker, url);
    }
    updatedFiles[filename] = updatedContent;
  }

  console.log(`Generated ${imageResults.size}/${placeholders.size} images successfully`);
  return updatedFiles;
}
