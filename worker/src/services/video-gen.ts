// fal.ai video generation service.
// Replaces FAL_VIDEO[description] placeholders in any file with hosted MP4
// URLs produced by fal-ai/kling-video/v1.6/standard/text-to-video.
//
// Cinematic mode is the primary consumer — the model emits a single
// FAL_VIDEO marker for the hero background video, and the worker resolves
// it after the JSON envelope is parsed.

const KLING_T2V_ENDPOINT =
  "https://fal.run/fal-ai/kling-video/v1.6/standard/text-to-video";

const VIDEO_PLACEHOLDER_REGEX = /FAL_VIDEO\[([^\]]+)\]/g;

// Caps. Cinematic mode generates at most one hero video per turn, but we
// allow a small bound so a richer page could request multiple short clips.
const MAX_VIDEOS_PER_TURN = 2;

// Single-render cap. fal Kling t2v takes 2-4 min in practice; a 5-min cap
// covers the slow tail without letting a stuck job stall the whole request.
const PER_VIDEO_TIMEOUT_MS = 300_000;

// Global cap across all videos in parallel. Same value because we render
// in parallel anyway.
const GLOBAL_VIDEO_TIMEOUT_MS = 320_000;

interface FalVideoResult {
  video?: { url?: string; content_type?: string };
}

function promptForCinematicVideo(description: string): string {
  // Cinematic skill house style: golden hour, slow camera push, no text,
  // no people, professional commercial-photography polish. Mirrors the
  // Kling prompt body used in the gold-standard SPI Fun Rentals build.
  const base = description.trim();
  if (/cinematic|dolly|push|golden hour|4k|commercial|editorial/i.test(base)) {
    return base; // Caller already wrote a strong cinematic prompt.
  }
  return [
    base,
    "cinematic slow camera push",
    "late afternoon golden hour light",
    "shallow depth of field",
    "professional commercial photography",
    "4k cinematic",
    "no text",
    "no people",
  ].join(", ");
}

async function generateKlingVideo(
  falKey: string,
  description: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    PER_VIDEO_TIMEOUT_MS,
  );

  try {
    const res = await fetch(KLING_T2V_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: promptForCinematicVideo(description),
        duration: "5",
        aspect_ratio: "16:9",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "fal.ai Kling t2v failed:",
        res.status,
        res.statusText,
        text.slice(0, 300),
      );
      return null;
    }

    const data = (await res.json()) as FalVideoResult;
    return data.video?.url || null;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error(
        `fal.ai Kling t2v timed out after ${PER_VIDEO_TIMEOUT_MS}ms`,
      );
    } else {
      console.error("fal.ai Kling t2v threw:", err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Scans all files for FAL_VIDEO[description] markers, generates real
 * videos via fal Kling text-to-video, and substitutes the resulting MP4
 * URLs. Markers that fail to resolve are left as a visible placeholder
 * poster so the failure is obvious in Sandpack.
 */
export async function replaceVideoPlaceholders(
  files: Record<string, string>,
  falKey: string,
): Promise<Record<string, string>> {
  if (!falKey) return files;

  const placeholders = new Map<string, string>();
  for (const content of Object.values(files)) {
    const regex = new RegExp(VIDEO_PLACEHOLDER_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      placeholders.set(match[0], match[1]);
      if (placeholders.size >= MAX_VIDEOS_PER_TURN) break;
    }
    if (placeholders.size >= MAX_VIDEOS_PER_TURN) break;
  }

  if (placeholders.size === 0) return files;

  console.log(
    `Generating ${placeholders.size} video(s) via fal Kling text-to-video...`,
  );

  const videoResults = new Map<string, string>();
  const entries = Array.from(placeholders.entries());

  try {
    const globalTimeout = new Promise<void>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Global video generation timeout (${GLOBAL_VIDEO_TIMEOUT_MS}ms)`,
            ),
          ),
        GLOBAL_VIDEO_TIMEOUT_MS,
      ),
    );

    const work = Promise.allSettled(
      entries.map(async ([marker, description]) => {
        const url = await generateKlingVideo(falKey, description);
        if (url) videoResults.set(marker, url);
      }),
    );

    await Promise.race([work, globalTimeout]);
  } catch (err) {
    console.error("Video generation timed out or failed:", err);
  }

  const FALLBACK_POSTER =
    "https://placehold.co/1280x720/0a0e14/f59e0b?text=Hero+Video+Pending";

  const updated: Record<string, string> = {};
  for (const [filename, content] of Object.entries(files)) {
    let next = content;
    for (const [marker] of placeholders.entries()) {
      const url = videoResults.get(marker) || FALLBACK_POSTER;
      next = next.replaceAll(marker, url);
    }
    updated[filename] = next;
  }

  console.log(
    `Generated ${videoResults.size}/${placeholders.size} videos successfully`,
  );
  return updated;
}
