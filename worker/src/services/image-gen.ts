// fal.ai image generation service
// Uses flux-schnell for fast (~2-3s) image generation

const FAL_API_URL = "https://fal.run/fal-ai/flux/schnell";

interface FalImageResult {
  images: Array<{
    url: string;
    width: number;
    height: number;
    content_type: string;
  }>;
}

export async function generateImage(
  falKey: string,
  prompt: string,
  size: "landscape_16_9" | "square" | "portrait_4_3" = "landscape_16_9"
): Promise<string | null> {
  try {
    // Abort after 8 seconds to prevent hanging the entire response
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(FAL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${prompt}, professional photography, high quality, 4k`,
        image_size: size,
        num_images: 1,
        enable_safety_checker: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error("fal.ai error:", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as FalImageResult;
    return data.images?.[0]?.url || null;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("fal.ai request timed out after 8s");
    } else {
      console.error("fal.ai request failed:", err);
    }
    return null;
  }
}

// Placeholder marker format used in AI-generated code
const IMAGE_PLACEHOLDER_REGEX = /FAL_IMAGE\[([^\]]+)\]/g;

/**
 * Scans all files for FAL_IMAGE[description] markers,
 * generates real images via fal.ai, and replaces markers with URLs.
 * Has a global timeout of 15 seconds to prevent blocking the response.
 */
export async function replaceImagePlaceholders(
  files: Record<string, string>,
  falKey: string
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
    // Global timeout: if all image generation takes more than 15s, skip it
    const globalTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Global image generation timeout (15s)")), 15000)
    );

    const imageWork = Promise.allSettled(
      entries.map(async ([marker, description]) => {
        const url = await generateImage(falKey, description);
        if (url) {
          imageResults.set(marker, url);
        }
      })
    );

    await Promise.race([imageWork, globalTimeout]);
  } catch (err) {
    console.error("Image generation timed out or failed:", err);
  }

  // Replace successful placeholders in all files
  // For failed ones, replace with a placeholder image URL
  const updatedFiles: Record<string, string> = {};
  for (const [filename, content] of Object.entries(files)) {
    let updatedContent = content;
    for (const [marker] of placeholders.entries()) {
      const url = imageResults.get(marker) || "https://placehold.co/1200x600/1e293b/f59e0b?text=Image+Unavailable";
      updatedContent = updatedContent.replaceAll(marker, url);
    }
    updatedFiles[filename] = updatedContent;
  }

  console.log(`Generated ${imageResults.size}/${placeholders.size} images successfully`);
  return updatedFiles;
}
